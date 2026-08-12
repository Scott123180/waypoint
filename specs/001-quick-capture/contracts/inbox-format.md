# Contract: Inbox File Format

**File**: `~/waypoint/inbox.md` (configurable) | **Feature**: 001-quick-capture

This format is a contract with the **user**, not just with future code. It is the durable artifact
that must remain useful with no application running (Principle IV, FR-015, SC-006). Feature 2
(inbox view + sort) will read it, so changes here are breaking changes.

---

## Grammar

One captured thought per markdown list item:

```text
item        := "- " timestamp " " first-line NEWLINE continuation*
continuation:= "  " text NEWLINE
timestamp   := ISO 8601 date-time with local UTC offset, seconds precision
```

## Example

```markdown
- 2026-08-09T14:23:05-04:00 Call the roofer back about the estimate
- 2026-08-09T14:31:12-04:00 Ask Priya whether the migration window moved, and if it did,
  tell the on-call rotation before Friday.
- 2026-08-09T15:02:44-04:00 Book flights for the March offsite
```

## Rules

| Rule | Reason |
|---|---|
| Timestamp uses local time **with UTC offset** | Preserves the wall-clock moment the user experienced while staying unambiguous across DST. Bare local time is ambiguous; bare UTC misleads a human reader. |
| Exactly one space between timestamp and text | Keeps a trivially stable split point for Feature 2's parser |
| Continuation lines indented exactly two spaces | Standard markdown list continuation, so multi-paragraph dictation stays inside its item and still renders correctly |
| Item text is stored **verbatim** | Capture is raw (FR-014). No capitalization, punctuation, reflow, or trailing-period fixes. |
| File ends with a trailing newline | Makes the next append safe and keeps the file POSIX-clean |
| **Capture** appends only; it never rewrites existing bytes | Protects hand-edits (FR-016) |
| No front-matter, ids, tags, or status fields | Capture collects none of it; writing empty metadata fields would be noise the user has to maintain |

## Append behaviour

- If the file does not exist, it is created (with parent directories) containing just the new item.
- If the file exists and does **not** end in a newline — likely because a human edited it — one is
  written before the new item so the append cannot join onto the user's last line.
- Writes use `O_APPEND` so a concurrent editor save cannot interleave into the middle of an item.

## What the app tolerates in a hand-edited file

The user is expected to edit this file directly, so the app MUST NOT be strict about what it finds:

- Lines that do not match the grammar (notes, headings, blank lines, a stray paragraph) are left
  untouched and never "corrected".
- Reordered, deleted, or reworded items are fine; capture only ever appends to the end.
- The only case where the app inspects existing content is undo tail verification, which
  **refuses** on any mismatch rather than modifying anything (see [core-api.md](core-api.md)).

## Amended by Feature 2 (inbox view + sort)

Sorting removes an item from the middle of this file, which no append can express. `FsInboxDocument`
therefore rebuilds the file and `rename`s it into place. Two things keep that safe:

- **Nothing is reformatted.** Removal is a byte splice of one item's exact range; every other byte —
  including blank lines, hand-written notes, and a missing trailing newline — survives untouched.
- **Both writers share one mutex.** A capture landing during a sort would otherwise be written to the
  inode the rename discards. See `specs/002-inbox-view-sort/research.md` R4a.

One clarification this file originally got wrong: a blank line **followed by an indented line** is
*interior* to an item, not a separator. That is what capture writes for a dictated thought containing a
paragraph break, and the parser has to agree or one thought comes back as two.

## Non-goals for this feature

Parsing this file back into structured items is **not** implemented here. Capture writes; Feature 2
reads — see `specs/002-inbox-view-sort/contracts/inbox-parse.md` for the grammar it accepts.
