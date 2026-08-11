# Phase 0 Research: Inbox View & Sort

**Feature**: 002-inbox-view-sort | **Date**: 2026-08-11

Decisions taken before design, with the reasoning that produced them. Anything marked NEEDS
CLARIFICATION in the Technical Context is resolved here.

---

## R1 — How to remove an item from the middle of `inbox.md`

**Decision**: Read the whole file, verify the item's recorded byte range still contains exactly the bytes
we showed the user, splice that range out in memory, write the result to a temp file in the same
directory, `fsync`, then `rename` over the original.

**Rationale**: `rename(2)` within a filesystem is atomic — a reader sees either the old file or the new
one, never a half-written one. Removing bytes from the middle of a file has no in-place primitive; every
approach is a rewrite, and the only question is whether a crash can expose a partial one. Temp-plus-rename
says no. Reading the whole file is free at this scale: a 1,000-item inbox is well under 100 KB.

The byte-range verification is what implements FR-020a/FR-020b. It fails closed — if the recorded range no
longer matches, nothing is written and the decision is cancelled.

**Alternatives considered**:
- *Truncate-and-rewrite in place* — a crash mid-write leaves a truncated inbox. Rejected outright; this is
  the user's data.
- *Tombstone the line instead of removing it* (e.g. prefix with `~~`) — append-only, preserves Feature 1's
  guarantee, no rewrite. Rejected: it leaves sorted items visible in the file forever, so "inbox zero"
  would mean a file full of struck-through text. FR-028 and Principle IV both want the file to be
  genuinely clear.
- *Rewrite only the tail after the removed item* — smaller write, same crash exposure, more code.

**Consequence**: `rename` replaces the inode. Anything still writing through the *old* inode when the
rename lands is discarded. Two writers can be in that position, and they need different answers — see
R4 for external editors and **R4a for the app's own capture path**, which is the more dangerous of the
two because it is silent and entirely our fault.

---

## R2 — Making "append to destination" and "remove from inbox" behave as one operation

**Decision**: A write-ahead journal at the platform state dir, one JSON line per in-flight decision:

```text
1. append intent to journal, fsync          → we now know what was supposed to happen
2. write the destination (idempotent by id) → item may briefly exist in both places
3. remove the item from the inbox           → item now exists in exactly one place
4. clear the journal entry
```

On startup, `SortService.recover()` reads any leftover entries and finishes them. Each step is idempotent
and keyed by the entry's id, so replaying a completed step is a no-op.

**Rationale**: The spec and the planning brief pull in different directions here, and the difference is
worth stating rather than smoothing over:

- **FR-020** accepts a duplicate as the safe failure: "an item appearing twice is a recoverable outcome, an
  item vanishing is not."
- **The planning brief** is stricter: removal and placement "must not leave an item in both places or
  neither."

POSIX cannot update two files atomically, so the strict reading is unachievable in a single pass. The
journal gets as close as the platform allows: a crash leaves a duplicate for exactly as long as it takes to
relaunch, after which the system heals itself to one copy. Steady state is never both and never neither.
FR-020's ordering is preserved inside the sequence — the destination is written before the inbox is
touched — so even a user who never relaunches keeps their thought.

This also satisfies SC-005 ("across repeated interruption tests, 0 items are lost") in the strong sense
rather than by accepting duplicates as the answer.

**Alternatives considered**:
- *No journal, destination-first ordering* — exactly what FR-020 describes. Simpler, and leaves a permanent
  duplicate the user must notice and fix by hand. Rejected because the brief asked for better and the cost
  is one small append-only file.
- *No journal, inbox-first ordering* — a crash loses the thought. Violates FR-020 outright.
- *Single-file vault* (everything in one markdown file, so one atomic rename covers it) — genuinely
  atomic and genuinely simple, but throws out the ROADMAP's one-file-per-project data model that Features
  3–5 are built around.
- *SQLite with a real transaction* — correct and boring, and a direct Principle IV violation. Not viable.

**Consequence**: One non-vault state file. It contains an item's text only while a decision is in flight,
and that text is already in the vault by then; a stale journal is recovered, not read by the user.

---

## R3 — Feature 1's "existing bytes are never rewritten" guarantee

**Decision**: Scope the guarantee to capture, and amend both Feature 1 contract documents to say so as a
task in this feature.

