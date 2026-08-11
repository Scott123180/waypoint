import type { JournalEntry } from "../ports/index";
import type { ItemRef, SortDecision } from "./decision";

/**
 * The write-ahead journal that makes a two-file commit effectively-once.
 *
 * POSIX cannot update two files atomically, so a decision records its intent
 * first and the next launch finishes whatever was in flight. A crash leaves a
 * duplicate only until relaunch; steady state is never both and never neither
 * (FR-020, FR-020d).
 *
 * See specs/002-inbox-view-sort/research.md R2
 */

export interface SortJournalEntry extends JournalEntry {
  ref: ItemRef;
  decision: SortDecision;
}

export function newEntry(
  id: string,
  ref: ItemRef,
  decision: SortDecision,
  now: Date,
): SortJournalEntry {
  return {
    id,
    ref,
    decision,
    destinationWritten: false,
    startedAt: now.toISOString(),
  };
}

/**
 * What recovery should do with a pending entry.
 *
 * Expressed as a pure decision because that is the part worth testing
 * exhaustively; the I/O around it is trivial by comparison (research R10).
 */
export type RecoveryAction =
  /** The destination write never confirmed; redo it, then remove from the inbox. */
  | { do: "write-destination-then-remove" }
  /** The destination is already written; just finish the inbox removal. */
  | { do: "remove-from-inbox" }
  /**
   * The item is no longer where the entry says it was. It is already safe in
   * its destination, so clear the entry rather than guessing. The worst case
   * is a visible duplicate, never a loss.
   */
  | { do: "abandon"; why: string };

export function planRecovery(entry: SortJournalEntry, inbox: string): RecoveryAction {
  const buf = Buffer.from(inbox, "utf8");
  const actual = buf.subarray(entry.ref.start, entry.ref.end).toString("utf8");
  const stillThere = actual === entry.ref.raw;

  if (!entry.destinationWritten) {
    // The destination write is idempotent by entry id, so redoing it is safe
    // whether or not it partially happened.
    return stillThere
      ? { do: "write-destination-then-remove" }
      : {
          do: "abandon",
          why: "the item is no longer in the inbox at the recorded position",
        };
  }

  if (!stillThere) {
    // Destination written and the item already gone from the inbox: this is
    // simply a completed decision whose journal entry was never cleared.
    return { do: "abandon", why: "the decision had already completed" };
  }

  return { do: "remove-from-inbox" };
}
