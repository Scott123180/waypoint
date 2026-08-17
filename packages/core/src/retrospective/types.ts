import type { LedgerEntry, ProjectStatus } from "../projects/types";
import type { AcceptedSummary, WaitingReviewRecord } from "../review/types";
import type { WeekId } from "../weekly/types";

/**
 * The shapes the retrospective is expressed in.
 *
 * Every one of these is **produced, never stored**. This feature has no on-disk
 * representation and no format contract: a retrospective is an answer assembled
 * from files Features 3, 4, and 5 already write, and it is discarded when the
 * window closes. That is why there is nothing here to migrate.
 *
 * See specs/006-retrospective-view/data-model.md
 */

/** Both endpoints inclusive, as local calendar dates (FR-001, FR-002). */
export interface DateRange {
  /** `YYYY-MM-DD`. */
  from: string;
  /** `YYYY-MM-DD`. Never earlier than `from`; a range that is, is refused (FR-003). */
  to: string;
}

export interface RetrospectiveQuery {
  range: DateRange;
  /**
   * A project slug to narrow to, or null for the whole range (FR-030).
   *
   * The slug rather than a title, because the slug is the identity every other
   * verb in the repo uses and a title can be edited between two readings.
   */
  project: string | null;
}

export type CompletionKind = "milestone" | "project";

/**
 * One thing recorded as finished.
 *
 * Milestones and projects share a shape because they share a section, an
 * ordering, and a rendering; `kind` is what a reader needs and all that differs.
 */
export interface Completion {
  kind: CompletionKind;
  /**
   * What was finished, verbatim: a milestone's definition of done, or a
   * project's title. Never reworded, never truncated.
   */
  text: string;
  /** The project this belongs to — its own slug when `kind` is "project" (FR-007). */
  projectSlug: string;
  /** The project's title as it currently reads. A renamed project shows its new name. */
  projectTitle: string;
  /**
   * The recorded completion date, when it parses as `YYYY-MM-DD` (FR-006).
   *
   * null for every entry in `undated` and never anything else — an unparseable
   * date lives in `rawDate` and leaves this null, so no consumer can mistake
   * "2026-13-45" for a date by reading this field (FR-018).
   */
  completedOn: string | null;
  /**
   * What was actually written where the date goes, when it is not a date.
   *
   * null when `completedOn` is set, and null when nothing was written at all.
   * Present only for the third case: something is there and it is not a date.
   * Shown verbatim so the user can find it in an editor (FR-018).
   */
  rawDate: string | null;
  /** Position within its project, for the tie-break. -1 for a project completion. */
  index: number;
}

export interface OutcomeCompletion {
  /** The week it was **committed to**, not the week it was finished in (FR-011). */
  week: WeekId;
  /** Verbatim as committed to. */
  text: string;
  /** Present iff this is in the dated set; null in `undatedOutcomes` (FR-013). */
  completedOn: string | null;
  rawDate: string | null;
  /** Position within its week, for a stable order within the group. */
  index: number;
}

export interface OutcomeWeekGroup {
  week: WeekId;
  /** File order within the week, which is entry order. */
  outcomes: OutcomeCompletion[];
}

/**
 * What one week's log says.
 *
 * Read from the log and never reconciled against current data (FR-023). The
 * fields carried from `review/types.ts` are carried whole rather than mapped,
 * which is what leaves nowhere to put a recomputed value.
 */
export interface WeekNarrative {
  week: WeekId;
  /** Monday and Sunday, so a partially covered week is legible as such (FR-028). */
  span: DateRange;
  /** As the log records it. An unfinished review is shown, not hidden (FR-026). */
  status: "in-progress" | "complete";
  /**
   * The user's own words, verbatim, or null when the log records none.
   *
   * null here and *absence from the list* are different facts: this week has a
   * log and wrote no note; a week in `unreviewed` has no log at all (FR-025).
   */
  note: string | null;
  /** The reviewed week's outcomes the log recorded as not done (FR-022). */
  slipped: string[];
  /** Stale items and projects the log recorded, and what the user did (FR-022). */
  waiting: WaitingReviewRecord[];
  /** An accepted draft with its attribution intact, or null (FR-027). */
  summary: AcceptedSummary | null;
}