**Rationale**: [core-api.md](../001-quick-capture/contracts/core-api.md) guarantee #4 and
[inbox-format.md](../001-quick-capture/contracts/inbox-format.md) both state the inbox is append-only. That
was accurate when capture was the only writer, and it bundled two separate promises: capture does not
rewrite, and nothing reformats what the user typed. Sort must break the first to exist at all. It keeps the
second absolutely — unsorted lines come through a sort byte-for-byte identical, which is asserted in tests
(FR-023, FR-027d, SC-003a).

Leaving the docs as they are would make a published contract quietly false, which is worse than amending
it.

**Alternatives considered**: Tombstoning to preserve append-only literally — rejected in R1.

---

## R4 — Concurrent hand-edits while the sort view is open

**Decision**: Verify at commit time, not continuously. Read the item's bytes fresh immediately before
writing; on any mismatch, cancel the decision, write nothing anywhere, and re-present the inbox as it now
stands. No file watching, no locking.

**Rationale**: This mirrors what Feature 1 already does for undo — verify the tail still matches, refuse
rather than delete content it cannot account for — so the codebase has one consistent answer to "the file
changed underneath us." Refusing is cheap and recoverable; a wrong write is not.

Locking was never a real option: the user's text editor will not honor an advisory lock, and the whole
premise of Principle IV is that the file is editable without the app.

**Alternatives considered**:
- *Watch the file and live-refresh* — the item can change under the cursor mid-decision. Rejected in the
  clarify session (Q4 option D).
- *Restart the session on any change* — throws away the user's place over an edit to an unrelated line.
- *Full-content compare-and-swap* — cancels on edits anywhere in the file, including lines the user is not
  sorting. Too blunt; range verification cancels only when it must.

**Consequence**: An edit *above* the current item shifts every later byte offset, so the range check fails
and the decision cancels even though the item itself is untouched. This fails closed and self-corrects on
re-present. Accepted.

---

## R4a — A capture landing *during* a sort decision

**Decision**: Serialize inbox writes in-process. Both `FsInboxStore.append` (capture) and
`FsInboxDocument.removeRange` (sort) acquire one shared in-process mutex owned by the desktop layer, so a
rewrite and an append can never overlap. As a secondary guard against writers outside the process,
`removeRange` re-stats the file immediately before `rename` and restarts the splice from a fresh read if
the size changed, up to a small retry bound.

**Rationale**: This is a real data-loss path that the first pass of this research missed, and it deserves
plain description rather than a footnote.

Capture is available from a global hotkey at any moment, including while the sort view is open — that is
Feature 1's whole point. `FsInboxStore` appends with `O_APPEND` to the open inode. `FsInboxDocument`
rebuilds the file from a snapshot and `rename`s it into place. A capture that lands between sort's read
and sort's rename is written to the inode that the rename is about to orphan. **The thought is gone, with
no error and nothing in the file to show it ever existed.** That violates FR-020e, SC-005a, and the
promise Principle VI makes that capture always succeeds.

The mutex removes the race by construction rather than narrowing it. Both adapters live in the same
Electron main process and are constructed together in `main.ts`, so a shared lock is available without
either of them knowing about the other — the core stays unaware, and Principle II holds.

**This does not make capture block the user.** `CaptureService.submit` already returns when the write is
*enqueued*, not when it lands (Feature 1 R4), so the mutex is contended only by the background queue
drain, never by the capture surface. The longest a capture write can wait is one inbox rewrite — a few
milliseconds on a file this size.

**Alternatives considered**:
- *Re-stat before rename and refuse on growth* — detects the race but turns a routine capture into a
  cancelled sort decision, punishing the user for using two features at once. Kept only as the
  out-of-process backstop, where refusing is the right answer.
- *Preserve the appended tail* — on detecting growth, read bytes `[oldSize, newSize)` and re-append them
  to the replacement before renaming. Correct, and it invites subtle bugs when two appends interleave.
  The mutex makes it unnecessary in-process.
- *Advisory file locking (`flock`)* — would cover external writers too, but a text editor will not honor
  it and capture must never block on acquiring it. Rejected for the same reason as R4.
