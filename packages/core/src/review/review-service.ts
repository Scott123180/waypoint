import type { Clock, PolicyModule, ReviewRecord, SummaryProvider, VaultStore } from "../ports/index";
import { createDefaultPolicy } from "../policy/default-policy";
import type { ProjectService } from "../projects/project-service";
import type { MilestoneRef, ProjectStatus } from "../projects/types";
import { daysBetween, localDate } from "../vault/lists";
import { outstanding, untouchedSince } from "../waiting/derive";
import type { WaitingService } from "../waiting/waiting-service";
import type { UnreadableLine, WaitingRef } from "../waiting/types";
import { isoWeek, nextWeek } from "../weekly/iso-week";
import type { TopThreeService } from "../weekly/top-three-service";
import type { Week, WeekId } from "../weekly/types";
import {
  appendToSection,
  INBOX_HEADING,
  LOG_DIR,
  NOTE_HEADING,
  parseReview,
  parseReviewSummary,
  PROJECTS_HEADING,
  renderInboxLine,
  renderNewReview,
  renderProjectLine,
  renderWaitingItemLine,
  renderTopThreeLines,
  renderWaitingProjectLine,
  reviewPath,
  setPreambleField,
  setSectionBody,
  summaryHeadingFor,
  TOP_THREE_HEADING,
  WAITING_HEADING,
} from "./review-document";
import {
  REVIEW_STEPS,
  type ProjectRefusal,
  type ProjectReviewAction,
  type Review,
  type ReviewRecordResult,
  type ReviewRefusal,
  type ReviewResult,
  type ReviewStepName,
  type ReviewSummary,
  type StaleFlag,
  type StaleWaitingItem,
  type WaitingReviewRecord,
  type WalkEntry,
} from "./types";

/**
 * The single entry point for the weekly review.
 *
 * The same habits as `SortService`, `ProjectService`, and `TopThreeService`:
 * injected ports, every read fresh, refusals as values a caller renders rather
 * than exceptions, and one write at a time.
 *
 * Three things are structural rather than conventional:
 *
 *   - **The file is the state.** An in-progress review lives in the same
 *     `log/YYYY-Www.md` it will complete into, marked `status: in progress`.
 *     There is no journal and no promotion step, so there is nothing to leave
 *     behind if the process dies mid-ritual (research R2).
 *
 *   - **The review changes nothing itself.** Every project, outcome, and
 *     waiting-for change goes through the service that owns it, so the same
 *     decision points fire and no behaviour exists only inside the ritual. What
 *     this class writes is the record of what the user decided.
 *
 *   - **Acceptance of a summary is an argument, not a flag.** `complete()`
 *     records only what the caller hands back, so "record a draft without
 *     asking" is not expressible (contracts/summary-port.md).
 *
 * See specs/005-weekly-review-ritual/contracts/review-api.md
 */

export interface ReviewServiceDeps {
  vault: VaultStore;
  /** Every project change goes through this, never through the vault directly. */
  projects: ProjectService;
  topThree: TopThreeService;
  /** Reads the inbox count. The review never writes the inbox (FR-077). */
  inbox: { count(): Promise<number> };
  /** Every waiting-for change goes through this, never through the vault directly. */
  waiting: WaitingService;
  clock?: Clock;
  /** Defaults to the single shipped module — absent means rules, not no rules. */
  policy?: PolicyModule;
  /**
   * Absent means **no summary**, the opposite of `policy` above.
   *
   * A rule that could be dropped by forgetting an argument is a bypass, so
   * policy defaults to enforcing. A summary that appeared because an argument
   * was forgotten would be generated text nobody asked for, so summaries
   * default to nothing (research R10).
   */
  summary?: SummaryProvider;
}

const systemClock: Clock = { now: () => new Date() };

export class ReviewService {
  private readonly vault: VaultStore;
  private readonly projectService: ProjectService;
  private readonly topThreeService: TopThreeService;
  private readonly inbox: { count(): Promise<number> };
  private readonly waitingService: WaitingService;
  private readonly clock: Clock;
  private readonly policy: PolicyModule;
  private readonly summaryProvider: SummaryProvider | null;
  /** Tail of the write queue. See `serialize`. */
  private writes: Promise<void> = Promise.resolve();

