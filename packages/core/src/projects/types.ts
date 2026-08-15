import type { ResolvedDri } from "../identity/types";

/**
 * The shapes project and area work is expressed in.
 *
 * Plain data, produced by parsing a file and consumed by pure functions —
 * which is what keeps the rules testable without a filesystem.
 *
 * See specs/003-project-structure/data-model.md
 */

/** A project's lifecycle state. Exactly one at a time (FR-002). */
export type ProjectStatus = "active" | "parked" | "waiting" | "done";

/**
 * An area's lifecycle state.
 *
 * Its own union rather than a subset alias of `ProjectStatus`, so `done` cannot
 * reach an area through a widening assignment. An area is an ongoing
 * responsibility: it has no end state to reach, and no deliverable to be
 * blocked on (FR-041, FR-041a).
 */
export type AreaStatus = "active" | "parked";

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["active", "parked", "waiting", "done"];
export const AREA_STATUSES: readonly AreaStatus[] = ["active", "parked"];

/** What a project is missing before it can actually be worked (FR-018). */
export type StructureGap = "outcome" | "milestones" | "next-action";

/** One verifiable step toward a project's outcome. */
export interface Milestone {
  /** Position within the project, 0-based. Part of its identity. */
  index: number;
  /** What finishing it means. Verbatim, never inferred from the outcome (FR-011). */
  definitionOfDone: string;
  /** Who confirms it. null when not yet named. May be the user (FR-012). */
  verifier: string | null;
  done: boolean;
  /** Local calendar date, present iff `done` (FR-033, FR-033a). */
  completedOn: string | null;
  /** The full source line, for verification on write. */
  raw: string;
}

/**
 * A milestone's identity: position plus text.
 *
 * The deliberate analogue of sort's `ItemRef { start, end, raw }`. A milestone
 * reworded in a text editor fails verification rather than being written over
 * (FR-045b, FR-045d). No id is embedded in the file — machine bookkeeping does
 * not belong in a document whose promise is hand-editability (research R2).
 */
export interface MilestoneRef {
  index: number;
  /** The line exactly as the caller was shown it. */
  raw: string;
}

/** A raw item sort routed into a project or area, not yet turned into structure. */
export interface UnprocessedItem {
  /** Item text, verbatim, continuation lines included. */
  text: string;
  /** null for a hand-written item; no date is ever substituted. */
  capturedAt: Date | null;
  /** Position within `## Unprocessed`, 0-based. */
  index: number;
  /** Full source block, for verification on dismissal. */
  raw: string;
}

/** A named container of work with a finite end state. */
export interface Project {
  /** Filename stem. The identity every verb uses. */
  slug: string;
  /** The `#` heading, verbatim as typed. Never derived from the slug. */
  title: string;
  status: ProjectStatus;
  /** null when not set — never an empty string, so absent has one representation. */
  outcome: string | null;
  nextAction: string | null;
  dri: string | null;
  /** Empty when none have been added. Order is file order (FR-015). */
  milestones: Milestone[];
  /** Local date, set only while `status` is `done` (FR-034, FR-036). */
  completedOn: string | null;
  /** Items sort left behind, in file order (FR-046). */
  unprocessed: UnprocessedItem[];
}

/**
 * An ongoing responsibility with no end state.
 *
 * Structurally incapable of holding an outcome, milestones, a next action, a
 * DRI, or a completion date — not by validation, but by having nowhere to put
 * them. A client cannot ask an area whether it is complete, because the
 * question does not typecheck (FR-040, FR-041a).
 */
export interface Area {
  slug: string;
  title: string;
  status: AreaStatus;
  /**
   * The status exactly as stored, when a hand-edit put something outside
   * `AreaStatus` there. Shown as read, never silently rewritten (FR-041c).
   */
  rawStatus: string;
  unprocessed: UnprocessedItem[];
}

/** Enough to render a project in a list without opening it (FR-031). */
export interface ProjectSummary {
  slug: string;
  title: string;
  status: ProjectStatus;
  milestonesDone: number;
  milestonesTotal: number;
  /** Empty means fully structured. Computed on read, never stored (FR-020). */
  gaps: StructureGap[];
  completedOn: string | null;
  /**
   * Who the DRI is, relative to the user (Feature 4, FR-020a).
   *
   * Derived on every read from this project's DRI, the identity configuration,
   * and the names on every other project — which is why it is computed by the
   * service rather than by `summarize` alone.
   */
  dri: ResolvedDri;
  /**
   * No DRI named (Feature 4, FR-032).
   *
   * Deliberately **not** a fourth `StructureGap`. Adding one would silently
   * reverse Feature 3's FR-009 and newly flag every otherwise-complete project
   * that happens to have no owner. Informational, never blocking.
   */
  needsDri: boolean;
}

export interface AreaSummary {
  slug: string;
  title: string;
  status: AreaStatus;
  rawStatus: string;
}

/** Why a verb refused. Refusals are values a caller renders, not errors. */
export type RefusalReason =
  /** The slug no longer exists on disk. */
  | "not-found"
  /** That field changed since it was shown (FR-045b). */
  | "field-changed"
  /** A fifth milestone (FR-013). */
  | "milestone-cap"
  /** Needs confirmation; `open` names the still-open milestones (FR-034a). */
  | "open-milestones"
  /** A title must always be present and non-empty (FR-003). */
  | "empty-title"
  /** A milestone needs a definition of done. */
  | "empty-value"
  /** Activating this would exceed the work-in-progress limit (Feature 4, FR-044). */
  | "wip-limit";

export type ProjectOutcome =
  | { ok: true; project: Project }
  | {
      ok: false;
      reason: RefusalReason;
      message: string;
      /** The still-open milestones. Set only for `open-milestones` (FR-034a). */
      open?: string[];
      /**
       * Named items to act on. Set only for `wip-limit` (Feature 4, FR-046).
       *
       * Deliberately **not** a reuse of `open`. That field means "the still-open
       * milestones" and nothing else, and a client already renders it as a
       * confirmation list — overloading it would show a WIP block as an offer to
       * complete the very project the user was trying to activate. Two meanings,
       * two fields.
       */
      subjects?: string[];
    };

export type AreaOutcome =
  | { ok: true; area: Area }
  | { ok: false; reason: RefusalReason; message: string };

/** Which scalar field a caller is setting. */
export type ProjectField = "outcome" | "next-action" | "dri" | "title";