- *Route sort's rewrite through Feature 1's `AppendQueue`* — the natural serialization point already
  exists, but it lives in the core and is owned by `CaptureService`. Reaching into it from an adapter
  would couple sort to capture's internals for no gain over a mutex the desktop layer owns outright.

**Consequence**: `main.ts` must construct both adapters with the same mutex instance. An adapter built
without it is silently unsafe, so the constructor takes it as a required argument rather than an option.

---

## R4b — Sort's effect on an open capture undo window

**Decision**: No change to `performUndo`. Wire `CaptureService.expireUndoWindow()` into the client after a
successful sort decision, purely so the user sees no undo affordance rather than a refusal.

**Rationale**: The obvious worry is that sorting invalidates a live `UndoToken`. Capture records
`offsetBefore` against the file as it was; sort removes an item from the middle; the offset is now stale;
undo truncates at the wrong place and corrupts the inbox.

**This was investigated and does not happen.** `performUndo` computes `writtenLength = size -
offsetBefore` and reads *that many* trailing bytes, rather than reading `serializedBlock.length` bytes.
The comparison is therefore self-validating: the tail can only equal the block when
`size - offsetBefore` is exactly the block's length (or one more, for the prepended-newline case). If sort
removed an earlier item of length `L`, matching would require `L == 0`, which no item satisfies. Every
case — removed item shorter than, longer than, or equal to the undone item — falls through to
`file-changed` and refuses. Verified empirically against all three before writing this.

**This is a load-bearing invariant, not a coincidence.** Anyone "optimizing" `readTail(writtenLength)` into
`readTail(serializedBlock.length)` would make the tail match again while the offset stayed stale, and undo
would truncate into the middle of a live item. If that line is ever touched, the three-case check belongs
in the test suite first.

What remains is only a UX wrinkle: after a sort, an undo the user was offered will refuse. Correct, but
confusing. Expiring the window turns it into an affordance that is simply absent.

**Alternatives considered**:
- *Add a size assertion to `performUndo`* — my first instinct, and it would be dead code. The existing
  arithmetic already excludes every case it would catch.
- *Have sort update the live token's offset* — couples sort to capture's internals to preserve an undo the
  user is unlikely to want after they have moved on to sorting.

---

## R5 — Parsing `inbox.md` back into items

**Decision**: A line-oriented parser producing `{ text, capturedAt | null, start, end }` per item.

- A line matching `- <ISO-8601> <text>` starts a **captured item**.
- A line indented exactly two spaces continues the item above it (matching the serializer).
- Any other line with non-whitespace content is a **hand-written item** with `capturedAt: null` (FR-027).
- Blank and whitespace-only lines are not items and belong to no item (FR-027b).
- `start`/`end` are byte offsets into the file, covering the item's full block including its trailing
  newline, so removal is a pure splice.

**Rationale**: The grammar is already fixed by
[inbox-format.md](../001-quick-capture/contracts/inbox-format.md); this is its inverse, and the two files
live side by side so they change together. Byte offsets rather than line numbers because removal and
verification both operate on bytes, and multi-byte UTF-8 makes character offsets a trap.

Clarify Q2 settled the hard question — hand-written lines are first-class items — so the parser has no
"invalid line" category at all. Everything with text is sortable, which is also what makes the parser
simple enough to trust.

**Alternatives considered**:
- *A markdown library* (`marked`, `remark`) — adds a dependency, produces an AST that discards the byte
  offsets we specifically need, and is far more permissive than our grammar. Rejected on the
  no-new-dependencies constraint alone.
- *Strict parsing that rejects unrecognized lines* — contradicts FR-027 and Feature 1's stated tolerance
  for hand-edited files.

---

## R6 — Filenames for projects and areas created during sort

**Decision**: Slug the title — lowercase, non-alphanumerics to hyphens, collapse and trim hyphens — and use
`projects/<slug>.md`. Match existing destinations by comparing slugs, which gives FR-012's
case-and-whitespace-insensitive duplicate detection for free. Store the title verbatim in the file's `#`
heading. On slug collision with a *different* title, append `-2`, `-3`, and so on.

**Rationale**: Slug-equality is a better duplicate test than string-equality: "Roof Repair", "roof repair",
and " Roof  Repair " all collapse to `roof-repair` and correctly resolve to one project. Reusing the same
cleanup rules as `create-new-feature.sh` keeps one convention across the repo.

