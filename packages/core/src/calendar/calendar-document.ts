import { parseInbox } from "../inbox/parse";
import type { UnreadableLine } from "../waiting/types";
import type { CalendarItem } from "./types";

/**
 * Reading `calendar.md`.
 *
 * ```text
 * item-line    := "- " flagged-on " — " [capture-timestamp " "] text
 * continuation := "  " anything-else
 * ```
 *
 * **The line is Feature 2's, unchanged.** `calendarLine()` — the writer — stays
 * where it has always been, in `vault/lists.ts`, owned by sorting. This module
 * reads that line and nothing else.
 *
 * **There is no write function here, and that is the point.** No append, no
 * line renderer, no `CalendarRef`, no service class. It is a parser and a type,
 * which is the strongest available form of FR-031 ("MUST NOT read from, write
 * to, or contact any external or system calendar") and FR-042 ("presented as
 * information only… no scheduling, no dismissing, and no writing back"). There
 * is no verb here to misuse, and adding one would be a visible edit to a file
 * whose header says why it has none.
 *
 * The same two rules as `waiting-document.ts`, whose grammar this deliberately
 * mirrors: parsing never fails, and nothing is ever repaired.
 *
 * See specs/009-daily-shutdown/contracts/calendar-format.md
 */

/** Vault-relative path. */
export const CALENDAR_PATH = "calendar.md";

const INDENT = "  ";

/**
 * The em dash is U+2014 with one space either side, matching `waiting.md`.
 *
 * The date is captured by shape rather than validated. A malformed or future
 * date is not evidence of neglect: it is carried verbatim, `daysBetween` yields
 * null or a negative, and the staleness rule answers `allow` (FR-029a). Core
 * never substitutes a date to make the question askable.
 */
const ITEM = /^- (\d{4}-\d{2}-\d{2}) — (.*)$/;

/**
 * Every well-formed item in file order, and every line that is not one.
 *
 * One function returning both, rather than the pair `waiting.md` has, because
 * `waiting.md` had two callers wanting different halves and this file has one
 * caller wanting both — and FR-011a permits exactly one read per opening.
 *
 * A line the grammar cannot read is not removed and not rewritten. It stays
 * exactly where the user put it, and comes back here with the 1-based line
 * number their editor shows in the gutter: "something in calendar.md does not
 * parse" sends them hunting, "line 14 does not parse" sends them to line 14.
 */
export function readCalendar(content: string): {
  items: CalendarItem[];
  unreadable: UnreadableLine[];
} {
  const lines = content.split("\n");
  const items: CalendarItem[] = [];
  const unreadable: UnreadableLine[] = [];

  let open: { block: string[]; flaggedOn: string; rest: string } | null = null;

  const flush = (): void => {
    if (open === null) return;

    // Everything after the item line is the user's own continuation. Its
    // indentation is list syntax rather than something they typed, so it comes
    // off — exactly as `waiting-document.ts` does it.
    const textLines = open.block
      .slice(1)
      .map((line) => (line.startsWith(INDENT) ? line.slice(INDENT.length) : line));

    // The item's own text goes through the inbox parser, so a capture timestamp
    // is read the same way it is everywhere else in the vault.
    const parsed = parseInbox(`- ${open.rest}`)[0];

    items.push({
      index: items.length,
      flaggedOn: open.flaggedOn,
      text: [parsed?.capturedAt ? parsed.text : open.rest.trim(), ...textLines].join("\n"),
      capturedAt: parsed?.capturedAt ?? null,
      raw: open.block.join("\n"),
    });
    open = null;
  };

  for (const [at, line] of lines.entries()) {
    const item = ITEM.exec(line);
    if (item) {
      flush();
      open = { block: [line], flaggedOn: item[1] ?? "", rest: item[2] ?? "" };
      continue;
    }

    // A line that starts a new list item but is not a well-formed one ends the
    // current block rather than being absorbed into it — otherwise a malformed
    // line would silently become part of the item above.
    if (/^-\s/.test(line)) {
      flush();
      unreadable.push({ line: at + 1, raw: line });
      continue;
    }

    if (open !== null && line.trim().length > 0) {
      open.block.push(line);
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }

    // Non-blank, not a list item, and no item open above it to belong to.
    unreadable.push({ line: at + 1, raw: line });
  }
  flush();

  return { items, unreadable };
}
