---

description: "Task list for Inbox View & Sort"
---

# Tasks: Inbox View & Sort

**Input**: Design documents from `/specs/002-inbox-view-sort/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **MANDATORY, NOT OPTIONAL.** Constitution Principle I makes test-first non-negotiable, and the
planning brief restated it. Every implementation task below is preceded by a task that writes a failing
test. Skipping the red step is a constitution violation, not a style choice.

**Organization**: Grouped by user story so each is an independently demoable increment.

**Traceability**: Each task cites the FR/SC identifiers it satisfies, so coverage is checkable by grep
rather than by inference.

## Format: `[ID] [P?] [Story] Description (requirements)`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: US1, US2, US3 — maps to the user stories in [spec.md](spec.md)
- Exact file paths are given in every task

## Path Conventions

Two-package npm workspace, per [plan.md](plan.md):

- `packages/core/` — `@waypoint/core`, all domain logic, zero Electron imports
- `packages/desktop/` — Electron thin client, adapters, renderer
- Tests live in each package's `tests/`, compiled to `dist/tests/` and run by `node --test`

**Before any task**: `nvm use` (the system `node` is EOL 18.19.1).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Vault path resolution and test fixtures. No dependencies are added by this feature.

- [X] T001 [P] Write failing test that `vaultRoot` defaults to the directory containing `inboxPath`, that an explicit `vaultRoot` overrides it, and that a malformed config falls back rather than throwing, in `packages/desktop/tests/config.test.ts` (FR-029, research R8a)
- [X] T002 Derive `vaultRoot` from `dirname(inboxPath)` with explicit override, and expose `projects/`, `areas/`, `waiting.md`, `calendar.md`, `trash.md` paths from it, in `packages/desktop/src/main/config.ts` — do **not** introduce a second independent default, which would split the vault for anyone who relocated their inbox (FR-029, research R8a)
- [X] T003 [P] Add a `withTempVault()` fixture creating and tearing down an isolated vault directory in `packages/desktop/tests/vault-fixture.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The parser, ports, and shared types every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The parser in particular is
where correctness lives — it reads a file the user hand-edits, and every downstream guarantee about byte
preservation rests on it.

- [X] T004 [P] Declare `InboxDocument`, `VaultStore`, and `SortJournal` interfaces per [contracts/sort-api.md](contracts/sort-api.md) in `packages/core/src/ports/index.ts`, including `removeRange`'s obligation not to discard concurrent appends (FR-020e)
- [X] T005 [P] Write failing test that `VaultWriteError` carries `recoverableText`, following `InboxWriteError`'s precedent, in `packages/core/tests/errors.test.ts`
- [X] T006 Add `VaultWriteError` to `packages/core/src/errors.ts`
- [X] T007 Build in-memory `FakeInboxDocument`, `FakeVaultStore`, and `FakeSortJournal` — each able to simulate mismatch, I/O failure, and a concurrent append — in `packages/core/tests/sort-fakes.ts` (depends on T004)
- [X] T008 [P] Write failing classification tests — captured item, hand-written line, two-space continuation, blank line, malformed date treated as hand-written, indented line with no item above it — in `packages/core/tests/inbox-parse.test.ts` (FR-027, FR-027b)
- [X] T009 Implement line classification producing `ParsedItem[]` in `packages/core/src/inbox/parse.ts` (FR-001, FR-027, FR-027b)
- [X] T010 [P] Write failing byte-offset tests — multi-byte UTF-8 (emoji, accents, CJK) must not shift offsets, missing trailing newline at EOF, `raw` matches the exact slice — in `packages/core/tests/inbox-parse-offsets.test.ts` (FR-020a, FR-023)
- [X] T011 Implement byte-offset computation (`start`, `end`, `raw`) in `packages/core/src/inbox/parse.ts` (FR-020a, FR-023)
- [X] T012 [P] Write failing round-trip property test asserting `parse(serializeItem(x))` yields one item equal to `x`, over generated text including newlines, markdown syntax, and strings that look like timestamps, in `packages/core/tests/inbox-parse-roundtrip.test.ts` (FR-021, FR-022)
- [X] T013 Reconcile `packages/core/src/inbox/parse.ts` with `packages/core/src/inbox/serialize.ts` until the round-trip test passes (FR-021, FR-022)
- [X] T014 [P] Declare `ItemRef`, `SortDecision`, `SortOutcome`, and `SortRefusal` types per [contracts/sort-api.md](contracts/sort-api.md) in `packages/core/src/sort/decision.ts` (FR-005, FR-030)

