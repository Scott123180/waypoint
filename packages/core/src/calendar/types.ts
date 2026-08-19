/**
 * The shape a calendar-flagged item is expressed in.
 *
 * Feature 2 fixed this file's format when it started writing it, deliberately
 * shaping it like `waiting.md` so a later feature could measure staleness the
 * same way. This is that feature, and this is the *reading* side of it.
 *
 * See specs/009-daily-shutdown/contracts/calendar-format.md
 */

/** One well-formed line of `calendar.md`. */
export interface CalendarItem {
  /** Position in the file, 0-based. Part of its identity, as in `WaitingItem`. */
  index: number;
  /** Local date the item was flagged, `YYYY-MM-DD`. Verbatim; never substituted. */
  flaggedOn: string;
  /** Item text, continuation lines rejoined with newlines. Verbatim. */
  text: string;
  /** Original capture time, or null for a hand-written line. Never substituted. */
  capturedAt: Date | null;
  /** The full source block — item line plus any continuations. */
  raw: string;
}