  constructor(deps: ReviewServiceDeps) {
    this.vault = deps.vault;
    this.projectService = deps.projects;
    this.topThreeService = deps.topThree;
    this.inbox = deps.inbox;
    this.waitingService = deps.waiting;
    this.clock = deps.clock ?? systemClock;
    this.policy = deps.policy ?? createDefaultPolicy(deps.vault);
    this.summaryProvider = deps.summary ?? null;
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The review for the current week, or null when none has been started. */
  async current(): Promise<Review | null> {
    return this.get(this.currentWeek());
  }

  /** One review, read as it stands on disk. Never repaired (FR-072). */
  async get(week: WeekId): Promise<Review | null> {
    const content = await this.vault.read(reviewPath(week));
    return content === null ? null : parseReview(content, week);
  }

  /**
   * Past reviews, newest first.
   *
   * Sorted here rather than trusted from the directory: week identifiers sort
   * chronologically as text by construction, and a hand-added file may arrive
   * in any order.
   */
  async history(): Promise<ReviewSummary[]> {
    const weeks = await this.vault.list(LOG_DIR);
    const summaries: ReviewSummary[] = [];
    for (const week of weeks) {
      const content = await this.vault.read(reviewPath(week));
      if (content !== null) summaries.push(parseReviewSummary(content, week));
    }
    return summaries.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
  }

  /**
   * How many unsorted items are in the inbox. Derived on every call (FR-014).
   *
   * `notice` carries the policy module's complaint about its own configuration,
   * when it has one. The module appends problems to every decision it returns,
   * including an `allow` — so asking the gate here is what makes a typo in
   * `policy.md` visible at the start of the ritual rather than only when the
   * gate happens to fire. It is a notice and never a refusal: a configuration
   * error must not stop the user working (FR-084).
   */
  async inboxStep(): Promise<{ count: number; notice: string }> {
    const count = await this.inbox.count();
    const decision = await this.policy.decide({ point: "review.inbox.advance", inboxCount: count });

    // Only when the gate itself is silent. When it has something to say, that
    // arrives with the refusal from `advance` and saying it twice is noise.
    const notice = decision.verdict === "allow" ? decision.reason : "";
    return { count, notice };
  }

  /**
   * The walk: active and waiting projects, in stable order, each with
   * everything needed to decide about it.
   *
   * **Waiting is included on purpose.** A waiting project is the one most
   * likely to have gone quiet, which is exactly what a weekly review is for.
   * Parked and done are decisions already made, and walking them every week
   * teaches the user to click through the step (FR-022).
   *
   * One pass over the vault, via `listDetailed()` — a walk that re-read the
   * vault per project would be quadratic, and fast enough on a test fixture to
   * hide it (SC-016).
   *
   * Staleness is asked of the policy module, per waiting project, and only when
   * the ledger knows when the wait began. Core supplies the two dates and
   * reports the answer; it does not know the threshold and never compares
   * anything to it (FR-022a, Principle V).
   */
  async projectStep(): Promise<WalkEntry[]> {
    const detailed = await this.projectService.listDetailed();
    const review = await this.current();
    const today = localDate(this.clock.now());

    const entries: WalkEntry[] = [];
    for (const { project, summary } of detailed) {
      if (summary.status !== "active" && summary.status !== "waiting") continue;

      entries.push({
        project: summary,
        outcome: project.outcome,
        nextAction: project.nextAction,
        milestones: project.milestones,
        stale: await this.staleness(summary.status, summary.statusSince, today),
        reviewed: reviewed(review, summary.slug),
      });
    }
    return entries;
  }

  /**
   * Outstanding delegated work, with the quiet ones flagged.
   *
   * `total` counts what is still outstanding; `stale` is the subset the rule
   * flagged. A received item appears in neither — it is settled, and counting
   * it would make the number mean "things I have ever delegated" (FR-039,
   * FR-042).
   *
   * The rule asked is the **same** `waiting.stale.check` a waiting project is
   * put to, with the same threshold. Two subjects, one rule (FR-022c).
   */
  async waitingStep(): Promise<{
    total: number;
    stale: StaleWaitingItem[];
    unreadable: UnreadableLine[];
  }> {
    const items = (await this.waitingService.list()).filter(outstanding);
    const today = localDate(this.clock.now());

    const stale: StaleWaitingItem[] = [];
    for (const item of items) {
      // Asked about when it was last *touched*, not when it started waiting:
      // chasing something is touching it, so a chased item quiets for a while
      // while its total age stays visible (FR-037).
      const since = untouchedSince(item);
      const decision = await this.policy.decide({
        point: "waiting.stale.check",
        subject: "item",
        since,
        today,
      });
      if (decision.verdict === "allow") continue;

      stale.push({ item, reason: decision.reason, days: daysBetween(since, today) ?? 0 });
    }

    // Shown beside the stale set rather than folded into it: these have no
    // owner and no date, so no rule is asked about them and no action is
    // offered. They are here so the user's own words do not go missing from the
    // one view of their delegated work (FR-044).
    return { total: items.length, stale, unreadable: await this.waitingService.unreadable() };
  }

  /**
   * The reviewed week's outcomes and the week ahead's, both live.
   *
   * `reviewed` is editable, because it is the current week and a Friday review
   * is exactly when a straggler gets marked done (FR-048). `ahead` is where
   * next week's commitments land, and it **starts empty**.
   *
   * Nothing is carried forward. An outcome that slipped is not suggested,
   * pre-filled, or ranked into the week ahead — deciding again is the point of
   * the ritual, and a tool that rolled the list forward would let the user stop
   * deciding (FR-053).
   *
   * Reading creates nothing: next week's section appears in the file when the
   * user commits to something, not because they looked.
   */
  async topThreeStep(): Promise<{ reviewed: Week; ahead: Week }> {
    // The reviewed week *is* the writable current one — a review belongs to the
    // week it was started in, and that is the week it is reviewing.
    const { current, ahead } = await this.topThreeService.writableWeeks();
    return { reviewed: current, ahead };
  }

  /**
   * The project to walk next: the first with no record against it.
   *
   * Derived on every read rather than stored. A cursor would be a number that
   * means "the third project", and the third project changes the moment one is
   * parked mid-walk — leaving the user pointed at something they already did,
   * or past something they never saw (research R3).
   */
  async nextProject(): Promise<WalkEntry | null> {
    return (await this.projectStep()).find((entry) => !entry.reviewed) ?? null;
  }

  /**
   * Is this waiting subject stale? Policy's answer, with core's day count.
   *
   * Never asked about a subject whose start date is unknown. Core does not
   * substitute a date to make the question askable — an unknown duration is
   * unknown, and unknown is never stale (FR-094).
   */
  private async staleness(
    status: string,
    since: string | null,
    today: string,
  ): Promise<StaleFlag | null> {
    if (status !== "waiting" || since === null) return null;

    const decision = await this.policy.decide({
      point: "waiting.stale.check",
      subject: "project",
      since,
      today,
    });
    if (decision.verdict === "allow") return null;

    // The reason is the module's own words, passed through untouched. The day
    // count is core's — a fact about two dates, not a rule about them.
    return { reason: decision.reason, days: daysBetween(since, today) ?? 0 };
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  /**
   * Starts this week's review, or resumes it.
   *
   * Idempotent by construction: the file is the state, so a second call finds
   * the first call's file and returns it — including when that review is
   * already complete. A week gets one review (FR-005).
   */
  async start(): Promise<Review> {
    return this.serialize(async () => {
      const week = this.currentWeek();
      const existing = await this.get(week);
      if (existing) return existing;

      const content = renderNewReview(week, localDate(this.clock.now()));
      await this.vault.write(reviewPath(week), content);
      return parseReview(content, week);
    });
  }

  // -------------------------------------------------------------------------
  // Moving through the steps
  // -------------------------------------------------------------------------

  /**
   * Passes the current step and moves to the next.
   *
   * Consults `review.inbox.advance` when leaving the inbox. A `warn` comes back
   * as a refusal the caller may retry with `{ confirmed: true }` — the same
   * flow as Feature 3's open-milestone confirmation, so a client renders both
   * the same way. A `block` cannot be confirmed past.
   */
  async advance(opts?: { confirmed?: boolean }): Promise<ReviewResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const index = REVIEW_STEPS.indexOf(review.step);
      const next = REVIEW_STEPS[index + 1];
      if (next === undefined) {
        return refuse(
          "step-order",
          "This is the last step. Complete the review to finish it.",
        );
      }

      let content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      if (review.step === "inbox") {
        const count = await this.inbox.count();
        const decision = await this.policy.decide({ point: "review.inbox.advance", inboxCount: count });

        if (decision.verdict === "block") {
          return refuse("inbox-not-empty", decision.reason);
        }
        if (decision.verdict === "warn" && opts?.confirmed !== true) {
          // Confirmable, so a client can offer "proceed anyway" rather than a
          // dead end. The reason is the module's own words, passed through.
          return { ok: false, reason: "inbox-not-empty", message: decision.reason, confirmable: true };
        }

        // Recorded once. Revisiting the step and passing it again must not add
        // a second line — the log says what happened, not how many times the
        // user walked past it.
        if (review.inbox === null) {
          content = appendToSection(
            content,
            INBOX_HEADING,
            renderInboxLine(localDate(this.clock.now()), count, decision.verdict),
          );
        }
      }

      await this.vault.write(reviewPath(review.week), setPreambleField(content, "step", next));
      return this.reread(review.week);
    });
  }

  /** Returns to an already-passed step. Records nothing, discards nothing (FR-003). */
  async goTo(step: ReviewStepName): Promise<ReviewResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const target = REVIEW_STEPS.indexOf(step);
      const at = REVIEW_STEPS.indexOf(review.step);
      if (target > at) {
        const pending = REVIEW_STEPS[at];
        return refuse(
          "step-order",
          `The ${label(step)} step comes after ${label(pending ?? "inbox")}, which has not been passed yet.`,
        );
      }

      const content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      await this.vault.write(reviewPath(review.week), setPreambleField(content, "step", step));
      return this.reread(review.week);
    });
  }

  // -------------------------------------------------------------------------
  // Recording what the user decided about a project
  //
  // Every verb here does two things in a fixed order: perform the change
  // **through the service that owns it**, then record what was decided. Never
  // the other way round, and never one without the other — a log line for a
  // write that did not happen is worse than no log at all, because it reads as
  // true (FR-030).
  //
  // None of them touches a project file directly. That is not a convention: the
  // review holds a `ProjectService`, and the only vault path it writes is its
  // own log (contracts/review-api.md).
  // -------------------------------------------------------------------------

  /** Delegates to `ProjectService`. The WIP limit and the confirmation apply identically. */
  async recordStatus(
    slug: string,
    expected: ProjectStatus,
    next: ProjectStatus,
    opts?: { confirmOpenMilestones?: boolean },
  ): Promise<ReviewRecordResult> {
    return this.recordThrough(slug, async () => {
      // Routed to the verb that owns each transition, so the completion date is
      // written on the way to `done` and cleared on the way out of it. Using
      // `setStatus` for all three would silently drop both.
      let outcome;
      if (next === "done") {
        outcome = await this.projectService.complete(slug, {
          confirmOpenMilestones: opts?.confirmOpenMilestones === true,
        });
      } else if (expected === "done") {
        outcome = await this.projectService.reopen(slug, next);
      } else {
        outcome = await this.projectService.setStatus(slug, expected, next);
      }

      if (!outcome.ok) return { refusal: outcome };
      return { heading: PROJECTS_HEADING, action: "status" as const, detail: `${expected} → ${next}` };
    });
  }

  async recordNextAction(
    slug: string,
    expected: string | null,
    next: string | null,
  ): Promise<ReviewRecordResult> {
    return this.recordThrough(slug, async () => {
      const outcome = await this.projectService.setNextAction(slug, expected, next);
      if (!outcome.ok) return { refusal: outcome };

      const detail = next === null ? "cleared" : expected === null ? "set" : "changed";
      return { heading: PROJECTS_HEADING, action: "next-action" as const, detail };
    });
  }

  async recordMilestoneDone(slug: string, ref: MilestoneRef): Promise<ReviewRecordResult> {
    return this.recordThrough(slug, async () => {
      const outcome = await this.projectService.completeMilestone(slug, ref);
      if (!outcome.ok) return { refusal: outcome };

      // The milestone's own words, so the log still means something a year
      // later when the project file has moved on.
      const done = outcome.project.milestones[ref.index]?.definitionOfDone ?? "";
      return { heading: PROJECTS_HEADING, action: "milestone-done" as const, detail: done };
    });
  }

  /** Fixing a gap the walk surfaced, through the field's own verb. */
  async recordStructure(
    slug: string,
    field: "outcome" | "dri" | "next-action",
    expected: string | null,
    next: string | null,
  ): Promise<ReviewRecordResult> {
    if (field === "next-action") return this.recordNextAction(slug, expected, next);

    return this.recordThrough(slug, async () => {
      const outcome =
        field === "outcome"
          ? await this.projectService.setOutcome(slug, expected, next)
          : await this.projectService.setDri(slug, expected, next);

      if (!outcome.ok) return { refusal: outcome };
      return { heading: PROJECTS_HEADING, action: "structure" as const, detail: field };
    });
  }

  /**
   * Adding a milestone to a project the walk flagged as missing them.
   *
   * The cap fires here exactly as it does in the projects window. This is the
   * most likely place for a rule to feel like an obstacle — the user is being
   * *told* the project needs milestones — which is precisely why it must not be
   * the place a rule quietly stops applying (FR-031).
   */
  async recordMilestoneAdded(
    slug: string,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<ReviewRecordResult> {
    return this.recordThrough(slug, async () => {
      const outcome = await this.projectService.addMilestone(slug, definitionOfDone, verifier);
      if (!outcome.ok) return { refusal: outcome };
      return { heading: PROJECTS_HEADING, action: "structure" as const, detail: "milestones" };
    });
  }

  /**
   * "I looked at it and there is nothing to change."
   *
   * A decision, and recorded as one. "I looked and there was nothing to do" and
   * "I never got to it" are different facts about the week, and a resumed
   * review has no other way to tell them apart (FR-033, FR-034).
   */
  async recordNoChange(slug: string): Promise<ReviewRecordResult> {
    return this.recordThrough(slug, async () => {
      const project = await this.projectService.get(slug);
      if (project === null) {
        return {
          refusal: {
            ok: false,
            reason: "not-found",
            message: `No project called "${slug}". Nothing was written.`,
          },
        };
      }
      return { heading: PROJECTS_HEADING, action: "none" as const, detail: null };
    });
  }

  /** Chased. Delegates to `WaitingService`; the item stays outstanding. */
  async recordFollowUp(ref: WaitingRef): Promise<ReviewRecordResult> {
    return this.recordWaiting(ref, "followed-up");
  }

  /** Arrived. Delegates to `WaitingService`; nothing is deleted. */
  async recordReceived(ref: WaitingRef): Promise<ReviewRecordResult> {
    return this.recordWaiting(ref, "received");
  }

  /**
   * A stale subject the user chose to leave alone.
   *
   * Recorded so the log shows it was surfaced and left, rather than looking in
   * hindsight like something the review never reached. **Nothing about the
   * subject changes** — no auto-park, no nudge, not a byte (FR-022b).
   *
   * One verb for both kinds of subject, because "I saw it and left it" is one
   * decision. Which one it is decides only where the line is written and how it
   * reads.
   */
  async recordLeft(ref: WaitingRef | { slug: string }): Promise<ReviewRecordResult> {
    if ("slug" in ref) return this.recordProjectLeft(ref.slug);
    return this.recordWaiting(ref, "none");
  }

  private recordProjectLeft(slug: string): Promise<ReviewRecordResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const summary = (await this.projectService.list()).find((p) => p.slug === slug);
      if (summary === undefined) {
        return refuse("not-found", `No project called "${slug}". Nothing was written.`);
      }

      const today = localDate(this.clock.now());
      const days = summary.statusSince === null ? 0 : (daysBetween(summary.statusSince, today) ?? 0);

      const content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      await this.vault.write(
        reviewPath(review.week),
        appendToSection(content, WAITING_HEADING, renderWaitingProjectLine(today, slug, days)),
      );
      return this.reread(review.week);
    });
  }

  /**
   * The waiting-for counterpart of `recordThrough`: act through the owning
   * service, then record. `none` is the "surfaced and left" case, which writes
   * nothing to `waiting.md` because nothing happened to the item.
   */
  private recordWaiting(
    ref: WaitingRef,
    action: WaitingReviewRecord["action"],
  ): Promise<ReviewRecordResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const before = (await this.waitingService.list())[ref.index];
      const today = localDate(this.clock.now());

      let item = before;
      if (action !== "none") {
        const outcome =
          action === "followed-up"
            ? await this.waitingService.recordFollowUp(ref)
            : await this.waitingService.recordReceived(ref);

        // The owning verb's refusal, mapped onto the review's own vocabulary —
        // both reasons exist in `ReviewRefusal` with the same meaning.
        if (!outcome.ok) return refuse(outcome.reason, outcome.message);
        item = outcome.item;
      }

      if (item === undefined) {
        return refuse("not-found", "That item is no longer in the list. Nothing was written.");
      }

      // The age recorded is how long it had gone untouched **when it was
      // surfaced** — before this action reset the clock. That is what the week
      // is a record of.
      const days = before === undefined ? 0 : (daysBetween(untouchedSince(before), today) ?? 0);

      const content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      await this.vault.write(
        reviewPath(review.week),
        appendToSection(
          content,
          WAITING_HEADING,
          renderWaitingItemLine(today, item.owner, days, action, firstLine(item.text)),
        ),
      );
      return this.reread(review.week);
    });
  }

  // -------------------------------------------------------------------------
  // Completing
  // -------------------------------------------------------------------------

  /**
   * Asks the supplied provider for a draft.
   *
   * `{ available: false }` with no provider — the shipped configuration, and not
   * an error state for a client to render as broken. A provider that throws,
   * hangs, or returns nothing usable yields the same shape with a failure
   * attached: nothing here can prevent a review being completed (FR-111).
   */
  async draftSummary(): Promise<
    { available: false; failure?: string } | { available: true; text: string; provider: string }
  > {
    const provider = this.summaryProvider;
    if (provider === null) return { available: false };

    const review = await this.current();
    if (review === null) return { available: false };

    try {
      const text = await provider.draft(toRecord(review));
      if (text.trim().length === 0) return { available: false };
      return { available: true, text, provider: provider.name };
    } catch (error) {
      return { available: false, failure: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Completes the review.
   *
   * Only what the caller passes in `summary` is recorded. There is no path by
   * which a draft this service produced reaches the file without being handed
   * back, which is what makes acceptance structural rather than a promise
   * (FR-105).
   */
  async complete(input: {
    note?: string | null;
    summary?: { text: string; provider: string };
  }): Promise<ReviewResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const last = REVIEW_STEPS[REVIEW_STEPS.length - 1];
      if (review.step !== last) {
        return refuse(
          "step-order",
          `The ${label(review.step)} step has not been passed yet, so there is more of the review to do.`,
        );
      }

      let content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      // A snapshot of the week as it actually ended, taken once, here. Read
      // rather than accumulated: the user may have marked a straggler done in
      // the projects window five minutes ago, and the log should say so.
      if (review.topThree === null) {
        const { reviewed, ahead } = await this.topThreeStep();
        const lines = renderTopThreeLines({
          finished: reviewed.outcomes.filter((o) => o.done).map((o) => o.text),
          slipped: reviewed.outcomes.filter((o) => !o.done).map((o) => o.text),
          committed: ahead.outcomes.map((o) => o.text),
          forWeek: ahead.id,
        });
        for (const line of lines) content = appendToSection(content, TOP_THREE_HEADING, line);
      }

      const note = (input.note ?? "").trim();
      if (note.length > 0) content = setSectionBody(content, NOTE_HEADING, note);

      const summary = input.summary;
      if (summary !== undefined && summary.text.trim().length > 0) {
        // Its own attributed section, never merged into the note. A reader must
        // always be able to tell whose words are whose (FR-106, FR-107).
        content = setSectionBody(content, summaryHeadingFor(summary.provider), summary.text.trim());
      }

      content = setPreambleField(content, "status", "complete");
      content = setPreambleField(content, "completed", localDate(this.clock.now()));

      await this.vault.write(reviewPath(review.week), content);
      return this.reread(review.week);
    });
  }

  // -------------------------------------------------------------------------
  // Shared machinery
  // -------------------------------------------------------------------------

  private currentWeek(): WeekId {
    return isoWeek(this.clock.now());
  }

  private async contentOf(week: WeekId): Promise<string | null> {
    return this.vault.read(reviewPath(week));
  }

  /** The current week's review, when there is one and it is still open. */
  private async openReview(): Promise<{ review: Review } | { refusal: ReviewResult }> {
    const review = await this.current();
    if (review === null) {
      return {
        refusal: refuse("not-found", "No review has been started for this week."),
      };
    }
    if (review.status === "complete") {
      return {
        refusal: refuse(
          "already-complete",
          `The review for ${review.week} is finished. It is a record now — edit the file directly if you mean to change it.`,
        ),
      };
    }
    return { review };
  }

  /**
   * The shape every project-recording verb shares: open the review, perform the
   * change through its owning service, then append one line.
   *
   * The review is opened **first**, so a completed review refuses before
   * anything is written to a project. Doing the change first and discovering
   * afterwards that there was nowhere to record it would leave exactly the
   * unexplained write the ordering exists to prevent (FR-011).
   */
  private recordThrough(
    slug: string,
    work: () => Promise<
      | { refusal: ProjectRefusal }
      | { heading: string; action: ProjectReviewAction; detail: string | null }
    >,
  ): Promise<ReviewRecordResult> {
    return this.serialize(async () => {
      const open = await this.openReview();
      if ("refusal" in open) return open.refusal;
      const { review } = open;

      const done = await work();
      // The owning verb's refusal, returned exactly as it was given.
      if ("refusal" in done) return done.refusal;

      const content = await this.contentOf(review.week);
      if (content === null) return notFound(review.week);

      const line = renderProjectLine(localDate(this.clock.now()), slug, done.action, done.detail);
      await this.vault.write(
        reviewPath(review.week),
        appendToSection(content, done.heading, line),
      );
      return this.reread(review.week);
    });
  }

  private async reread(week: WeekId): Promise<ReviewResult> {
    const review = await this.get(week);
    return review ? { ok: true, review } : notFound(week);
  }

  /**
   * One write at a time.
   *
   * Every write here is a read-modify-write of one section of one file, so two
   * overlapping calls would both read the same state and the second would
   * silently discard the first. Awaits interleave even on one thread, so the
   * fix has to be an explicit queue rather than careful ordering — the same
   * discipline `TopThreeService` uses.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work, work);
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

// ---------------------------------------------------------------------------

/** Exactly what a provider sees. Nothing outside the review's own record. */
function toRecord(review: Review): ReviewRecord {
  return {
    week: review.week,
    started: review.started,
    inbox:
      review.inbox === null
        ? null
        : { count: review.inbox.count, verdict: review.inbox.verdict, on: review.inbox.on },
    projects: review.projects.map((p) => ({
      slug: p.slug,
      action: p.action,
      detail: p.detail,
      on: p.on,
    })),
    waiting: review.waiting.map((w) => ({
      text: w.text,
      owner: w.owner,
      days: w.days,
      subject: w.subject,
      action: w.action,
      on: w.on,
    })),
    topThree: review.topThree,
    note: review.note,
  };
}

/**
 * Has this project already been decided about in this review?
 *
 * Two places count, because there are two ways to finish with a project: a
 * decision recorded under `## Projects`, or a stale waiting project the user
 * surfaced and left, which the log records under `## Waiting for` beside the
 * items. Missing the second would offer the same project again every time the
 * walk was re-read.
 */
function reviewed(review: Review | null, slug: string): boolean {
  if (review === null) return false;
  return (
    review.projects.some((p) => p.slug === slug) ||
    review.waiting.some((w) => w.subject === "project" && w.owner === slug)
  );
}

/** Enough of an item to recognise it in the log a year later. */
function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function label(step: ReviewStepName): string {
  return step === "top-three" ? "top three" : step === "waiting" ? "waiting-for" : step;
}

function refuse(reason: ReviewRefusal, message: string): ReviewResult {
  return { ok: false, reason, message };
}

function notFound(week: WeekId): ReviewResult {
  return refuse("not-found", `No review for ${week}. Nothing was written.`);
}