**Checkpoint**: The inbox can be read back into items with verifiable byte ranges. User story work can begin.

---

## Phase 3: User Story 1 - Sort One Item at a Time to an Existing Destination (Priority: P1) 🎯 MVP

**Goal**: Walk the inbox one item at a time in file order and route each to any of the five destinations,
with the item leaving the inbox and landing in its destination durably before the next item appears.

**Independent Test**: Seed a vault with a mixed inbox and one existing project and area. Route items to all
five destinations. Verify each lands in its destination file, disappears from the inbox, and that every
unsorted byte is unchanged — with no destination creation involved.

### Tests for User Story 1 ⚠️ WRITE FIRST, CONFIRM THEY FAIL

- [X] T015 [P] [US1] Failing tests: `next()` returns the first item in file order, returns `null` for an inbox of only blank lines, and returns the *same* item when called repeatedly without a decision, in `packages/core/tests/sort-service.next.test.ts` (FR-001, FR-002, FR-004, FR-027b)
- [X] T016 [P] [US1] Failing tests: `count()` and `isEmpty()` are computed from the file and reflect an external hand-edit with no restart, in `packages/core/tests/sort-service.count.test.ts` (FR-025, FR-028)
- [X] T017 [P] [US1] Failing tests: `destinations()` lists projects and areas, reads each title from its `#` heading, and falls back to the slug when absent, in `packages/core/tests/sort-service.destinations.test.ts` (FR-006, FR-007)
- [X] T018 [P] [US1] Failing tests: `waiting.md`, `calendar.md`, and `trash.md` line grammars per [contracts/vault-format.md](contracts/vault-format.md), including a hand-written item producing a line with no capture timestamp, in `packages/core/tests/vault-lists.test.ts` (FR-013, FR-015, FR-016, FR-017, FR-018, FR-018a, FR-022, FR-027a, SC-010, SC-011)
- [X] T019 [P] [US1] Failing tests: insertion under `## Unprocessed` — heading created when absent, section boundary respected, `###` not mistaken for `##`, every other byte preserved in a file already holding Feature 3-shaped structure — in `packages/core/tests/vault-unprocessed.test.ts` (FR-019a, FR-019b, FR-021, SC-003a)
- [X] T020 [P] [US1] Failing tests: refusals return values not exceptions and write nothing anywhere — `item-changed` on byte mismatch, `destination-missing` for a deleted project, `empty-owner` for blank waiting-for owner — in `packages/core/tests/sort-service.refusals.test.ts` (FR-014, FR-020a, FR-020b, FR-020c, SC-004a)
- [X] T021 [P] [US1] Failing tests: the commit sequence writes journal → destination → inbox removal → clear, in that order, and replay is idempotent at each of the four crash points, in `packages/core/tests/sort-journal.test.ts` (FR-019, FR-020, FR-020d, SC-005)
- [X] T022 [P] [US1] Failing test: a multi-line item moves as one unit, continuation lines intact, and surrounding blank lines survive in the inbox, in `packages/core/tests/sort-multiline.test.ts` (FR-003, FR-021, FR-023)

### Implementation for User Story 1

