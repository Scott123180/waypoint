# Phase 1 Data Model: Inbox View & Sort

**Feature**: 002-inbox-view-sort | **Date**: 2026-08-11

All entities live in `packages/core`. The Electron client never constructs them — it renders what the
core returns and sends back a decision (Principle II).

---

## ParsedItem

One routable thing found in `inbox.md`. Produced by the parser, never persisted in this shape.

| Field | Type | Rules |
|---|---|---|
| `text` | `string` | The item's content, continuation lines rejoined with `\n`. Verbatim — never trimmed of internal whitespace, never reflowed (FR-021). |
| `capturedAt` | `Date \| null` | Parsed from the leading ISO 8601 timestamp. **`null` for a hand-written item**, and never substituted with the current date (FR-027a). |
| `start` | `number` | Byte offset where the item's block begins. |
| `end` | `number` | Byte offset just past the block's trailing newline. Removal splices `[start, end)`. |
| `raw` | `string` | The exact bytes in `[start, end)`. Used for commit-time verification (FR-020a). |

**Validation rules**
- Items are yielded in file order, which is the presentation order (FR-001). No sorting is applied —
  a hand-edit that puts timestamps out of order is shown as the user's editor shows it.
- Blank and whitespace-only lines produce no item and belong to no item (FR-027b).
- A line indented exactly two spaces continues the item above it. If there is no item above it, it is
  itself a hand-written item — a hand-edited file can start with an indented line.
- `raw` always ends with `\n`. The parser normalizes a missing final newline at EOF so removal arithmetic
  has no special case.

**Not modeled**: any id. An item's identity is its byte range plus its bytes, verified at commit. A
persisted id would be metadata the user never asked for and would have to hand-maintain — the same
reasoning that kept ids out of `CaptureItem`.

---

## ItemRef

What a client passes back to identify the item it is deciding on. Opaque to the client.

| Field | Type | Purpose |
|---|---|---|
| `start` | `number` | Where the item was when we showed it |
| `end` | `number` | Where it ended |
| `raw` | `string` | What it said. The verification key. |

**Rule**: `sort()` re-reads the inbox and confirms the bytes at `[start, end)` still equal `raw` before
writing anything. Any mismatch → `item-changed`, nothing written, decision cancelled (FR-020b).

---

## SortDecision

The full space of what a user may choose. A discriminated union, so an invalid combination cannot be
constructed — there is no way to express "trash, with an owner."

```ts
type SortDecision =
  | { to: 'project'; slug: string }        // existing
  | { to: 'project'; createTitle: string } // create stub, then route (FR-008, FR-010)
  | { to: 'area';    slug: string }
  | { to: 'area';    createTitle: string }
  | { to: 'waiting'; owner: string }       // FR-013
  | { to: 'calendar' }                     // FR-017
  | { to: 'trash' };                       // FR-016
```

**Validation rules**
- `createTitle` trimmed; empty or whitespace-only → `empty-title`, nothing created, item stays unsorted
  (FR-011). A title that slugs to empty is treated the same way (R6).
- `createTitle` whose slug matches an existing destination routes to that one instead of creating a
  duplicate (FR-012).
- `owner` trimmed; empty → `empty-owner`, item stays unsorted (FR-014).
- `slug` naming a destination that no longer exists on disk → `destination-missing`. Not silently
  recreated (FR-020c).
- There is no `skip`, no `defer`, and no `suggestedBy` field. The absence of the latter is what makes
  FR-030 structural: Feature 7 can call `sort()` with a human-confirmed decision, but has no way to record
  that a machine proposed it, because that would be the first step toward acting on one.

---

## Destination files

Five shapes, all plain-text markdown in the vault. Grammar in
[contracts/vault-format.md](contracts/vault-format.md).

| Destination | File | What sort writes |
|---|---|---|
| Project | `projects/<slug>.md` | Item appended under `## Unprocessed` |
| Area | `areas/<slug>.md` | Item appended under `## Unprocessed` |
| Waiting-for | `waiting.md` | One line: owner, date started waiting, text, capture timestamp |
| Calendar | `calendar.md` | One line: date flagged, text, capture timestamp |
| Trash | `trash.md` | One line: date discarded, text, capture timestamp |

**Invariants across all five**
- Append-only from sort's perspective. Existing content is read to find an insertion point, never
  rewritten or reformatted (FR-019b, SC-003a).
- Created on demand, with parent directories, if absent.
- Valid and readable with no application running (Principle IV, FR-029).
- An item's capture timestamp travels with it (FR-022); a hand-written item arrives without one and none
  is invented (FR-027a).

---

## ProjectStub / AreaStub

What creating a destination mid-sort produces. Minimal by design.

| Field | Type | Rules |
|---|---|---|
| `title` | `string` | Verbatim as typed, after trimming. Becomes the `#` heading. |
| `slug` | `string` | Derived (R6). Becomes the filename. |
| `status` | `'active'` | The only value this feature writes. Feature 3 owns status semantics; sort never reads it back. |

**Rule**: no outcome, milestones, next action, or DRI fields — not even empty ones (FR-009). Writing empty
placeholders would be metadata the user must maintain before Feature 3 gives it meaning. Feature 3 adds
sections alongside `## Unprocessed`; it does not restructure what sort wrote.

---

## DestinationRef

What the client renders in the picker.

| Field | Type | Purpose |
|---|---|---|
| `slug` | `string` | Identity, passed back in the decision |
| `title` | `string` | Display text, read from the file's `#` heading |
| `kind` | `'project' \| 'area'` | Which list it belongs to |

Read fresh from the vault each time the picker opens, so a destination created in another window — or a
file the user added by hand — appears without a restart.

---

## JournalEntry

One in-flight decision. JSON-lines at the platform state dir (R9). Exists for milliseconds in the normal
case.

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` (UUID v4) | Idempotency key for replay |
| `ref` | `ItemRef` | The inbox bytes to remove once the destination write is confirmed |
| `decision` | `SortDecision` | What the user chose |
| `destinationWritten` | `boolean` | Set true after step 2 succeeds |
| `startedAt` | `string` (ISO 8601) | Diagnostics; lets a stale entry be reported meaningfully |

**Lifecycle**

```text
        begin              destination written           inbox spliced         clear
none ──────────► pending ────────────────────► written ──────────────► done ────────► none
                    │                              │
                    │ crash                        │ crash
                    ▼                              ▼
            recover: retry from step 2      recover: item is in both
            (destination write is           places; finish the removal
             idempotent by id)              and clear
```

**Rules**
- Recovery is idempotent at every step. Replaying a completed step is a no-op, so a crash *during
  recovery* is survivable too.
- If recovery finds the inbox bytes no longer match `ref` — the user hand-edited between crash and
  relaunch — it clears the entry and reports it rather than guessing. The item is already safe in its
  destination; the worst case is a duplicate the user can see and delete.
- Recovery runs before the sort view opens (FR-024, FR-025), so the user never sees a half-committed state.

---

## Inbox emptiness

Not an entity — a derived predicate, deliberately.

`isEmpty()` parses the inbox and returns whether any `ParsedItem` remains. It is computed from the file
every time, never cached and never tracked in a session, so Feature 5's review gate cannot be fooled by
stale state and a hand-edit is always reflected (FR-028, SC-009).

An inbox containing only blank lines reports empty. An inbox containing any routable text does not,
including hand-written text (FR-027b, FR-027c).
