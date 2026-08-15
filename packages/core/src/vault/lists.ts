import { formatTimestamp } from "../inbox/serialize";

/**
 * Line formats for the three running lists: waiting.md, calendar.md, trash.md.
 *
 * All three reuse the inbox's item grammar wherever text appears, so the same
 * thought is recognizable wherever it lands.
 *
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */

const CONTINUATION_INDENT = "  ";

/** What a routed item carries into a destination. */
export interface RoutableItem {
  text: string;
  /** null for a hand-written item; no date is ever substituted (FR-027a). */
  capturedAt: Date | null;
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/**
 * A local calendar date, `YYYY-MM-DD`.
 *
 * Local rather than UTC because staleness is judged against the user's day:
 * something flagged at 23:30 on Tuesday was flagged on Tuesday, even though
 * UTC has already moved on.
 */
export function localDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whole days from one local calendar date to another, or null if either is not
 * one.
 *
 * One definition, because two would disagree. The ledger writes "after 74d
 * waiting" and the staleness rule says "this has been waiting 74 days" — the
 * same duration, computed from the same two dates, told to the user twice. A
 * second implementation that rounded differently would be a bug nobody could
 * see until the two numbers appeared on the same screen.
 *
 * Compared as UTC midnights deliberately. These are calendar dates, not
 * instants: the number of days between the 1st and the 8th is seven whether or
 * not the clocks changed in between, and doing the arithmetic in local time
 * makes a DST boundary lose or gain a day.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = LOCAL_DATE.exec(from.trim());
  const b = LOCAL_DATE.exec(to.trim());
  if (!a || !b) return null;

  const utc = (m: RegExpExecArray): number =>
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/**
 * Renders the item's text with continuation lines indented, matching the inbox
 * grammar so a multi-line thought still renders correctly in its destination.
 */
function body(item: RoutableItem): string {
  const [first = "", ...rest] = item.text.split("\n");
  const prefix = item.capturedAt ? `${formatTimestamp(item.capturedAt)} ` : "";

  let out = `${prefix}${first}`;
  for (const line of rest) {
    out += line.length === 0 ? "\n" : `\n${CONTINUATION_INDENT}${line}`;
  }
  return out;
}

/**
 * `- <waiting-since> @<owner> — [<capture-timestamp> ]<text>`
 *
 * The date is what makes a later staleness check possible without the user
 * supplying anything more (FR-013, FR-015).
 */
export function waitingLine(item: RoutableItem, owner: string, now: Date): string {
  return `- ${localDate(now)} @${owner} — ${body(item)}`;
}

/**
 * `- <flagged-on> — [<capture-timestamp> ]<text>`
 *
 * Deliberately shaped like a waiting-for line: "flagged but never scheduled"
 * is the same staleness problem as "delegated but never returned". No event
 * date, time, or duration is recorded — this is a marker, not a calendar
 * entry (FR-017, FR-017a).
 */
export function calendarLine(item: RoutableItem, now: Date): string {
  return `- ${localDate(now)} — ${body(item)}`;
}

/**
 * `- <discarded-on> — [<capture-timestamp> ]<text>`
 *
 * Trash is a soft delete: sorting is fast and has no undo, so the text stays
 * recoverable by hand (FR-016).
 */
export function trashLine(item: RoutableItem, now: Date): string {
  return `- ${localDate(now)} — ${body(item)}`;
}