- [X] T023 [P] [US1] Implement `## Unprocessed` section insertion as a pure string function in `packages/core/src/vault/unprocessed.ts` (FR-019a, FR-019b)
- [X] T024 [P] [US1] Implement `waiting.md` / `calendar.md` / `trash.md` line formatting in `packages/core/src/vault/lists.ts` (FR-013, FR-016, FR-017, FR-017a, FR-022)
- [X] T025 [US1] Implement journal entry shape and replay decision logic in `packages/core/src/sort/journal.ts` (FR-020, FR-020d)
- [X] T026 [US1] Implement the four-step commit sequence in `packages/core/src/sort/commit.ts` (FR-019, FR-020, FR-020d) (depends on T023, T024, T025)
- [X] T027 [US1] Implement `SortService.next()`, `count()`, and `isEmpty()` in `packages/core/src/sort/sort-service.ts` (FR-001, FR-002, FR-004, FR-028)
- [X] T028 [US1] Implement `SortService.destinations()` in `packages/core/src/sort/sort-service.ts` (FR-006, FR-007)
- [X] T029 [US1] Implement `SortService.sort()` for existing destinations, including all refusal paths, in `packages/core/src/sort/sort-service.ts` (FR-005, FR-013, FR-014, FR-016, FR-017, FR-019, FR-020a, FR-020b, FR-020c) (depends on T026)
- [X] T030 [US1] Export the sort surface — `SortService`, types, `VaultWriteError`, new ports — from `packages/core/src/index.ts`

### Filesystem adapters for User Story 1

- [X] T031 [P] [US1] Failing test: a shared write mutex serializes two overlapping operations and releases on throw, in `packages/desktop/tests/inbox-mutex.test.ts` (FR-020e, research R4a)
- [X] T032 [US1] Implement the shared in-process write mutex in `packages/desktop/src/main/inbox-mutex.ts` (FR-020e, research R4a)
- [X] T033 [P] [US1] **Failing regression test for the capture-during-sort data-loss path**: interleave a `FsInboxStore.append` with a `FsInboxDocument.removeRange` on the same file and assert the appended item survives the rename, in `packages/desktop/tests/inbox-concurrent-write.test.ts` (FR-020e, SC-005a)
- [X] T034 [US1] Make `FsInboxStore` acquire the shared mutex around its append in `packages/desktop/src/main/adapters/fs-inbox-store.ts`, without changing its non-blocking contract — capture still returns on enqueue (FR-020e, Principle VI)
- [X] T035 [P] [US1] Failing tests: `removeRange` splices only on exact byte match, returns `mismatch` without writing otherwise, replacement is atomic, and an out-of-process size change before rename triggers a bounded re-read-and-retry rather than a lost write, in `packages/desktop/tests/fs-inbox-document.test.ts` (FR-020a, FR-020b, FR-020e)
- [X] T036 [US1] Implement `FsInboxDocument` using the shared mutex plus temp-file-and-`rename`, taking the mutex as a required constructor argument so an unsafe instance cannot be built, in `packages/desktop/src/main/adapters/fs-inbox-document.ts` (FR-020a, FR-020b, FR-020e, research R1/R4a)
- [X] T037 [P] [US1] Failing tests: `VaultStore` read/write/list/appendLine, creating missing directories, and appending to a file that lacks a trailing newline, in `packages/desktop/tests/fs-vault-store.test.ts` (FR-029)
- [X] T038 [US1] Implement `FsVaultStore` in `packages/desktop/src/main/adapters/fs-vault-store.ts` (FR-029)
- [X] T039 [P] [US1] Failing tests: JSON-lines append, `markDestinationWritten`, `clear`, and `pending` surviving a malformed trailing line, in `packages/desktop/tests/fs-sort-journal.test.ts` (FR-020d)
- [X] T040 [US1] Implement `FsSortJournal` at the platform state dir per research R9 in `packages/desktop/src/main/adapters/fs-sort-journal.ts` (FR-020d)

### Electron client for User Story 1

