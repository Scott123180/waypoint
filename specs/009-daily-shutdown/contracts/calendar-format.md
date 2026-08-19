# Contract: Reading `calendar.md`

**Feature**: 009-daily-shutdown | **Date**: 2026-08-18

**The format is not designed here.** Feature 2 fixed it when it started writing this file
(`specs/002-inbox-view-sort/contracts/vault-format.md`), deliberately shaping it like `waiting.md` so a
later feature could measure staleness the same way. This is that feature. What follows is the **reading**
contract: the grammar as it already exists on disk, and what the parser promises about it.

---

## The grammar

```markdown
- 2026-08-11 — 2026-08-09T16:02:11-04:00 Book flights for the March offsite
- 2026-08-11 — Dentist sometime in September
- 2026-07-30 — 2026-07-30T09:14:02-04:00 Quarterly planning day
  needs a whole afternoon, not an hour
```

```text
item-line    := "- " flagged-on " — " [capture-timestamp " "] text
continuation := "  " anything-else
```

| Field | Rule |
|---|---|
| `flagged-on` | Local date the item was flagged, `YYYY-MM-DD`. Written automatically by sorting, with no prompt. |
| `capture-timestamp` | Original capture time, ISO-8601 with offset. Omitted for a hand-written item; never substituted. |
| `text` | The item verbatim, continuation lines indented two spaces and rejoined with newlines. |

The em dash separator is `—` (U+2014) with a single space on each side, matching `waiting.md`.

**No event date, time, duration, location, or attendee is recorded** — this is a staging list of flags, not
a calendar (002 FR-017). The parser reads nothing else because there is nothing else there.

---

## What the parser promises

```ts
export const CALENDAR_PATH = "calendar.md";

export function readCalendar(content: string): {
  items: CalendarItem[];
  unreadable: UnreadableLine[];
};
```

1. **Parsing never fails.** There is no input for which `readCalendar` throws. A file of noise yields no
   items and a list of unreadable lines.
2. **File order is preserved**, and `index` is the item's 0-based position among well-formed items — its
   identity, exactly as in `WaitingItem`.
3. **Nothing is ever rewritten, repaired, normalized, or dropped.** A line the grammar cannot read is
   returned verbatim with its **1-based** line number, so the user is sent to line 14 rather than sent
   hunting (FR-032). It is never listed as stale, never counted, and never removed.
4. **A continuation line inside an open item is that item's text**, not an unreadable line — it is already
   shown.
5. **A malformed or future `flagged-on` is not evidence of neglect.** The parser carries the string
   verbatim; `daysBetween` yields `null` or a negative; the staleness rule answers `allow` (FR-029a). Core
   never substitutes a date to make the question askable.
6. **Absence is not an error and creates nothing.** No `calendar.md` means an empty panel. The file is
   created by sorting something into it, never by being read.

---

## What this module does not contain

No write function. No append. No line renderer. No `CalendarRef`. No service class.

The module is a parser and two types, and that is the whole of it — which is the strongest available form
of FR-031 ("MUST NOT read from, write to, or contact any external or system calendar") and FR-042
("presented as information only… no scheduling, no dismissing, and no writing back"). There is no verb here
to misuse, and adding one would be a visible edit to a file whose header says why it has none.

`calendarLine()` — the writer — stays where it has always been, in `vault/lists.ts`, owned by sorting.