A title that slugs to empty (e.g. "???") is rejected as an empty title under FR-011.

**Alternatives considered**:
- *Normalized-title equality with a UUID filename* — robust matching, unreadable vault. Fails Principle IV's
  spirit; the user should be able to find `projects/roof-repair.md` by name.
- *Exact-title filenames* — spaces and punctuation in filenames, and no duplicate detection.

---

## R7 — Where routed items land inside a project or area file

**Decision**: Under a `## Unprocessed` heading, created at the end of the file if absent, with items
appended as list entries in the same grammar as the inbox. Every other byte in the file is preserved
exactly, including any Feature 3 structure.

**Rationale**: Settled by clarify Q5. Insertion is implemented as: find the `## Unprocessed` heading, find
the end of its section (next `## ` at the same level, or EOF), insert before that boundary. Written as a
pure string function so it is exhaustively testable against hand-shaped files.

**Alternatives considered**: covered in the clarify session — bare append, `## Notes`, `## Next actions`.

---

## R8 — Sort view responsiveness target

**Decision**: The next item appears within **100 ms** of a decision being committed. Parsing a 1,000-item
inbox completes in **<50 ms**.

**Rationale**: The clarify pass deferred this to planning. 100 ms matches capture's budget, which keeps one
number in the user's head and one number in the tests. Unlike capture the disk write is *inside* the
budget, which is affordable: appending a line and rewriting a sub-100 KB file is a few milliseconds of
actual work, and the journal adds two more small writes.

If a decision ever exceeds the budget it will be because of `fsync` on a slow disk, which is the one place
we should wait rather than lie about durability.

**Alternatives considered**: No target — rejected; SC-002's "at most two inputs" says nothing about whether
the loop feels responsive, and an untargeted number regresses silently.

---

## R8a — Reconciling `vaultRoot` with Feature 1's `inboxPath`

**Decision**: `vaultRoot` defaults to the directory containing `inboxPath`, and every destination path is
derived from it. An explicit `vaultRoot` in config overrides the derivation.

**Rationale**: Feature 1 shipped `inboxPath` (default `~/waypoint/inbox.md`) as the single configurable
location. Introducing an independent `vaultRoot` would create two sources of truth: a user who moved their
inbox to `~/notes/inbox.md` would find their projects and waiting list appearing in `~/waypoint/`, split
across two directories with nothing explaining why.

Deriving from `inboxPath` means the existing setting keeps meaning what the user thinks it means — *this
is where my stuff lives* — and the vault stays one git-trackable directory. The explicit override exists
for the genuinely unusual case where the inbox belongs somewhere else, and it has to be deliberate.

**Alternatives considered**:
- *Independent `vaultRoot` with its own default* — what the plan originally implied. Silently splits the
  vault for any user who relocated their inbox.
- *Replace `inboxPath` with `vaultRoot` outright* — cleaner, and it breaks an existing user's config with
  no migration for a feature that has no need to.

---

## R9 — Journal location

**Decision**: Platform state directory alongside the existing config, as `sort-journal.jsonl`. Not in the
user's vault.

**Rationale**: The vault is the user's git-tracked plain-text data. The journal is app recovery
bookkeeping with a lifetime measured in milliseconds; putting it in the vault would add churn to their
history and a file they would reasonably wonder about. It stays plain text and hand-readable, so Principle
IV's intent is met even though it is not user data.

**Alternatives considered**: `.waypoint-journal` dotfile in the vault — visible in `git status`, invites
questions, no benefit.

---

## R10 — Testing crash recovery without crashing

**Decision**: Test `recover()` directly against a fake journal and fake stores seeded to represent a crash
at each of the four steps. Do not kill real processes in the test suite.

**Rationale**: The interesting logic is "given this journal state and this disk state, what should happen",
which is a pure decision table. Process-killing tests are slow, flaky, and platform-dependent, and would
test the OS more than the code. One Playwright E2E covers the honest end-to-end path (quit mid-sort,
relaunch, verify progress intact) without needing a hard kill.

**Alternatives considered**: `SIGKILL` between writes in an integration test — would catch adapter-level
ordering bugs the fakes cannot. Worth adding later if the journal ever misbehaves in the wild; not worth
the flake budget now.