- [X] T041 [US1] Add `sort:next`, `sort:destinations`, `sort:decide`, `sort:count`, and `sort:dismiss` handlers as pass-throughs to `SortService` in `packages/desktop/src/main/ipc.ts`, per [contracts/ipc-sort.md](contracts/ipc-sort.md) (FR-005, FR-030)
- [X] T042 [US1] Expose `window.waypoint.sort` and nothing else in `packages/desktop/src/preload/preload.ts`
- [X] T043 [US1] Create the sort window in `packages/desktop/src/main/sort-window.ts`
- [X] T044 [P] [US1] Create the sort view markup — one item, five choices — in `packages/desktop/src/renderer/sort.html` (FR-004, FR-005)
- [X] T045 [US1] Implement renderer input handling and rendering in `packages/desktop/src/renderer/sort.ts`; it must await `sort:decide` before requesting the next item, show no timestamp for a `null` `capturedAt`, and render destinations in the order given (FR-002, FR-003, FR-019, FR-027a, FR-030)
- [X] T046 [US1] Construct `SortService` with the three adapters **and the shared mutex** in `packages/desktop/src/main/main.ts` (FR-020e)
- [X] T047 [US1] Add `showSort`, `hideSort`, and `isSortVisible` to the existing `WAYPOINT_E2E` seam in `packages/desktop/src/main/main.ts`
- [X] T047a [US1] After a successful `sort:decide`, call the existing `CaptureService.expireUndoWindow()` in `packages/desktop/src/main/ipc.ts`. `performUndo` already refuses safely once the inbox has been spliced (research R4b) — this only replaces a confusing refusal with no affordance at all. Do **not** add a size assertion to `performUndo`; the existing tail arithmetic already excludes every case it would catch
- [X] T048 [P] [US1] E2E: one item at a time, five destinations, item leaves the inbox and lands in its file; assert no date/time prompt appears on the calendar choice, in `packages/desktop/tests/e2e/sort-basic.spec.ts` (FR-001, FR-004, FR-005, FR-017a, FR-019)
- [X] T049 [P] [US1] E2E: a hand-written item is routable and displays no timestamp; a multi-line item moves whole, in `packages/desktop/tests/e2e/sort-handwritten.spec.ts` (FR-003, FR-027, FR-027a)
- [X] T050 [P] [US1] E2E: hand-edit the current item's line on disk mid-decision, then decide — expect refusal, re-present, and zero bytes written anywhere, in `packages/desktop/tests/e2e/sort-hand-edit-race.spec.ts` (FR-020a, FR-020b, SC-004a)
- [X] T051 [P] [US1] E2E: fire a capture via the existing test seam while a sort decision is committing; assert the captured item is in the inbox afterwards, in `packages/desktop/tests/e2e/sort-capture-race.spec.ts` (FR-020e, SC-005a)
- [X] T052 [US1] Assert the 100 ms decision-to-next-item budget in `packages/desktop/tests/e2e/sort-basic.spec.ts`, treating CI timings as a regression signal with real hardware authoritative, matching Feature 1's latency precedent (SC-002a)
- [X] T053 [P] [US1] E2E: sort a 20-item inbox to zero in one session, asserting each decision took at most two inputs and no step requested anything beyond destination, title, or owner, in `packages/desktop/tests/e2e/sort-throughput.spec.ts` (SC-001, SC-002, SC-006)

**Checkpoint**: User Story 1 is fully functional and demoable. An inbox can be sorted to zero against
existing destinations. This is the MVP.

---

## Phase 4: User Story 2 - Create a Project or Area on the Spot (Priority: P2)

**Goal**: When no suitable destination exists, create one from a title alone without leaving the sort.

**Independent Test**: With an inbox item and no matching project, create a project during sort by supplying
only a title. Confirm the project file exists with title and status only, the item is in its
`## Unprocessed` section, and no other field was ever requested.

**Depends on**: US1 — this extends `SortService.sort()` and the commit sequence rather than standing alone.
See the honesty note under Dependencies.

### Tests for User Story 2 ⚠️ WRITE FIRST, CONFIRM THEY FAIL

- [X] T054 [P] [US2] Failing tests: slug generation, collision suffixes `-2`/`-3` for genuinely different titles, and a title that slugs to empty being rejected, in `packages/core/tests/vault-slug.test.ts` (FR-011, FR-012, research R6)
- [X] T055 [P] [US2] Failing tests: stub content is exactly `# Title`, `status: active`, and `## Unprocessed` — with no outcome, milestone, next-action, or DRI field, not even empty — in `packages/core/tests/vault-stub.test.ts` (FR-009)
- [X] T056 [P] [US2] Failing tests: `createTitle` matching an existing slug (case and whitespace insensitive) routes to that destination instead of creating a duplicate; empty or whitespace-only title returns `empty-title` and creates nothing, in `packages/core/tests/sort-service.create.test.ts` (FR-011, FR-012)
- [X] T057 [P] [US2] Failing test: create-and-route is one journaled operation — a crash after stub creation never leaves a stub without its item, in `packages/core/tests/sort-create-atomic.test.ts` (FR-008, FR-010, FR-020d)

