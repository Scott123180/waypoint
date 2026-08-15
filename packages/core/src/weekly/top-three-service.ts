import type { Clock, PolicyModule, VaultStore } from "../ports/index";
import { createDefaultPolicy } from "../policy/default-policy";
import { localDate } from "../vault/lists";
import { isoWeek } from "./iso-week";
import {
  parseTopThree,
  renderOutcome,
  setWeekLines,
  weekLines,
  type OutcomeFields,
} from "./top-three-document";
import type { Outcome, OutcomeRef, TopThreeOutcomeResult, TopThreeRefusal, Week, WeekId } from "./types";

/**
 * The single entry point for the weekly top three.
 *
 * Two habits, both inherited from `ProjectService` so a user meets the same
 * behaviour everywhere (Principle VII):
 *
 *   - **Every read is fresh.** No cursor, no cache. `current` is derived from
 *     the clock each time it is asked, so a week cannot go stale in a file
 *     because the app was left open over a weekend.
 *
 *   - **Every write verifies its own entry first.** The caller passes the line
 *     it was shown; if the file now says something else, the write is refused
 *     and nothing is touched. Refusals are values a caller renders, not errors
 *     thrown (FR-015a, FR-015b).
 *
 * See specs/004-top-three-wip-limit/contracts/top-three-api.md
 */

export const TOP_THREE_PATH = "top-three.md";

export interface TopThreeServiceDeps {
  vault: VaultStore;
  clock?: Clock;
  /** Defaults to the single shipped module — absent means rules, not no rules. */
  policy?: PolicyModule;
}

const systemClock: Clock = { now: () => new Date() };

export class TopThreeService {
  private readonly vault: VaultStore;
  private readonly clock: Clock;
  private readonly policy: PolicyModule;
  /** Tail of the write queue. See `serialize`. */
  private writes: Promise<void> = Promise.resolve();

