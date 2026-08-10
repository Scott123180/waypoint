import type { InboxStore } from "../ports/index";

export interface UndoToken {
  itemId: string;
  /** The exact block the core handed to the store. */
  serializedBlock: string;
  /** File length in bytes before the append, and the truncation target. */
  offsetBefore: number;
}

export type UndoOutcome = { ok: true } | { ok: false; reason: "file-changed" };

/**
 * Undo by verified truncation.
 *
 * The file's tail must still be exactly what we appended before anything is
 * removed. If it is not — the user hand-edited the file, or another capture
 * landed after ours — this refuses rather than deleting content it cannot
 * account for. Refusal is recoverable; a wrong deletion is not.
 */
export async function performUndo(store: InboxStore, token: UndoToken): Promise<UndoOutcome> {
  const size = await store.size();

  const writtenLength = size - token.offsetBefore;
  if (writtenLength <= 0) {
    return { ok: false, reason: "file-changed" };
  }

  const tail = await store.readTail(writtenLength);

  // The store prepends a newline when the existing file lacked a trailing one,
  // so the bytes on disk may legitimately be one character longer than the
  // block we produced. Truncating to offsetBefore removes that fix-up too,
  // restoring the file exactly as the user had it.
  const matches = tail === token.serializedBlock || tail === `\n${token.serializedBlock}`;
  if (!matches) {
    return { ok: false, reason: "file-changed" };
  }

  await store.truncate(token.offsetBefore);
  return { ok: true };
}