### Implementation for User Story 2

- [X] T058 [P] [US2] Implement title-to-slug conversion and slug-equality matching in `packages/core/src/vault/slug.ts` (FR-012)
- [X] T059 [P] [US2] Implement minimal stub rendering in `packages/core/src/vault/stub.ts` (FR-009)
- [X] T060 [US2] Extend the commit sequence to create a stub inside the journaled operation in `packages/core/src/sort/commit.ts` (FR-008, FR-010) (depends on T058, T059)
- [X] T061 [US2] Extend `SortService.sort()` to handle `createTitle` decisions in `packages/core/src/sort/sort-service.ts` (FR-008, FR-010, FR-011, FR-012) (depends on T060)
- [X] T062 [US2] Add the create-destination affordance — one title field, nothing else — to `packages/desktop/src/renderer/sort.ts` (FR-008, FR-009, SC-006)
- [X] T063 [P] [US2] E2E: create a project mid-sort from a title alone; confirm the file's contents and that the new destination appears for later items, in `packages/desktop/tests/e2e/sort-create.spec.ts` (FR-008, FR-009, FR-010)
- [X] T064 [P] [US2] E2E: duplicate title reuses the existing destination; empty title creates nothing and leaves the item unsorted, in `packages/desktop/tests/e2e/sort-create-edge.spec.ts` (FR-011, FR-012)

**Checkpoint**: User Stories 1 and 2 both work. A sort session no longer stalls when reality outruns the
existing structure.

---

## Phase 5: User Story 3 - Stop Anytime, Resume, Reach Inbox Zero (Priority: P3)

**Goal**: Partial work survives a quit, sorting resumes at the oldest remaining item, and inbox zero is a
state other features can rely on.

**Independent Test**: Sort part of an inbox, quit the app entirely, reopen. Confirm sorted items are in
their destinations, remaining items are intact and in order, and sorting resumes at the right place.
Continue to the end and confirm the empty state.

**Depends on**: US1 for the service; adds recovery and the empty state.

### Tests for User Story 3 ⚠️ WRITE FIRST, CONFIRM THEY FAIL

- [X] T065 [P] [US3] Failing tests: `recover()` completes a journal entry from each of the four crash states, is idempotent when run twice, and reports `abandoned` when the inbox no longer matches `ref`, in `packages/core/tests/sort-recover.test.ts` (FR-020, FR-020d, FR-024, SC-005)
- [X] T066 [P] [US3] Failing tests: an inbox of only blank lines reports empty; any routable text — including hand-written — reports not empty, in `packages/core/tests/sort-empty.test.ts` (FR-026, FR-027b, FR-027c, FR-028)

### Implementation for User Story 3

- [X] T067 [US3] Implement `SortService.recover()` returning a `RecoveryReport` in `packages/core/src/sort/sort-service.ts` (FR-020d, FR-024)
- [X] T068 [US3] Call `recover()` at startup, before the sort window can open, in `packages/desktop/src/main/main.ts` (FR-020d, FR-024)
- [X] T069 [US3] Emit `sort:recovered` through the existing notice queue when either count is non-zero, in `packages/desktop/src/main/ipc.ts` (FR-020d)
- [X] T070 [US3] Implement the empty state — no destination choices offered — in `packages/desktop/src/renderer/sort.ts` (FR-026)
- [X] T071 [P] [US3] E2E: sort two items, hard-quit the app, relaunch, confirm decisions survived and sorting resumes at the third item, in `packages/desktop/tests/e2e/sort-resume.spec.ts` (FR-024, FR-025, SC-004)
- [X] T072 [P] [US3] E2E: sort to zero, confirm the empty state and that reopening the view shows it immediately, in `packages/desktop/tests/e2e/sort-zero.spec.ts` (FR-026, FR-028, SC-009)
- [X] T073 [P] [US3] E2E: an inbox assembled entirely by hand, containing no timestamps at all, sorts to zero through the same flow, in `packages/desktop/tests/e2e/sort-handwritten-inbox.spec.ts` (FR-027, FR-027c, SC-009a)

