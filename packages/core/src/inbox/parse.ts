/**
 * Reading `inbox.md` back into items — the inverse of `serialize.ts`.
 *
 * The user is expected to hand-edit this file, so the parser has no "invalid
 * input" category: every line with text is a routable item (FR-027). That is
 * what lets a hand-assembled inbox reach zero, and it is also what keeps this
 * simple enough to trust.
 *
 * See specs/002-inbox-view-sort/contracts/inbox-parse.md
 */

export interface ParsedItem {
  /** Content, continuation lines rejoined with "\n". Verbatim. */
  text: string;
  /** Capture time, or null for a line the user typed by hand (FR-027a). */
  capturedAt: Date | null;
  /** Byte offset where the block begins. */
  start: number;
  /** Byte offset just past the block's trailing newline. */
  end: number;
  /** The exact bytes in [start, end), for commit-time verification. */
  raw: string;
}

const CONTINUATION_INDENT = "  ";

/**
 * `- <ISO 8601 with offset> <text>`, seconds precision.
 *
 * Deliberately strict: anything that does not match exactly becomes a
 * hand-written item rather than an error, so a near-miss is still sortable.
 */
const CAPTURED_LINE =
  /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})) (.*)$/;

function parseTimestamp(raw: string): Date | null {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  // `new Date` accepts out-of-range components by rolling them over
  // ("2026-13-45" becomes 2027-02-14), which would silently invent a capture
  // time for a line the user mistyped. Round-tripping the components back out
  // rejects anything that did not survive verbatim.
  const [datePart, timePart] = raw.split("T");
  const [y, mo, d] = (datePart ?? "").split("-").map(Number);
  const [h, mi, s] = (timePart ?? "").slice(0, 8).split(":").map(Number);
  if (
    mo === undefined || d === undefined || h === undefined || mi === undefined || s === undefined ||
    mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59
  ) {
    return null;
  }
  // Guard against day-of-month overflow for the specific month (e.g. Feb 30).
  const check = new Date(date.getTime());
  if (y !== undefined && check.getFullYear() !== y && check.getUTCFullYear() !== y) return null;

  return date;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Splits into lines while remembering each line's byte offset.
 *
 * Offsets are byte-based because removal is a byte splice and multi-byte
 * characters make character indices wrong in exactly the files people care
 * most about not corrupting.
 */
interface Line {
  text: string;
  start: number;
  /** Just past this line's newline, or EOF for a final unterminated line. */
  end: number;
}

function toLines(doc: string): Line[] {
  const lines: Line[] = [];
  // Measured once. Both of these were previously computed inside the loop —
  // `Buffer.byteLength(doc)` walks the whole document, so paying for it per
  // line made parsing quadratic: 16,000 items took 1.7s, and each doubling of
  // the input cost ~4x the time. Neither value changes as the loop runs.
  const docBytes = Buffer.byteLength(doc, "utf8");
  let offset = 0;

  for (const raw of doc.split("\n")) {
    const byteLen = Buffer.byteLength(raw, "utf8");
    const withNewline = offset + byteLen < docBytes;
    lines.push({
      text: raw,
      start: offset,
      end: offset + byteLen + (withNewline ? 1 : 0),
    });
    offset += byteLen + 1;
  }

  // `split` produces a trailing empty string for a document ending in "\n";
  // it is not a line, just the end of the last one.
  const last = lines[lines.length - 1];
  if (last && last.text === "" && lines.length > 1) lines.pop();

  return lines;
}

export function parseInbox(doc: string): ParsedItem[] {
  if (doc.length === 0) return [];

  const buf = Buffer.from(doc, "utf8");
  const items: ParsedItem[] = [];
  let current: { capturedAt: Date | null; lines: string[]; start: number; end: number } | null =
    null;

  const flush = (): void => {
    if (!current) return;
    items.push({
      text: current.lines.join("\n"),
      capturedAt: current.capturedAt,
      start: current.start,
      end: current.end,
      raw: buf.subarray(current.start, current.end).toString("utf8"),
    });
    current = null;
  };

  const lines = toLines(doc);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (isBlank(line.text)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j]!.text)) j++;
      const next = lines[j];

      // A blank line followed by an indented line is *interior* to the item:
      // that is exactly what serialize.ts writes for a dictated thought with a
      // paragraph break, and splitting there would turn one thought into two
      // items with the second losing its timestamp. It is also ordinary
      // markdown lazy continuation.
      if (current && next && next.text.startsWith(CONTINUATION_INDENT)) {
        for (let k = i; k < j; k++) current.lines.push("");
        current.end = lines[j - 1]!.end;
        i = j;
        continue;
      }

      // Otherwise the blank line belongs to no item, so removing an item
      // leaves the user's spacing exactly as they arranged it.
      flush();
      i = j;
      continue;
    }

    i += 1;
    const captured = CAPTURED_LINE.exec(line.text);
    const timestamp = captured ? parseTimestamp(captured[1] ?? "") : null;

    if (captured && timestamp) {
      flush();
      current = {
        capturedAt: timestamp,
        lines: [captured[2] ?? ""],
        start: line.start,
        end: line.end,
      };
      continue;
    }

    if (current && line.text.startsWith(CONTINUATION_INDENT)) {
      current.lines.push(line.text.slice(CONTINUATION_INDENT.length));
      current.end = line.end;
      continue;
    }

    // Anything else with text is a hand-written item: a note, a heading, a
    // list line whose timestamp did not parse, or an indented line with no
    // item above it.
    flush();
    current = {
      capturedAt: null,
      lines: [line.text.startsWith(CONTINUATION_INDENT) ? line.text.trimStart() : line.text],
      start: line.start,
      end: line.end,
    };
  }

  flush();
  return items;
}

/** True when the inbox holds no routable text — blank lines do not count. */
export function isInboxEmpty(doc: string): boolean {
  return parseInbox(doc).length === 0;
}
