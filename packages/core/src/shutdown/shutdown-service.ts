import { CALENDAR_PATH, readCalendar } from "../calendar/calendar-document";
import { POLICY_PATH, parsePolicyConfig } from "../policy/policy-config";
import type { Clock, PolicyModule, VaultStore } from "../ports/index";
import type { Project, ProjectSummary } from "../projects/types";
import { daysBetween, localDate } from "../vault/lists";
import { outstanding, untouchedSince } from "../waiting/derive";
import type { UnreadableLine, WaitingItem } from "../waiting/types";
import { WAITING_PATH } from "../waiting/waiting-service";
import { TOP_THREE_PATH } from "../weekly/top-three-service";
import type { Week } from "../weekly/types";
import type {
  MyProject,
  Panel,
  ShutdownView,
  SourceFailure,
  StaleCalendar,
  StaleWaiting,
  TopThreePanel,
} from "./types";

/**
 * The single entry point for the daily shutdown: one verb, `read()`.
 *
 * Four readings taken at one moment, composed into one value. The habits are
 * the ones every other service here follows — injected ports, every read fresh,
 * nothing cached — plus three that are this feature's own:
 *
 *   - **It cannot write.** Not by convention: `vault` is
 *     `Pick<VaultStore, "read">`, so `write` and `appendLine` do not typecheck,
 *     and the three service dependencies are structural read-only shapes rather
 *     than the services that satisfy them. The byte-for-byte test is a
 *     regression net over something the compiler already holds (FR-053, SC-002).
 *
 *   - **It performs no action of its own.** Everything the screen offers is a
 *     verb that already exists, called by the client through the channel the
 *     ordinary surface uses. So this service cannot diverge from a validation, a
 *     refusal, a ledger write, or a policy consultation, because it is not
 *     executing any of them (FR-037, FR-038, FR-039).
 *
 *   - **It generates nothing.** There is no intelligence, suggestion, or
 *     summary dependency — absent rather than accepted-and-unused, so a future
 *     contributor who wanted to generate something here would have to change
 *     this constructor, which is a visible edit (FR-009, and the discipline
 *     Feature 6 set for `policy`).
 *
 * There is no on-disk representation anywhere in this feature: no daily log, no
 * state file, no record of shutdowns run or skipped, and no notion of a day
 * outside `today` below, which exists only for the length of one call.
 *
 * See specs/009-daily-shutdown/contracts/shutdown-api.md
 */

/**
 * Just the part of `ProjectService` this reads.
 *
 * Structural rather than `Pick<ProjectService, "listDetailed">` so that a test
 * can satisfy it without standing up identity resolution, and so that adding a
 * write here would mean widening a declared shape. `ProjectService` satisfies it
 * by construction — the same discipline `RetrospectiveService` follows.
 */
export interface ProjectSource {
  listDetailed(): Promise<ReadonlyArray<{ project: Project; summary: ProjectSummary }>>;
}

/** Just the part of `TopThreeService` this reads. */
export interface TopThreeSource {
  current(): Promise<Week>;
}

/** Just the part of `WaitingService` this reads — both halves, from one read. */
export interface WaitingSource {
  read(): Promise<{ items: WaitingItem[]; unreadable: UnreadableLine[] }>;
}