**Checkpoint**: All three user stories independently functional. Inbox zero is reachable and observable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T074 [P] Amend guarantee #4 in `specs/001-quick-capture/contracts/core-api.md` to scope append-only to capture, per research R3
- [X] T075 [P] Amend the "appends only; existing bytes never rewritten" rule in `specs/001-quick-capture/contracts/inbox-format.md` likewise, noting that Feature 2 splices and that both writers share a mutex (research R3, R4a)
- [X] T076 [P] Byte-preservation regression test over a hand-shaped vault — headings, stray notes, Feature 3-style sections, no trailing newline — asserting only the sorted item's bytes change, in `packages/core/tests/sort-preservation.test.ts` (FR-021, FR-023, FR-027d, SC-003a)
- [X] T077 [P] Performance test: parsing a 1,000-item inbox completes under 50 ms, in `packages/core/tests/inbox-parse-perf.test.ts` (SC-002a)
- [X] T078 [P] Assert `destinations()` returns a stable, unranked order and that no API field can express a suggestion, in `packages/core/tests/sort-no-suggestion.test.ts` (FR-030, SC-007)
- [X] T079 [P] Assert the out-of-scope guarantees hold: no API or IPC channel offers item editing, reordering, bulk action, undo of a completed decision, or a purge of the discard list, in `packages/core/tests/sort-scope-boundaries.test.ts` (FR-016a, FR-032)
- [X] T080 [P] Automated offline assertion in `packages/core/tests/sort-offline.test.ts`: Node cannot revoke its own network access mid-process, so assert it statically instead — walk the compiled `packages/core/dist/src/sort/`, `vault/`, and `inbox/` output and fail on any `require`/`import` of `net`, `tls`, `http`, `https`, `dgram`, or `node:fetch`, and assert `globalThis.fetch` is never referenced. Manual verification stays with quickstart §10 (FR-031, SC-008)
- [X] T081 [P] Review `packages/desktop/src/renderer/sort.ts` and `packages/desktop/src/main/ipc.ts` for domain logic leakage; the renderer must hold no notion of what a destination is (Principle II)
- [ ] T082 Run the full validation guide at `specs/002-inbox-view-sort/quickstart.md` on the Linux dev machine, including scenario 8 by hand and scenario 10 with the network disconnected (SC-003)
- [ ] T083 Confirm `.github/workflows/ci.yml` passes on push, then verify the macOS artifact produced by `.github/workflows/release.yml` on the MacBook — download only, no local build, per the ROADMAP build-machine rule
- [X] T084 [P] Tick Feature 2 in the feature sequence in `ROADMAP.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks all user stories**
- **US1 (Phase 3)**: needs Foundational
- **US2 (Phase 4)**: needs US1 through T030
- **US3 (Phase 5)**: needs US1 through T030; T068 also needs T046
- **Polish (Phase 6)**: needs the stories you intend to ship

### The mutex is a hard ordering constraint

T032 (mutex) must land before T034 (capture adapter) and T036 (sort adapter), and T033's regression test
must be red before either. Building `FsInboxDocument` first and adding the lock later would mean shipping a
window in which a capture can be destroyed — the exact defect this ordering exists to prevent.

### An honest note on story independence

The template's ideal is stories that proceed in parallel. These do not, quite. US2 and US3 both extend
`SortService` and the commit sequence rather than adding parallel subsystems — creating a destination is a
variant of routing to one, and recovery is a variant of committing. Splitting them into independently
buildable stacks would mean duplicating the commit sequence, which is exactly the code that must exist once.

They remain independently **testable and demoable**, which is what the checkpoints are for. Plan on
sequential delivery: US1 → US2 → US3.

### Within Each Story

- Tests are written and observed failing before implementation. No exceptions (Principle I).
- Pure functions (parser, slug, stub, section insertion) before the service that composes them
- Core before adapters; adapters before the Electron client
- Fakes before real filesystem tests, so a red test means a logic bug rather than an environment problem

### Parallel Opportunities

- T001 and T003 in Setup
- T004, T005, T008, T010, T012, T014 in Foundational
- All eight US1 test tasks (T015–T022) — different files, no shared state
- T023 and T024; T031, T035, T037, T039 (adapter tests are independent)
- T048, T049, T050, T051, T053 E2E specs
- All four US2 test tasks (T054–T057); T058 and T059
- T065 and T066; T071, T072, T073
- Most of Phase 6

Tasks touching `sort-service.ts` (T027, T028, T029, T061, T067) are deliberately **not** parallel — same
file, sequential edits. Same for `renderer/sort.ts` (T045, T062, T070) and `main.ts` (T046, T047, T068).

---

## Parallel Example: User Story 1 tests

```bash
# Write all eight failing tests together, confirm every one is red, then implement:
Task: "next() ordering, repeat-returns-same, null-on-empty in packages/core/tests/sort-service.next.test.ts"
Task: "count()/isEmpty() computed from file in packages/core/tests/sort-service.count.test.ts"
Task: "destinations() titles and slug fallback in packages/core/tests/sort-service.destinations.test.ts"
Task: "list-file grammars in packages/core/tests/vault-lists.test.ts"
Task: "## Unprocessed insertion and byte preservation in packages/core/tests/vault-unprocessed.test.ts"
Task: "refusal paths write nothing in packages/core/tests/sort-service.refusals.test.ts"
Task: "journal ordering and idempotent replay in packages/core/tests/sort-journal.test.ts"
Task: "multi-line item moves whole in packages/core/tests/sort-multiline.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004–T014) — **the parser is the risk; do not rush it**
3. Phase 3: User Story 1 (T015–T053)
4. **STOP and VALIDATE**: quickstart scenarios 1–4 and 8
5. A working sort against existing destinations is a genuinely useful tool at this point

