/**
 * The shapes delegated work is expressed in.
 *
 * Feature 2 wrote `waiting.md` and defined its item line. This feature adds
 * nothing to that line and everything below it: a history of what has happened
 * since, as nested list items.
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

/** Something that happened to a delegated item. Accumulates; never replaced. */
export interface WaitingAction {
  kind: "followed-up" | "received";
  /** Local calendar date. */
  on: string;
}

/** One line of `waiting.md`, with its continuations and its history. */
export interface WaitingItem {
  /** Position in the file, 0-based. Part of its identity. */
  index: number;
  /**
   * Date it started waiting.
   *
   * Preserved forever and never rewritten, including by a follow-up. Total age
   * is what tells "chased weekly for three months" from "delegated on Tuesday"
   * (FR-043a).
   */
  since: string;
  owner: string;
  /** Item text, continuation lines rejoined with newlines. Verbatim. */
  text: string;
  /** Original capture time, or null for a hand-written line. Never substituted. */
  capturedAt: Date | null;
  /** Follow-ups and receipt, in file order. */
  actions: WaitingAction[];
  /** The full source block — item line plus its continuations and actions. */
  raw: string;
}

/**
 * A line of a running list this feature's grammar cannot read.
 *
 * Widened from "a line of `waiting.md`" by Feature 9, which reads `calendar.md`
 * with the same grammar and the same promise. One shape rather than two
 * identical ones: a second copy would be free to drift, and the difference
 * would show up as one surface numbering lines from zero.
 *
 * Carried rather than discarded so a surface can show it exactly as it reads
 * (FR-044). It has no owner and no date, so there is nothing to be stale about
 * and nothing to act on — it is shown so the user can fix it in their editor,
 * which is the only place it will ever be fixed. The system never rewrites it.
 */
export interface UnreadableLine {
  /** 1-based, so it matches what the user's editor shows in the gutter. */
  line: number;
  /** The line exactly as it sits on disk. */
  raw: string;
}

/**
 * An item's identity: position plus the exact block.
 *
 * The deliberate analogue of `MilestoneRef` and `OutcomeRef`. An item reworded
 * in a text editor fails verification rather than being written over, and no id
 * is embedded in the file — machine bookkeeping does not belong in a document
 * whose promise is hand-editability.
 */
export interface WaitingRef {
  index: number;
  /** The block exactly as the caller was shown it. */
  raw: string;
}

/** Why a waiting verb refused. Refusals are values a caller renders. */
export type WaitingRefusalReason =
  /** The block changed on disk since it was shown. */
  | "entry-changed"
  /** No `waiting.md`, or nothing at that position. */
  | "not-found";

export type WaitingOutcome =
  | { ok: true; item: WaitingItem }
  | { ok: false; reason: WaitingRefusalReason; message: string };