export interface ShutdownServiceDeps {
  projects: ProjectSource;
  topThree: TopThreeSource;
  waiting: WaitingSource;
  /** `calendar.md` only. `write` and `appendLine` do not typecheck. */
  vault: Pick<VaultStore, "read">;
  /** Consulted for staleness. Never for a write, because none is reachable. */
  policy: PolicyModule;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export class ShutdownService {
  private readonly projects: ProjectSource;
  private readonly topThree: TopThreeSource;
  private readonly waiting: WaitingSource;
  private readonly vault: Pick<VaultStore, "read">;
  private readonly policy: PolicyModule;
  private readonly clock: Clock;

  constructor(deps: ShutdownServiceDeps) {
    this.projects = deps.projects;
    this.topThree = deps.topThree;
    this.waiting = deps.waiting;
    this.vault = deps.vault;
    this.policy = deps.policy;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * The whole screen, read at one moment. **Never rejects.**
   *
   * Each panel is built inside its own `try`/`catch`, so a source that cannot be
   * read produces a `SourceFailure` on its own panel and nothing else: the other
   * three are built, returned, and remain fully actionable (FR-011b). Nothing is
   * repaired, recreated, rewritten, or emptied, and no file is created by being
   * looked for (FR-011c).
   *
   * `today` is taken **once**, here, and every day count in the returned value is
   * measured against it. The date changing while the window is open changes
   * nothing, because nothing recomputes.
   */
  async read(): Promise<ShutdownView> {
    const today = localDate(this.clock.now());

    const topThree = await this.readTopThree();
    const projects = await this.readProjects();
    const waiting = await this.readWaiting(today);
    const calendar = await this.readCalendar(today);
    const policyNotices = await this.readPolicyNotices();

    return {
      today,
      topThree,
      projects,
      waiting: waiting.panel,
      calendar: calendar.panel,
      unreadableWaiting: waiting.unreadable,
      unreadableCalendar: calendar.unreadable,
      policyNotices,
    };
  }

  // -------------------------------------------------------------------------
  // Panel 1 — the current week's top three
  // -------------------------------------------------------------------------

  /**
   * The current ISO week, whole, exactly as `TopThreeService.current()` reads it.
   *
   * Carried whole rather than flattened, and unfiltered: FR-014's "show open and
   * done together" is the *absence* of a filter, and FR-016's "no other week" is
   * structural — there is one `Week` here and no verb that takes another.
   *
   * A week with no section is an empty `Week`, not a failure. Nothing is
   * proposed, carried forward, or written to make the file exist.
   */
  private async readTopThree(): Promise<TopThreePanel> {
    try {
      return { week: await this.topThree.current(), failure: null };
    } catch (err) {
      return { week: null, failure: failureAt(TOP_THREE_PATH, err) };
    }
  }

  // -------------------------------------------------------------------------
  // Panel 2 — active projects the user is the DRI for
  // -------------------------------------------------------------------------

  /**
   * Active, and mine. Both halves are core's existing answers.
   *
   * `status` is the project's own field and `dri.resolution` is what
   * `resolveDri` already worked out against the whole vault — `unassigned` and
   * `ambiguous` are not the user, and nothing here guesses the human behind them
   * (FR-018, FR-019, SC-007).
   *
   * The next action and the open milestones come from the **same pass**: the
   * project body is already in hand, so reaching back to the vault per project
   * would be the quadratic path `listDetailed` exists to avoid.
   *
   * An unreadable file inside `projects/` fails this panel as a whole, named as
   * `projects/` rather than by file: `ProjectService.readAll` propagates the
   * error, and naming the individual file would mean changing a shipped service's
   * read loop whose blast radius is every caller of `list`, `listActive`,
   * `getResolved` and `overLimitState`. FR-011b's substance is met either way —
   * the shutdown still opens and the other three panels stay actionable.
   */
  private async readProjects(): Promise<Panel<MyProject>> {
    try {
      const detailed = await this.projects.listDetailed();

      const items = detailed
        .filter((d) => d.summary.status === "active" && d.summary.dri.resolution === "mine")
        .map((d) => ({
          summary: d.summary,
          // Verbatim, or null. There is no branch in which this could be
          // derived, because there is nothing to derive it from (FR-021).
          nextAction: d.project.nextAction,
          // Open only: these are what can be marked done from here (FR-022).
          openMilestones: d.project.milestones.filter((m) => !m.done),
        }));

      return { items, failure: null };
    } catch (err) {
      return { items: [], failure: failureAt("projects/", err) };
    }
  }

  // -------------------------------------------------------------------------
  // Panel 3 — delegated work that has gone quiet
  // -------------------------------------------------------------------------

  /**
   * Outstanding items the rule flagged, in file order.
   *
   * Asked about when the item was last **touched**, not when it started waiting:
   * chasing something is touching it, so an item chased yesterday is not
   * neglected however long it has been outstanding (FR-026). Both numbers are
   * carried, because FR-027 wants them on screen at once, and both come from the
   * same `today`, so they cannot disagree.
   *
   * The reason is policy's words, passed through untouched. A client composing
   * that sentence from the day count would be holding domain vocabulary.
   */
  private async readWaiting(
    today: string,
  ): Promise<{ panel: Panel<StaleWaiting>; unreadable: UnreadableLine[] }> {
    try {
      const { items, unreadable } = await this.waiting.read();

      const stale: StaleWaiting[] = [];
      for (const item of items) {
        if (!outstanding(item)) continue;

        const since = untouchedSince(item);
        const decision = await this.policy.decide({
          point: "waiting.stale.check",
          subject: "item",
          since,
          today,
        });
        if (decision.verdict === "allow") continue;

        stale.push({
          item,
          reason: decision.reason,
          untouchedDays: daysBetween(since, today) ?? 0,
          waitingDays: daysBetween(item.since, today) ?? 0,
        });
      }

      return { panel: { items: stale, failure: null }, unreadable };
    } catch (err) {
      return { panel: { items: [], failure: failureAt(WAITING_PATH, err) }, unreadable: [] };
    }
  }

  // -------------------------------------------------------------------------
  // Panel 4 — thoughts flagged for the calendar and never scheduled
  // -------------------------------------------------------------------------

  /**
   * The same rule, the same threshold, a third subject.
   *
   * A missing `calendar.md` is the empty state and creates nothing: a vault
   * gains this file by sorting something into it, never by being looked at
   * (FR-011c).
   *
   * Nothing here can act on what it lists. There is no ref, no verb, and no
   * channel — calendar items are information only (FR-042).
   */
  private async readCalendar(
    today: string,
  ): Promise<{ panel: Panel<StaleCalendar>; unreadable: UnreadableLine[] }> {
    try {
      const content = await this.vault.read(CALENDAR_PATH);
      if (content === null) return { panel: { items: [], failure: null }, unreadable: [] };

      const { items, unreadable } = readCalendar(content);

      const stale: StaleCalendar[] = [];
      for (const item of items) {
        const decision = await this.policy.decide({
          point: "waiting.stale.check",
          subject: "calendar",
          since: item.flaggedOn,
          today,
        });
        if (decision.verdict === "allow") continue;

        stale.push({
          item,
          reason: decision.reason,
          unscheduledDays: daysBetween(item.flaggedOn, today) ?? 0,
        });
      }

      return { panel: { items: stale, failure: null }, unreadable };
    } catch (err) {
      return { panel: { items: [], failure: failureAt(CALENDAR_PATH, err) }, unreadable: [] };
    }
  }

  // -------------------------------------------------------------------------
  // The policy module's complaints about its own configuration
  // -------------------------------------------------------------------------

  /**
   * What the policy module has to say about its own settings, if anything.
   *
   * **Only `problems`.** Every other field of the parsed configuration is
   * discarded on the line below, and that is deliberate: core must not learn a
   * threshold or make a comparison, which is what reading `stalenessDays` here
   * would mean (Principle V, and the boundary `project-scope-boundaries.test.ts`
   * draws for `ProjectService`).
   *
   * Read here rather than harvested from a decision because FR-030 wants the
   * notice whether or not a rule fires — the review surfaces the same complaint
   * from its inbox step for the same reason, and a screen with nothing stale on
   * it would otherwise never mention a typo the user needs to fix.
   *
   * A notice, never a refusal. An unreadable `policy.md` costs the user nothing
   * but the value it was setting: the documented default applies for that value
   * alone, and everything else they set deliberately survives.
   */
  private async readPolicyNotices(): Promise<string[]> {
    try {
      const { problems } = parsePolicyConfig(await this.vault.read(POLICY_PATH), {
        withProblems: true,
      });
      return problems;
    } catch {
      // A `policy.md` that cannot be read at all is silence, not a complaint:
      // every rule falls back to its documented default and the screen works.
      return [];
    }
  }
}

/** The underlying error's message, verbatim. Core does not diagnose it. */
function failureAt(path: string, err: unknown): SourceFailure {
  return { path, message: err instanceof Error ? err.message : String(err) };
}