  constructor(deps: TopThreeServiceDeps) {
    this.vault = deps.vault;
    this.clock = deps.clock ?? systemClock;
    this.policy = deps.policy ?? createDefaultPolicy(deps.vault);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The week the clock is in. Empty rather than absent when never set. */
  async current(): Promise<Week> {
    const id = this.currentWeek();
    const weeks = await this.read();
    return weeks.find((w) => w.id === id) ?? { id, outcomes: [], current: true };
  }

  /**
   * Every week on file, newest first, with the current week always present.
   *
   * Sorted here rather than trusted from the file: identifiers sort
   * chronologically as text by construction, and a hand-edited file may hold
   * them in any order. Including the current week even when it has no section
   * keeps "this week" from vanishing from the record before it is filled in.
   */
  async history(): Promise<Week[]> {
    const id = this.currentWeek();
    const weeks = await this.read();
    if (!weeks.some((w) => w.id === id)) {
      weeks.push({ id, outcomes: [], current: true });
    }
    return weeks.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Records a new outcome for the current week.
   *
   * The only verb that consults policy: editing, completing, removing and
   * reopening cannot take a week over its maximum.
   */
  async addOutcome(text: string): Promise<TopThreeOutcomeResult> {
    const clean = text.trim();
    if (clean.length === 0) {
      return refuse("empty-value", "An outcome needs some text. Nothing was added.");
    }

    return this.serialize(async () => {
      const week = await this.current();
      const decision = await this.policy.decide({
        point: "week.outcome.record",
        week: week.id,
        outcomeCount: week.outcomes.length,
      });
      if (decision.verdict === "block") {
        return refuse("outcome-cap", decision.reason);
      }

      const lines = [
        ...week.outcomes.map((o) => o.raw),
        renderOutcome({ text: clean, done: false, completedOn: null }),
      ];
      return this.writeWeek(week.id, lines);
    });
  }

  async editOutcome(ref: OutcomeRef, text: string): Promise<TopThreeOutcomeResult> {
    const clean = text.trim();
    if (clean.length === 0) {
      return refuse("empty-value", "An outcome needs some text. Nothing was changed.");
    }
    return this.rewrite(ref, (o) => ({ text: clean, done: o.done, completedOn: o.completedOn }));
  }

  async removeOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult> {
    return this.serialize(async () => {
      const check = await this.verify(ref);
      if ("refusal" in check) return check.refusal;

      const lines = check.week.outcomes.filter((o) => o.index !== ref.index).map((o) => o.raw);
      return this.writeWeek(ref.week, lines);
    });
  }

  /** Records the date automatically. No prompt, ever. */
  async completeOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult> {
    return this.rewrite(ref, (o) => ({
      text: o.text,
      done: true,
      completedOn: localDate(this.clock.now()),
    }));
  }

  async reopenOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult> {
    return this.rewrite(ref, (o) => ({ text: o.text, done: false, completedOn: null }));
  }

  // -------------------------------------------------------------------------
  // Shared machinery
  // -------------------------------------------------------------------------

  private currentWeek(): WeekId {
    return isoWeek(this.clock.now());
  }

  private async read(): Promise<Week[]> {
    const content = await this.vault.read(TOP_THREE_PATH);
    const id = this.currentWeek();
    return parseTopThree(content).map((w) => ({ ...w, current: w.id === id }));
  }

  /**
   * Verify one entry, then write.
   *
   * The comparison is against a freshly read file, never a copy from when the
   * view opened, and it covers only the entry being written. An unrelated
   * hand-edit elsewhere in the same week is preserved and folded in —
   * cancelling an edit to one outcome because another changed would be a
   * refusal the user cannot act on (FR-015c).
   */
  private async verify(
    ref: OutcomeRef,
  ): Promise<{ week: Week; outcome: Outcome } | { refusal: TopThreeOutcomeResult }> {
    if (ref.week !== this.currentWeek()) {
      return {
        refusal: refuse(
          "past-week",
          "That week is a record and is not edited here. Change it in the file directly if you mean to.",
        ),
      };
    }

    const week = await this.current();
    const outcome = week.outcomes[ref.index];
    if (!outcome || outcome.raw !== ref.raw) {
      const now = outcome ? `It now reads: ${outcome.text}` : "It is no longer there.";
      return {
        refusal: refuse(
          "entry-changed",
          `That outcome changed on disk since it was shown, so nothing was written. ${now}`,
        ),
      };
    }
    return { week, outcome };
  }

  private async rewrite(
    ref: OutcomeRef,
    change: (o: Outcome) => OutcomeFields,
  ): Promise<TopThreeOutcomeResult> {
    return this.serialize(async () => {
      const check = await this.verify(ref);
      if ("refusal" in check) return check.refusal;

      const lines = check.week.outcomes.map((o) =>
        o.index === ref.index ? renderOutcome(change(o)) : o.raw,
      );
      return this.writeWeek(ref.week, lines);
    });
  }

  /**
   * One write at a time.
   *
   * Every write here is read-modify-write over a whole week's section, so two
   * overlapping calls both read the same state and the second silently discards
   * the first. That is not hypothetical: pressing Enter twice quickly in the
   * add box loses an outcome, with nothing shown to say so — the exact silent
   * data loss the plain-text format exists to make impossible.
   *
   * Awaits interleave even on one thread, so the fix has to be an explicit
   * queue rather than careful ordering. The same discipline `InboxMutex` gives
   * the inbox, kept here in the service because that is where the compose step
   * lives. Cross-process races remain the adapter's problem, as they already
   * are for project files.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work, work);
    // Keep the chain alive after a rejection, without swallowing it.
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Replaces one week's body, preserving the blank lines around it. */
  private async writeWeek(week: WeekId, lines: string[]): Promise<TopThreeOutcomeResult> {
    const content = await this.vault.read(TOP_THREE_PATH);
    const existing = weekLines(content, week);
    await this.vault.write(TOP_THREE_PATH, setWeekLines(content, week, reflow(existing, lines)));

    const written = (await this.read()).find((w) => w.id === week);
    return { ok: true, week: written ?? { id: week, outcomes: [], current: week === this.currentWeek() } };
  }
}

// ---------------------------------------------------------------------------

/**
 * Keeps the section's surrounding blank lines exactly as they were.
 *
 * A section body is `["", ...outcomes, ""]` when the app wrote it, but a
 * hand-shaped file may have no blank line, or three. Reproducing whatever is
 * already there is what stops an edit showing up in `git diff` as whitespace
 * churn the user did not make.
 */
function reflow(existing: string[], outcomes: string[]): string[] {
  const leading: string[] = [];
  for (const line of existing) {
    if (line.trim().length > 0) break;
    leading.push(line);
  }

  const trailing: string[] = [];
  for (let i = existing.length - 1; i >= leading.length; i--) {
    const line = existing[i] ?? "";
    if (line.trim().length > 0) break;
    trailing.unshift(line);
  }

  // Anything in the section that is not an outcome — prose the user typed —
  // sits between the outcomes and is preserved after them.
  const kept = existing
    .slice(leading.length, existing.length - trailing.length)
    .filter((l) => l.trim().length > 0 && !/^- \[[ xX]\] /.test(l));

  const head = leading.length > 0 ? leading : [""];
  const tail = trailing.length > 0 ? trailing : [""];
  return [...head, ...outcomes, ...kept, ...tail];
}

function refuse(reason: TopThreeRefusal, message: string): TopThreeOutcomeResult {
  return { ok: false, reason, message };
}