### Incremental Delivery

1. Setup + Foundational → the inbox is readable
2. US1 → sort to existing destinations → **MVP, demoable**
3. US2 → create destinations mid-sort → sessions stop stalling
4. US3 → recovery and inbox zero → Feature 5 becomes unblocked
5. Polish → contract amendments, performance, the macOS artifact

### Where the risk actually is

- **T009–T013 (parser)**: reads a file the user hand-edits, and every byte-preservation guarantee rests on
  it. Property tests are worth more here than examples.
- **T025–T026 (journal and commit)**: the four-step sequence is the one place a bug loses a thought.
  T021's replay table is the real specification.
- **T032–T036 (mutex and atomic replace)**: `rename` orphans the old inode, so an unsynchronized capture
  landing mid-sort is destroyed silently. T033 is the regression test for a defect that was found in
  analysis rather than in production — keep it red first, and keep it.

---

## Notes

- `[P]` means different files with no incomplete dependency
- Commit after each task or logical pair; a red test and its green implementation make a natural commit
- Verify tests fail for the *right reason* before implementing — a test that fails on a typo has not
  established anything
- Stop at any checkpoint to validate a story independently
- No new dependencies are introduced by any task here; if one seems necessary, that is a signal to re-read
  [research.md](research.md) rather than to run `npm install`

---

## Implementation notes

**T081 audit result (renderer domain-logic leakage)**: passes. `renderer/sort.ts` knows no vault path, no
file grammar, no slug rule, and no date rule — its only `Date` use is `toLocaleString()` for display. It
names `project`, `area`, and `waiting` only as vocabulary, which Principle VII requires it to share rather
than invent. `ipc.ts` translates shapes (`item: null`) and coordinates the client (expiring capture's undo
window) but decides nothing about destinations.

**Known flakiness**: `transcript-insert.spec.ts` intermittently fails two of its ten tests when the whole
E2E suite runs in one process (`workers: 1`, ~83 Electron launches). Both pass consistently when that spec
runs alone. Pre-existing Feature 1 behaviour, unrelated to sort — noted here so the next person does not
mistake it for a sort regression.

**Not done here** (require a human or CI):
- T082 — the manual quickstart walkthrough, including scenario 8 by hand and scenario 10 offline
- T083 — CI green on push, then the macOS artifact verified on the MacBook
