/**
 * The shapes weekly commitment is expressed in.
 *
 * See specs/004-top-three-wip-limit/data-model.md
 */

/** ISO-8601 week identifier, `YYYY-Www` — e.g. "2026-W33" (FR-003, FR-003a). */
export type WeekId = string;

/** One outcome the user committed to for a week. */
export interface Outcome {
  /** Position within its week, 0-based. Part of its identity. */
  index: number;
  /** Verbatim as typed. Never generated, suggested, or ranked (FR-016). */
  text: string;
  done: boolean;
  /** Local calendar date, present iff `done` (FR-009, FR-010). */
  completedOn: string | null;
  /** The full source line, for verification on write. */
  raw: string;
}

/** One week's commitment. */
export interface Week {
  id: WeekId;
  /** File order, which is entry order. */
  outcomes: Outcome[];
  /** Whether this is the week the clock is in. Derived, never stored. */
  current: boolean;
  /**
   * Whether this week may be written (Feature 5, FR-049a).
   *
   * The window is the current week and the next one. Here rather than left to
   * a client to work out, because "which weeks may I edit" is a rule: a
   * renderer computing it would be a client holding one, and a later API would
   * have to reimplement the same arithmetic to agree (Principle II).
   */
  writable: boolean;
}

/**
 * An outcome's identity: week, position, and text.
 *
 * The deliberate analogue of `MilestoneRef`. No id is embedded in the file —
 * machine bookkeeping does not belong in a document whose promise is
 * hand-editability (research R8).
 */
export interface OutcomeRef {
  week: WeekId;
  index: number;
  /** The line exactly as the caller was shown it. */
  raw: string;
}

/** Why a top-three verb refused. Refusals are values a caller renders. */
export type TopThreeRefusal =
  /** That outcome changed on disk since it was shown (FR-015b). */
  | "entry-changed"
  /** The week is at its configured maximum (FR-004). */
  | "outcome-cap"
  /** Text is empty or whitespace-only (FR-005). */
  | "empty-value"
  /**
   * That week is behind the writable window (FR-013).
   *
   * Unchanged by Feature 5's widening: a past week is a record, and the
   * refusal is what makes it one.
   */
  | "past-week"
  /**
   * That week is beyond the writable window (Feature 5, FR-049b).
   *
   * The window is this week and the next, so a review run on a Friday can
   * commit to the week ahead. Its own reason rather than a reuse of
   * `past-week`, because the two are different mistakes and the messages have
   * to say different things.
   */
  | "future-week";

export type TopThreeOutcomeResult =
  | { ok: true; week: Week }
  | { ok: false; reason: TopThreeRefusal; message: string };
