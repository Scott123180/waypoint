/**
 * Cutting an item's text into numbered segments.
 *
 * This is the whole basis of the verbatim guarantee (research R3). The model is
 * shown the segments numbered and answers with numbers; core slices the
 * original to build each piece. Text that is not the user's cannot be emitted,
 * because text from the response is never handled.
 *
 * The one property that has to hold is **totality**: every character of the
 * item belongs to exactly one segment, whitespace included, so that
 *
 *   segments.map(s => text.slice(s.start, s.end)).join("") === text
 *
 * byte for byte. Where the boundaries actually fall is a heuristic and is
 * allowed to be imperfect — a poor boundary produces a coarser proposal, never
 * a wrong one, because coverage is arithmetic over indices either way.
 */

/** One span of the item. Carries no text: there is one original, and this points into it. */
export interface Segment {
  /** 0-based, in file order. This is what the model names. */
  index: number;
  /** Character offset where the span begins. */
  start: number;
  /** Character offset just past its end. */
  end: number;
}

const TERMINATORS = new Set([".", "!", "?"]);

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * The partition.
 *
 * Boundaries fall after a sentence terminator followed by whitespace — the
 * whitespace run belonging to the segment it follows — and after every
 * newline. A terminator with no whitespace after it is not a boundary, which
 * is what keeps `3.50` in one piece.
 */
export function segment(text: string): Segment[] {
  if (text.length === 0) return [];

  const segments: Segment[] = [];
  let start = 0;

  const cut = (end: number): void => {
    if (end <= start) return;
    segments.push({ index: segments.length, start, end });
    start = end;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;

    if (TERMINATORS.has(ch) && isWhitespace(text[i + 1])) {
      // Consume the whole whitespace run so it stays with the sentence it
      // follows. Cutting before it would put a leading space on the next
      // piece, which the user would see in an item they never typed that way.
      let end = i + 1;
      while (end < text.length && isWhitespace(text[end])) end++;
      cut(end);
      i = end - 1;
      continue;
    }

    if (ch === "\n") cut(i + 1);
  }

  // Whatever trails the last boundary — including an unterminated final
  // sentence, or nothing but whitespace.
  cut(text.length);

  return segments;
}

/** The segments as strings. For tests and for building a request's numbered list. */
export function segmentTexts(text: string): string[] {
  return segment(text).map((s) => text.slice(s.start, s.end));
}
