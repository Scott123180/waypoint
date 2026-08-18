/**
 * Dividing one inbox item into several, atomically.
 *
 * Deliberately here rather than in a `SplitService` of its own. A second
 * service would hold the same `InboxDocument`, the same mutex, and a copy of
 * the item-changed verification — which puts two writers on `inbox.md`, the
 * hazard `inbox-mutex.ts` exists to remove (research R7).
 *
 * It takes **strings**, and cannot tell whether they came from a proposal, a
 * user's edit of one, or a client with no intelligence configured at all. That
 * is what makes "no behaviour exists only on the assisted path" a fact about
 * the signature rather than a claim (FR-031).
 *
 * See specs/008-llm-assisted-inbox-organization/contracts/suggestion-api.md
 */

import { serializeItem } from "../inbox/serialize";
import type { ItemRef } from "./decision";

/**
 * Pieces worth writing: blank entries dropped, the rest verbatim.
 *
 * A blank piece among real ones is the user having deleted one before
 * accepting, which is an ordinary edit. *Every* piece blank is a different
 * thing and is refused by the caller (FR-019).
 */
export function usablePieces(pieces: string[]): string[] {
  return pieces.filter((piece) => piece.trim().length > 0);
}

/**
 * The replacement block: each piece as an ordinary inbox item.
 *
 * Written through Feature 1's own serializer, so a piece is byte-identical to
 * what capturing that text at that instant would have produced — including the
 * two-space continuation indent, and including blank lines left blank so a
 * piece spanning one round-trips as a single item (research R10).
 *
 * @param capturedAt the **original item's** capture time, or null for a
 * hand-written line. Never now: stamping a split with the time of the split
 * would rewrite when the user had the thought, and inventing one for a line
 * they typed would claim knowledge the application does not have (FR-016).
 */
export function renderPieces(pieces: string[], capturedAt: Date | null): string {
  return pieces
    .map((text) =>
      capturedAt === null
        ? renderUntimestamped(text)
        : // `id` and `source` are in-memory only and are never serialized, so
          // the values here cannot reach the file. Going through Feature 1's
          // writer rather than reimplementing it is the point.
          serializeItem({ id: "", text, capturedAt, source: "typed" }),
    )
    .join("");
}

/**
 * A hand-written item's pieces carry no timestamp, so they cannot go through
 * `serializeItem`, which always writes one. The continuation shape is the
 * same, because it is the same file format.
 */
function renderUntimestamped(text: string): string {
  const [first = "", ...rest] = text.split("\n");
  let block = `${first}\n`;
  for (const line of rest) block += line.length === 0 ? "\n" : `  ${line}\n`;
  return block;
}

/** The bytes at a ref still say what they said when the item was shown. */
export function bytesUnchanged(onDisk: string, ref: ItemRef): boolean {
  return Buffer.from(onDisk, "utf8").subarray(ref.start, ref.end).toString("utf8") === ref.raw;
}
