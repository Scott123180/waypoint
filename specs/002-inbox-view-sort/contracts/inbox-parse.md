# Contract: Reading `inbox.md` Back Into Items

**File**: `~/waypoint/inbox.md` (configurable) | **Feature**: 002-inbox-view-sort

The inverse of [Feature 1's inbox format](../../001-quick-capture/contracts/inbox-format.md), which
declared parsing out of scope and handed it here. That document defines what capture *writes*; this one
defines what sort *accepts* — a deliberately larger set, because the user edits this file by hand.

Implemented in `packages/core/src/inbox/parse.ts`, beside `serialize.ts`. **The two must change
together**: any edit to the write format is a breaking change to this parser.

---

## Grammar

```text
document    := block*
block       := captured | handwritten | blank
captured    := "- " timestamp " " text NEWLINE continuation*
handwritten := <any line with non-whitespace content that is not `captured`> NEWLINE continuation*
continuation:= "  " text NEWLINE
blank       := whitespace* NEWLINE
timestamp   := ISO 8601 date-time with UTC offset, seconds precision
```

## Classification rules

| Input line | Becomes | `capturedAt` |
|---|---|---|
| `- 2026-08-11T09:14:02-04:00 Call the roofer` | Captured item | parsed `Date` |
| `Call the roofer` | Hand-written item | `null` |
| `## Someday` | Hand-written item | `null` |
| `- not a timestamp here` | Hand-written item | `null` |
| `- 2026-13-45T99:99:99-04:00 text` | Hand-written item | `null` — invalid date, no throw |
| `  continues the line above` | Continuation of the previous item | — |
| `` (empty) or `   ` | Nothing; belongs to no item | — |

**The parser never rejects input and never throws.** Every line with text is routable (FR-027), which is
what lets a hand-assembled inbox reach zero. There is no error path because there is no invalid document.

## Item boundaries

- An item's block runs from the start of its first line through the newline ending its last continuation.
- A blank line ends the current item's continuations. Blank lines are *not* part of any item's block, so
  removing an item leaves surrounding blank lines exactly as the user arranged them.
- An indented line with no item above it is a hand-written item in its own right, keeping its leading
  spaces in `raw` but not in `text`.

## Byte offsets

`start` and `end` are **byte** offsets into the UTF-8 file, not character indices and not line numbers.

- `end` is just past the block's trailing newline, so `[start, end)` is a clean splice.
- If the file does not end with a newline, the parser reports the final item's `end` at EOF and the
  splice logic accounts for it — a hand-edited file frequently has no trailing newline.
- Multi-byte content (emoji, accented characters, CJK) must not shift offsets. This is explicitly tested;
  character-index arithmetic here would corrupt the file.

## Round-trip guarantee

For any `CaptureItem` `x`:

```text
parse(serializeItem(x))  yields exactly one item with text === x.text
                         and capturedAt equal to x.capturedAt to the second
```

Asserted as a property test over generated inputs including newlines, leading/trailing spaces, markdown
syntax, and text that itself looks like a timestamp.

## Preservation guarantee

Parsing is read-only, and removal is a pure splice of `[start, end)`. Therefore, for any sequence of sort
operations, every byte the user did not sort is byte-for-byte identical afterward (FR-023, FR-027d,
SC-003a). Concretely:

- No re-indentation, no trailing-whitespace cleanup, no newline normalization outside the spliced range.
- No reordering. Items are never rewritten to be in timestamp order, even when a hand-edit put them out
  of it.
- No timestamp repair on a malformed date — it stays exactly as typed, sorted as a hand-written item.

## Worked example

```markdown
- 2026-08-11T09:14:02-04:00 Call the roofer back
Buy milk
- 2026-08-11T09:31:55-04:00 Ask Priya whether the migration window moved,
  and tell the on-call rotation before Friday.

## Someday
```

Yields four items in this order:

| # | `text` | `capturedAt` |
|---|---|---|
| 1 | `Call the roofer back` | 2026-08-11T09:14:02-04:00 |
| 2 | `Buy milk` | `null` |
| 3 | `Ask Priya whether the migration window moved,\nand tell the on-call rotation before Friday.` | 2026-08-11T09:31:55-04:00 |
| 4 | `## Someday` | `null` |

The blank line before `## Someday` belongs to no item. Sorting item 3 removes only its two lines; the
blank line and everything around it survive untouched.
