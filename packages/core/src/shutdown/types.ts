import type { CalendarItem } from "../calendar/types";
import type { Milestone, ProjectSummary } from "../projects/types";
import type { UnreadableLine, WaitingItem } from "../waiting/types";
import type { Week } from "../weekly/types";

/**
 * What the shutdown screen is, as a value.
 *
 * **Nothing here is stored.** This feature adds no file, no field, no section,
 * no index, no cache, and no migration. Every type below describes a value that
 * exists between `ShutdownService.read()` returning and the window closing, and
 * nowhere else — which is why there is no `openedAt`, no `id`, no `completed`,
 * no `step`, and no `progress`. There is nothing here that could be persisted
 * into a record of a shutdown, because FR-004, FR-005, FR-050 and FR-052 forbid
 * one existing. The type is the enforcement.
 *
 * See specs/009-daily-shutdown/data-model.md
 */

/** A source that could not be read at all. Never a repair, never a guess. */
export interface SourceFailure {
  /** Vault-relative: `top-three.md`, `waiting.md`, `calendar.md`, or `projects/`. */
  path: string;
  /** The underlying error's message, verbatim. Core does not diagnose it. */
  message: string;
}

/**
 * A panel is built or it failed. Never both, never neither.
 *
 * A two-state union rather than an array plus an optional error, because
 * FR-011c requires "nothing here" and "could not read this" to be different
 * answers that read differently — and an array that is empty for both reasons
 * pushes that distinction into whichever renderer remembers it.
 *
 * A *missing* file is not a failure. Absence is the normal first-run case and
 * produces the empty state, never a complaint and never a created file.
 */
export type Panel<T> =
  | { items: T[]; failure: null }
  | { items: []; failure: SourceFailure };

/**
 * Panel 1. The current ISO week, exactly as `TopThreeService.current()` reads it.
 *
 * A two-state union for the same reason `Panel<T>` is one. With `week` and
 * `failure` both inhabited at once, an unreadable `top-three.md` would force a
 * fabricated empty `Week` into the value — a week that reads as "no outcomes
 * set for this week" when the truth is "this file could not be read". FR-011c
 * requires those to be different answers, and FR-009 forbids inventing the week
 * to make the shape work.
 *
 * The week is carried whole rather than flattened: `Outcome` already holds
 * `text`, `done`, `completedOn`, and `raw`, and `raw` is what `OutcomeRef` needs
 * to verify a write. FR-014's "show open and done together" is therefore the
 * absence of a filter rather than the presence of one, and FR-016's "no other
 * week" is structural — there is one `Week` here and no verb that takes another.
 */
export type TopThreePanel =
  | { week: Week; failure: null }
  | { week: null; failure: SourceFailure };

/** Panel 2. One active project whose DRI resolves to the user. */
export interface MyProject {
  summary: ProjectSummary;
  /** Verbatim, or null when the project records none. Never inferred (FR-021). */
  nextAction: string | null;
  /** Open milestones only — what can be marked done from here (FR-022). */
  openMilestones: Milestone[];
}

/** Panel 3. A waiting-for item the rule flagged. */
export interface StaleWaiting {
  item: WaitingItem;
  /** Policy's words, passed through untouched. Never composed by a client. */
  reason: string;
  /** Days since last touched. Core's count of two dates, not a rule about them. */
  untouchedDays: number;
  /** Days since `since`. What tells "chased weekly for months" from "forgotten". */
  waitingDays: number;
}

/** Panel 4. A calendar flag the same rule flagged. */
export interface StaleCalendar {
  item: CalendarItem;
  reason: string;
  /** Days since flagged. The only age a flag has. */
  unscheduledDays: number;
}

/** The whole screen, read at one moment. */
export interface ShutdownView {
  /**
   * The local date the screen was read. Every age below is measured against it.
   *
   * A field, not a call: it is taken once at the top of `read()`, so the date
   * changing while the window is open changes nothing, because nothing
   * recomputes.
   */
  today: string;

  topThree: TopThreePanel;
  projects: Panel<MyProject>;
  waiting: Panel<StaleWaiting>;
  calendar: Panel<StaleCalendar>;

  /** Lines the grammar could not read, surfaced rather than dropped (FR-032). */
  unreadableWaiting: UnreadableLine[];
  unreadableCalendar: UnreadableLine[];

  /**
   * The policy module's complaints about its own configuration, if any.
   *
   * A notice, never a refusal: a malformed `staleness days` is reported for
   * display, the documented default applies for that value alone, and the user
   * keeps working (FR-030).
   */
  policyNotices: string[];
}
