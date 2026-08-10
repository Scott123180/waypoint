import type { CaptureItem } from "../capture/capture-item";

/**
 * The on-disk inbox format is a contract with the user, not just with code.
 * See specs/001-quick-capture/contracts/inbox-format.md
 */

const CONTINUATION_INDENT = "  ";

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/**
 * ISO 8601 with the *local* UTC offset, to seconds.
 *
 * Local time preserves the wall clock the user actually experienced; the
 * explicit offset keeps it unambiguous across DST. Bare local time would be
 * ambiguous, and bare UTC would show a confusing time to a human reading the
 * file in an editor.
 */
export function formatTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(
    Math.abs(offsetMinutes) % 60,
  )}`;

  const ymd = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${ymd}T${hms}${offset}`;
}

/**
 * Renders one item as a markdown list entry, always newline-terminated so the
 * next append is safe.
 */
export function serializeItem(item: CaptureItem): string {
  const [first = "", ...rest] = item.text.split("\n");

  let block = `- ${formatTimestamp(item.capturedAt)} ${first}\n`;
  for (const line of rest) {
    // Blank lines stay blank; indenting them would add trailing whitespace.
    block += line.length === 0 ? "\n" : `${CONTINUATION_INDENT}${line}\n`;
  }
  return block;
}
