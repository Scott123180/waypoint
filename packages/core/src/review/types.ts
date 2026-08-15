import type { DecisionVerdict } from "../ports/index";
import type { Milestone, ProjectOutcome, ProjectSummary } from "../projects/types";
import type { WaitingItem } from "../waiting/types";
import type { WeekId } from "../weekly/types";

/**
 * The shapes the weekly review is expressed in.
 *
 * See specs/005-weekly-review-ritual/data-model.md
 */

/** The four steps, in the order they are walked (FR-001). */
export const REVIEW_STEPS = ["inbox", "projects", "waiting", "top-three"] as const;

export type ReviewStepName = (typeof REVIEW_STEPS)[number];

/** What the user did to one project in one review. `none` is a decision (FR-034). */
export type ProjectReviewAction =
  | "none"
  | "status"
  | "next-action"
  | "milestone-done"
  | "structure";

export interface ProjectReviewRecord {
  slug: string;
  action: ProjectReviewAction;
  /** Specifics: `active → parked`, the milestone's text, the field named. */
  detail: string | null;
  on: string;
  /** The source line, so a hand-written record survives a rewrite of others. */
  raw: string;
}

export interface InboxStepRecord {
  /** Count at the moment the step was passed. Derived then, recorded now. */
  count: number;
  /**
   * The verdict the user passed under.
   *
   * `block` never appears: a blocked step is not passed, so it is never
   * recorded (contracts/review-log-format.md).
   */
  verdict: DecisionVerdict;
  on: string;
  raw: string;
}

export interface WaitingReviewRecord {
  /** Enough of the item to identify it in the log a year later. */
  text: string;
  /** The item's owner, or the project's slug when the subject is a project. */
  owner: string;
  /** Days untouched when it was surfaced. */
  days: number;
  subject: "item" | "project";
  action: "followed-up" | "received" | "none";
  on: string;
  raw: string;
}

export interface TopThreeStepRecord {
  /** The reviewed week's outcomes as they stood when the step was passed. */
  finished: string[];
  slipped: string[];
  /** What was committed to for the week ahead. Empty is valid (FR-052). */
  committed: string[];
  /** The week those commitments landed in — the review's week + 1. */
  forWeek: WeekId | null;
}

export interface AcceptedSummary {
  text: string;
  /** The provider's own name, for attribution (FR-106). */
  provider: string;
}

/** One guided pass over the user's commitments, belonging to exactly one week. */
export interface Review {
  week: WeekId;
  /** Local date the review was started. The anchor `nextWeek` is computed from. */
  started: string;
  /**
   * The step the user is on.
   *
   * Stored, unlike the walk position, because a step can pass having decided
   * nothing — an empty waiting-for list — and "passed with no decisions" is
   * otherwise indistinguishable from "not reached" (research R3).
   */
  step: ReviewStepName;
  status: "in-progress" | "complete";
  /** Local date of completion, present iff complete. */
  completed: string | null;
  inbox: InboxStepRecord | null;
  projects: ProjectReviewRecord[];
  waiting: WaitingReviewRecord[];
  topThree: TopThreeStepRecord | null;
  /** The user's own words. Never generated (FR-100). */
  note: string | null;
  /** An accepted draft, attributed. Absent unless a provider ran and was accepted. */
  summary: AcceptedSummary | null;
}

/** Enough to list a past review without parsing all of it. */
export interface ReviewSummary {
  week: WeekId;
  started: string;
  status: "in-progress" | "complete";
  completed: string | null;
}

/** Why a review verb refused. Refusals are values a caller renders. */
export type ReviewRefusal =
  /** The inbox gate is configured to block and the inbox is not empty. */
  | "inbox-not-empty"
  /** A step was reached before an earlier one was passed, or completion before the end. */
  | "step-order"
  /** Any write against a completed review (FR-011). */
  | "already-complete"
  /** The referenced item changed on disk since it was shown. */
  | "entry-changed"
  /** No such review, project, or item. */
  | "not-found";

export type ReviewResult =
  | { ok: true; review: Review }
  | { ok: false; reason: ReviewRefusal; message: string; confirmable?: boolean };

/** Whatever the owning verb said when it refused. Never reworded (FR-030). */
export type ProjectRefusal = Extract<ProjectOutcome, { ok: false }>;

/**
 * A recording verb's answer.
 *
 * Either the review as it now stands, or a refusal — from the review itself, or
 * from the verb that owns the change, **verbatim**. Passing the project's own
 * refusal straight through is what makes the parity tests possible: the WIP
 * limit's message, its named subjects, and the open-milestone confirmation all
 * reach the user in exactly the form they take outside the review. A wrapper
 * type that flattened them would be the review quietly holding its own opinion
 * about what a refusal means.
 */
export type ReviewRecordResult =
  | { ok: true; review: Review }
  | Extract<ReviewResult, { ok: false }>
  | ProjectRefusal;

/**
 * One outstanding item the staleness rule flagged.
 *
 * The item is carried whole — its owner, its text, the date it started waiting,
 * and every follow-up already recorded — because all of that is what the user
 * needs to decide whether to chase again (FR-040).
 */
export interface StaleWaitingItem {
  item: WaitingItem;
  /** Policy's own words, day count included. */
  reason: string;
  /** Days untouched when it was surfaced. Core's fact, beside policy's verdict. */
  days: number;
}

/** Policy's answer about one waiting subject, ready to render (FR-022a). */
export interface StaleFlag {
  /** The module's own words, day count included. Never composed by core. */
  reason: string;
  /** Days untouched. Core's fact, beside policy's verdict. */
  days: number;
}

/**
 * One project as the walk presents it.
 *
 * `summary` is what a list row needs; the three fields beside it are what a
 * *decision* needs — you cannot judge whether a project is still worth doing
 * from its title and a milestone count. All of it comes from the same single
 * read of the file (FR-023).
 */
export interface WalkEntry {
  project: ProjectSummary;
  outcome: string | null;
  nextAction: string | null;
  milestones: Milestone[];
  /** Present only for a `waiting` project the staleness rule flagged. */
  stale: StaleFlag | null;
  /** Whether this project already has a record in this review (research R3). */
  reviewed: boolean;
}