export interface UnreviewedWeeks {
  /** Every week overlapping the range with no log, ascending. Named, not merely counted. */
  weeks: WeekId[];
  /** How many weeks the range overlaps in total, so the proportion needs no arithmetic (FR-024b). */
  weeksInRange: number;
}

export interface Narrative {
  /** Weeks with a log, newest first. */
  weeks: WeekNarrative[];
  /**
   * Always present, even when `weeks` is empty.
   *
   * An empty list says "none were missed"; an absent section says nothing at
   * all, and the two must not look alike (FR-024d).
   */
  unreviewed: UnreviewedWeeks;
}

/**
 * A section with no meaning under a project filter (FR-032, FR-033).
 *
 * Neither a weekly outcome nor a week's note carries a project association
 * anywhere in the data, so under a filter there is no honest way to show them:
 * showing them unfiltered implies an association that does not exist, and
 * showing an empty list implies the user committed to nothing. The third option
 * is to say why — and the union is what makes rendering an omitted section as
 * an empty one impossible, because there is no array to iterate.
 */
export type ProjectScoped<T> = { applies: true; value: T } | { applies: false; reason: string };

export interface ProjectHistory {
  slug: string;
  title: string;
  /** What the project says it is. Not reconciled with the ledger (FR-041). */
  status: ProjectStatus;
  /**
   * The project's ledger, verbatim and in file order (FR-037).
   *
   * `LedgerEntry` carried through unmapped. There is deliberately no field a
   * derived duration could occupy: `afterDays` is the ledger's own and is
   * already null wherever the record is silent, which is what makes FR-039's
   * "unknown, never computed" structural rather than a rule to remember.
   */
  entries: LedgerEntry[];
}

/**
 * Something that could not be read, surfaced rather than dropped (FR-020).
 *
 * The deliberate analogue of `UnreadableLine` in `waiting/types.ts`, widened by
 * a path because this feature reads several files rather than one.
 */
export interface UnreadableSource {
  /** Vault-relative, so the user can open the offending file. */
  path: string;
  /** 1-based, matching the editor gutter. null when the whole file is the problem. */
  line: number | null;
  /** Exactly as it sits on disk. Never rewritten. */
  raw: string;
  reason: UnreadableReason;
}

/**
 * Two reasons, both real, and neither a guess about the cause.
 *
 * The report prints this value and the raw line and stops there — diagnosing a
 * line is the user's job in their editor, and a report that speculated would be
 * editorializing about the user's data (FR-053).
 */
export type UnreadableReason =
  /** A file in `log/` whose name is not a week identifier — a hand-made copy. */
  | "not-a-week-file"
  /** A line in an in-range week section that is not blank, a heading, or an outcome. */
  | "unreadable-line";

export interface Retrospective {
  /** Echoed back, so an export separated from the app still says what it covers (FR-010). */
  query: RetrospectiveQuery;
  /** The project's current title when narrowed, for the header. null otherwise. */
  projectTitle: string | null;

  /** Dated, in range, ordered. Complete — never capped or sampled (FR-006a). */
  completions: Completion[];
  /** Marked done, no readable date. Cannot be placed in the range (FR-016, FR-017). */
  undated: Completion[];

  outcomes: ProjectScoped<OutcomeWeekGroup[]>;
  undatedOutcomes: ProjectScoped<OutcomeCompletion[]>;
  narrative: ProjectScoped<Narrative>;

  /** Only under a project filter (FR-036, FR-036a). */
  history: ProjectHistory | null;

  /** Surfaced, never dropped (FR-020). Empty in the ordinary case. */
  unreadable: UnreadableSource[];
}

/**
 * Why a retrospective verb refused. Refusals are values a caller renders.
 *
 * There is deliberately no `not-found`: narrowing to a slug with no file yields
 * an empty reading, not an error. A project the user picked from a list and
 * which then vanished is an empty answer (FR-034).
 */
export type RetrospectiveRefusal =
  /** An endpoint is not a `YYYY-MM-DD` local calendar date. */
  | "invalid-date"
  /** `to` is earlier than `from` (FR-003). */
  | "range-inverted";

export type RetrospectiveResult =
  | { ok: true; retrospective: Retrospective }
  | { ok: false; reason: RetrospectiveRefusal; message: string };
