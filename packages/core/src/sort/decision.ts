/**
 * The full space of what a user may choose when sorting an item.
 *
 * See specs/002-inbox-view-sort/contracts/sort-api.md
 */

/** Identifies the item a decision applies to. Opaque to clients. */
export interface ItemRef {
  /** Byte offset where the item was when we showed it. */
  start: number;
  /** Byte offset where it ended. */
  end: number;
  /** What it said. The verification key (FR-020a). */
  raw: string;
}

/**
 * A discriminated union, so an invalid combination cannot be constructed —
 * there is no way to express "trash, with an owner".
 *
 * There is deliberately no `skip`, no `defer`, and no `suggestedBy` field. The
 * absence of the last one is what makes FR-030 structural: Feature 7 can call
 * `sort()` with a human-confirmed decision, but has nowhere to record that a
 * machine proposed it, because that would be the first step toward acting on
 * one.
 */
export type SortDecision =
  | { to: "project"; slug: string }
  | { to: "project"; createTitle: string }
  | { to: "area"; slug: string }
  | { to: "area"; createTitle: string }
  | { to: "waiting"; owner: string }
  | { to: "calendar" }
  | { to: "trash" };

export type SortRefusal =
  /** Inbox bytes no longer match the ref (FR-020b). */
  | "item-changed"
  /** The chosen project or area is gone from disk (FR-020c). */
  | "destination-missing"
  /** Create title empty, or slugs to empty (FR-011). */
  | "empty-title"
  /** Waiting-for owner empty (FR-014). */
  | "empty-owner"
  /**
   * A split was asked for with no piece that has anything in it (008 FR-019).
   *
   * Refused rather than treated as a delete: emptying an item by proposing
   * nothing would be the one destructive thing that path could do, and
   * discarding already has a verb.
   */
  | "empty-pieces"
  /** I/O failure; nothing was committed. */
  | "write-failed";

export type SortOutcome =
  | { ok: true; destination: string }
  | { ok: false; reason: SortRefusal; message: string };

/** One item as a client sees it. */
export interface InboxItemView {
  text: string;
  /** null for a hand-written item; clients must show no timestamp, not today's. */
  capturedAt: Date | null;
  ref: ItemRef;
}

/** A project or area the user can route to. */
export interface DestinationRef {
  slug: string;
  title: string;
  kind: "project" | "area";
}

export interface RecoveryReport {
  /** Journal entries finished. */
  completed: number;
  /** Entries cleared because the inbox no longer matched; may leave a duplicate. */
  abandoned: number;
}

/** A decision that asks for its destination to be created first. */
export type CreateDecision =
  | { to: "project"; createTitle: string }
  | { to: "area"; createTitle: string };

export function isCreateDecision(decision: SortDecision): decision is CreateDecision {
  return (decision.to === "project" || decision.to === "area") && "createTitle" in decision;
}
