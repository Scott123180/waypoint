---

description: "Task list for Projects with Milestones"
---

# Tasks: Projects with Milestones

**Input**: Design documents from `/specs/003-project-structure/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **MANDATORY, NOT OPTIONAL.** Constitution Principle I makes test-first non-negotiable, and the
planning brief restated it. Every implementation task below is preceded by a task that writes a failing
test — including the Electron slices, where the E2E spec is written before the window it drives. Skipping
the red step is a constitution violation, not a style choice.

**Organization**: Grouped by user story so each is an independently demoable increment.

**Traceability**: Each task cites the FR/SC identifiers it satisfies, **spelled out individually rather
than as ranges**, so coverage is genuinely checkable by `grep FR-034b tasks.md` rather than by inference.

## Format: `[ID] [P?] [Story] Description (requirements)`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete work)
- **[Story]**: US1–US4 — maps to the user stories in [spec.md](spec.md)
- Exact file paths are given in every task

## Path Conventions

Two-package npm workspace, per [plan.md](plan.md):

- `packages/core/` — `@waypoint/core`, all domain logic, zero Electron imports
- `packages/desktop/` — Electron thin client, adapters, renderer
- Tests live in each package's `tests/`, compiled to `dist/tests/` and run by `node --test`

**Before any task**: `nvm use` (the system `node` is EOL 18.19.1).

**No dependencies are added by this feature**, and no port or adapter is created — `VaultStore` already
suffices ([research R6](research.md)). If a task seems to need a new port, stop: it is a sign domain logic
is leaking toward the adapter layer.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixtures. There is nothing to install and no schema to create.

- [X] T001 [P] Add project file fixtures — a bare stub, a fully structured project, and a deliberately gnarly hand-shaped file (unknown `priority:` key, a `## Notes` section, `## Milestones` above `## Outcome`, no trailing newline, a six-milestone list) — in `packages/core/tests/project-fixtures.ts`
- [X] T002 [P] Add a `FixedClock` and a `seedVault()` helper that writes fixtures into the existing `FakeVaultStore`, in `packages/core/tests/project-fakes.ts` — reuse `FakeVaultStore` from `packages/core/tests/sort-fakes.ts` rather than writing a second fake

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The file format. This is where the risk lives — these files already exist in users' vaults and
are git-tracked, so a parser that reformats on read is the one defect that cannot be walked back.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. T012/T013 in particular gate
everything: if the round-trip is not byte-identical, every service verb built on top inherits the problem.

### Types

- [X] T003 [P] Declare `Project`, `Milestone`, `MilestoneRef`, `Area`, `UnprocessedItem`, `ProjectStatus`, `AreaStatus`, `StructureGap`, `ProjectSummary`, `AreaSummary`, `ProjectOutcome`, and `RefusalReason` per [contracts/projects-api.md](contracts/projects-api.md) in `packages/core/src/projects/types.ts` — `Project` must be able to hold a title, an outcome, milestones, a single next action, a DRI, and a status, and `AreaStatus` must be its own union, not a subset alias, so `done` cannot reach an area by widening (FR-001, FR-041, [data-model.md](data-model.md))

### Milestone line format

- [X] T004 [P] Write failing tests for `parseMilestone` — done and open states, with and without a verifier, with and without a done date, a definition of done containing ` — ` and `@` (must survive intact), a non-task-list line returning null — in `packages/core/tests/milestone-parse.test.ts` (FR-010, FR-011, FR-012, [contracts/project-format.md](contracts/project-format.md))
- [X] T005 Implement right-to-left tail parsing (`— done <date>`, then `— @<verifier>`, remainder is the definition of done) in `packages/core/src/projects/milestone.ts` (FR-010, research R2)
- [X] T006 [P] Write failing round-trip property test asserting `renderMilestone(parseMilestone(line)) === line` over every fixture line, in `packages/core/tests/milestone-roundtrip.test.ts` (FR-045)
- [X] T007 Implement `renderMilestone` and reconcile it with `parseMilestone` until the round-trip passes, in `packages/core/src/projects/milestone.ts`

### Document parse

- [X] T008 [P] Write failing test that a Feature 2 stub (`# Title` + `status: active`, nothing else) parses to a `Project` with null outcome, null next action, null DRI, and empty milestone and unprocessed arrays — a valid state, not an error — in `packages/core/tests/document-stub.test.ts` (FR-004, FR-005)
- [X] T009 [P] Write failing tests for preamble parsing — `status`, `next action`, `dri`, `completed`; case-insensitive keys; surrounding whitespace ignored; an absent or unrecognized `status` reading as `active`; an unknown key carried through untouched — in `packages/core/tests/document-preamble.test.ts` (FR-002, FR-007, FR-008, FR-045)
- [X] T010 [P] Write failing tests for section parsing — `## Outcome` with multiple paragraphs preserved verbatim, `## Milestones`, `## Unprocessed`, sections in any order, an unknown `## Notes` section carried through, a whitespace-only outcome reading as not set — in `packages/core/tests/document-sections.test.ts` (FR-006, FR-045)
- [X] T011 Implement `parseProject` in `packages/core/src/projects/document.ts` — parsing must never throw; anything unrecognized reads as not set and is preserved (FR-045, research R3)

### Document render — the gate

- [X] T012 [P] Write failing **byte-identical round-trip** test asserting that parsing and re-rendering with no edit reproduces the input exactly, across every fixture including the gnarly hand-shaped one, a file with no trailing newline, and multi-byte UTF-8 content, in `packages/core/tests/document-roundtrip.test.ts` (FR-044, FR-045, SC-002, SC-014, [quickstart §2](quickstart.md))
- [X] T013 Implement lossless rendering in `packages/core/src/projects/document.ts` until T012 passes — this is the gate the whole feature rests on; do not proceed while it is red
- [X] T014 [P] Write failing tests for the surgical edit helpers — setting a preamble key adds or updates only that line, clearing one removes only that line, adding `## Outcome` inserts it **before** `## Unprocessed` when present and appends otherwise, and every other byte is unchanged in all cases (including every item under `## Unprocessed`) — in `packages/core/tests/document-edit.test.ts` (FR-045, FR-046, SC-003, research R3)
- [X] T015 Implement the field-level edit helpers in `packages/core/src/projects/document.ts` (FR-045, FR-046)

### Areas

- [X] T016 [P] Write failing tests for `parseArea` — a title and status only; a hand-edited `status: done` or `status: waiting` returned as read rather than coerced; a hand-added `## Milestones` section preserved and ignored rather than adopted — in `packages/core/tests/document-area.test.ts` (FR-040, FR-041c, FR-043)
- [X] T017 Implement `parseArea` and area rendering in `packages/core/src/projects/document.ts` (FR-040, FR-043)

### The derived flag

- [X] T018 [P] Write failing tests for `structureGaps` covering all eight combinations of missing outcome / milestones / next action, plus: a missing DRI never contributes, status never influences the result, zero milestones flags, exactly one milestone does **not** flag, and supplying the last missing element clears the flag with no separate dismiss step — in `packages/core/tests/gaps.test.ts` (FR-009, FR-013a, FR-018, FR-021, FR-023, SC-004, SC-005)
- [X] T019 Implement `structureGaps` as a pure function over a parsed project in `packages/core/src/projects/gaps.ts` — nothing is written, nothing is cached (FR-020, research R5)

**Checkpoint**: A project file can be read and written back byte-for-byte, and its gaps computed. User story work can begin.

---

## Phase 3: User Story 1 - Give a Bare Project Real Structure, Partially, Whenever (Priority: P1) 🎯 MVP

**Goal**: A stub sort created becomes a project the user can shape — outcome, milestones with verifiers,
next action, DRI — in whatever pieces and whatever order they choose, with the raw items sort left behind
visible while they work.

**Independent Test**: Starting from a title-only project, add outcome alone and confirm it persists and
nothing else was demanded; then milestones with verifiers, then a next action, then a DRI, each in a
separate session; confirm every partial state was valid and readable in a plain-text editor throughout.
Covers [quickstart §1, §3, §4, §11](quickstart.md).

### Tests for User Story 1 ⚠️

> Write these FIRST and watch them fail.

- [X] T020 [P] [US1] Write failing tests that `get()` on a stub returns three nulls and names all three gaps, that `listActive()` excludes projects whose status is `done` while `list()` includes them, and that all three read verbs perform **zero writes** against the fake vault, in `packages/core/tests/project-service.read.test.ts` (FR-004, FR-022, FR-026, FR-032, FR-045)
- [X] T021 [P] [US1] Write failing tests that `create(title)` emits bytes equal to `renderStub(title)`, that a title matching an existing slug returns that project rather than creating a duplicate, and that an empty title is refused, in `packages/core/tests/project-service.create.test.ts` (FR-003, FR-005)
- [X] T022 [P] [US1] Write failing tests for the scalar setters: outcome, next action, and DRI each persist and can each be **cleared back to null**; `setTitle` persists but **refuses an empty or whitespace-only title** with `empty-title`, because a title is one of the two fields always present; and no setter requires or disturbs any other field — in `packages/core/tests/project-service.fields.test.ts` (FR-003, FR-027, FR-028)
- [X] T023 [P] [US1] Write failing tests that every edit is durable the moment it returns — no save, commit, or confirm step exists, and re-reading through a fresh service instance (the equivalent of restarting the app) sees it — in `packages/core/tests/project-service.persistence.test.ts` (FR-030)
- [X] T024 [P] [US1] Write failing tests for field-level verification: a field changed on disk returns a `field-changed` refusal as a **value** with the file left byte-for-byte unchanged; a change to a *different* field does **not** cancel the write and survives it; a cancelled write leaves nothing queued, retried, or pending — in `packages/core/tests/project-service.verify.test.ts` (FR-045a, FR-045b, FR-045c, FR-045e, SC-014a)
- [X] T025 [P] [US1] Write failing tests that `setStatus` moves between all four values including out of `done`, in `packages/core/tests/project-service.status.test.ts` (FR-002, FR-029)
- [X] T026 [P] [US1] Write failing tests for `addMilestone` — the first four accepted without objection, the fifth refused with `milestone-cap` and all four existing milestones untouched, an empty definition of done refused with `empty-value`, and a project with one milestone not flagged for it — in `packages/core/tests/project-service.milestones-add.test.ts` (FR-013, FR-013a, FR-014, SC-008a)
- [X] T027 [P] [US1] Write failing test that a hand-written six-milestone file is returned in full by `get()` — none deleted, hidden, or truncated — while adding a seventh through the service is still refused, in `packages/core/tests/project-service.milestones-overflow.test.ts` (FR-013b)
- [X] T028 [P] [US1] Write failing tests for `editMilestone` and `removeMilestone` — `MilestoneRef` verification per milestone, a hand-edit to a *different* milestone not cancelling the write, and order remaining stable across edits and removals — in `packages/core/tests/project-service.milestones-edit.test.ts` (FR-015, FR-016, FR-045d)
- [X] T029 [P] [US1] Write failing tests that `get()` returns unprocessed items with text, index, raw, and a `capturedAt` that is null for a hand-written item and never substituted, and failing tests for `dismissUnprocessed` — the item is appended to `trash.md` **before** being removed from the project, its text and capture timestamp survive intact, the remaining items keep their order, an emptied section is not an error, and the dismissed text never lands in any structured field — in `packages/core/tests/project-unprocessed.test.ts` (FR-046a, FR-046b, FR-046c, FR-046d, FR-046e, SC-003a)

### Implementation for User Story 1

- [X] T030 [US1] Implement `ProjectService` construction, `get()`, `list()`, and `listActive()` over `VaultStore` in `packages/core/src/projects/project-service.ts` — every call re-reads from disk, nothing is cached, and **`listActive()` applies the not-done rule in the core** so no client has to know it (FR-020, FR-031, FR-032, Principle II)
- [X] T031 [US1] Implement `create()` reusing `renderStub` from `packages/core/src/vault/stub.ts` and `slugify`/`uniqueSlug` from `packages/core/src/vault/slug.ts` — do not write a second definition of what a new project file looks like (FR-003, FR-005)
- [X] T032 [US1] Implement `setOutcome`, `setNextAction`, `setDri`, and `setTitle` with verify-then-write in `packages/core/src/projects/project-service.ts` — `setTitle` takes and returns a non-nullable string per [contracts/projects-api.md](contracts/projects-api.md); the other three are nullable (FR-003, FR-027, FR-028, FR-030, FR-045a, FR-045b, FR-045c)
- [X] T033 [US1] Implement `setStatus` in `packages/core/src/projects/project-service.ts` (FR-002, FR-029)
- [X] T034 [US1] Implement `addMilestone` with the four-milestone cap refusal in `packages/core/src/projects/project-service.ts` (FR-013, FR-014)
- [X] T035 [US1] Implement `editMilestone` and `removeMilestone` with `MilestoneRef` verification in `packages/core/src/projects/project-service.ts` (FR-015, FR-016, FR-045d)
- [X] T036 [US1] Extend `packages/core/src/vault/unprocessed.ts` with reading items and removing one by index — leave `insertUnprocessed` untouched, since sort still depends on its exact behaviour (FR-046, FR-046b)
- [X] T037 [US1] Implement `dismissUnprocessed` reusing `trashLine` and `localDate` from `packages/core/src/vault/lists.ts`, appending to `trash.md` before removing from the project (FR-046b, FR-046d, research R9)
- [X] T038 [US1] Export the project surface — services, types, and the pure functions — from `packages/core/src/index.ts` (Principle II)
- [X] T039 [P] [US1] Write the failing Playwright E2E for [quickstart §1, §3, §4, §11](quickstart.md) in `packages/desktop/tests/e2e/projects-structure.spec.ts` — **written before the window exists**, so its first failure is "no projects view to open", which is the correct red for T040–T046 (Principle I)
- [X] T040 [US1] Register the `projects:*` IPC channels as pass-throughs per [contracts/ipc-projects.md](contracts/ipc-projects.md) in `packages/desktop/src/main/ipc.ts` — `capturedAt` crosses as an ISO string or null, never a `Date` (FR-046a)
- [X] T041 [US1] Expose the project channels on the preload bridge in `packages/desktop/src/preload/preload.ts`
- [X] T042 [US1] Create `ProjectsWindow` in `packages/desktop/src/main/projects-window.ts`, following `sort-window.ts` — re-read on `show()`, hide rather than close
- [X] T043 [US1] Build the single-project view in `packages/desktop/src/renderer/projects.html` and `packages/desktop/src/renderer/projects.ts` — the complete structure (title, outcome, every milestone with its definition of done, verifier, done state and completion date, next action, DRI, status), unset fields shown as *not yet set* rather than hidden, the named gaps rendered from `gaps`, milestone add/edit/remove, and the unprocessed list with a dismiss affordance. Rendering and input only: no rule may live here (FR-022, FR-025, FR-026, FR-046a, Principle II)
- [X] T044 [US1] Add a project picker to `packages/desktop/src/renderer/projects.ts` that calls `projects:list-active` and renders what it receives — it must not filter on `status` itself. US3 upgrades this into the full list with progress and flags (FR-032)
- [X] T045 [US1] Construct `ProjectService` and `AreaService` and wire the window into `packages/desktop/src/main/main.ts`, and add an entry point in `packages/desktop/src/main/tray.ts`
- [X] T046 [US1] Add `projects.html` to the `build:renderer` script in `package.json` alongside `index.html` and `sort.html`, then confirm T039 goes green (SC-001)

**Checkpoint**: A stub can be given structure in pieces, milestones can be added up to four, and unprocessed items can be cleared. US1 is demoable on its own.

---

## Phase 4: User Story 2 - Drive a Project to Done and Keep the Record (Priority: P2)

**Goal**: Milestones get marked done and stay visible with their dates, the project reports two of four, and
marking the project done records a completion date and drops it out of the active list — with a confirmation
when milestones are still open.

**Independent Test**: On a project with four milestones, mark two done and confirm both remain visible with
dates and progress reads 2 of 4; complete the rest, mark the project done, and confirm all five dates are
readable in a plain-text editor with no application running. Covers [quickstart §5, §6, §7](quickstart.md).

### Tests for User Story 2 ⚠️

- [X] T047 [P] [US2] Write failing tests that `completeMilestone` sets the done state and a local calendar date from the injected `Clock` with no prompt and no time of day, that the milestone remains in place rather than being hidden or moved, that progress reports 2 of 4, and that **a project with no milestones is never reported as fully complete by that measure** (0 of 0 is not 100%), in `packages/core/tests/project-milestone-complete.test.ts` (FR-017, FR-033, FR-033a, FR-035, SC-008, SC-009)
- [X] T048 [P] [US2] Write failing tests that `reopenMilestone` clears its date, and that editing a completed milestone's definition of done or verifier leaves its date untouched, in `packages/core/tests/project-milestone-reopen.test.ts` (FR-036, FR-037, SC-011)
- [X] T049 [P] [US2] Write failing tests for `complete()` — open milestones produce an `open-milestones` refusal carrying their names with nothing written; calling again with `confirmOpenMilestones` records `completed:` and leaves the open milestones open with **no date invented** for them; declining changes nothing; an all-done project and a project with no milestones need no confirmation; and a project missing its outcome needs no confirmation either — in `packages/core/tests/project-complete.test.ts` (FR-034, FR-034a, FR-034b, FR-034c, FR-034d, FR-034e, SC-009a)
- [X] T050 [P] [US2] Write failing tests that `reopen()` clears the project's date while leaving every milestone date untouched, that a reopened project returns to `listActive()`, and that re-completing records the new date, in `packages/core/tests/project-reopen.test.ts` (FR-032, FR-036, FR-039, SC-012)
- [X] T051 [P] [US2] Write failing test that completions across three distinct months are recoverable by scanning project file contents alone for `completed:` and `— done <date>`, with no index and no history file, in `packages/core/tests/project-completion-scan.test.ts` (FR-038, SC-010)

### Implementation for User Story 2

- [X] T052 [US2] Implement `completeMilestone` and `reopenMilestone` in `packages/core/src/projects/project-service.ts`, taking dates from the `Clock` via `localDate` (FR-033, FR-033a, FR-036)
- [X] T053 [US2] Implement `complete()` with the `open-milestones` refusal and confirmation path in `packages/core/src/projects/project-service.ts` — the guardrail lives here, not in the renderer, so Features 6 and 7 inherit it (FR-034, FR-034a, FR-034b, FR-034c, FR-034d, FR-034e, research R8)
- [X] T054 [US2] Implement `reopen()` in `packages/core/src/projects/project-service.ts` (FR-036, FR-039)
- [X] T055 [P] [US2] Write the failing Playwright E2E for [quickstart §5, §6, §7](quickstart.md) in `packages/desktop/tests/e2e/projects-completion.spec.ts`, before the renderer work below (Principle I)
- [X] T056 [US2] Add the completion IPC channels in `packages/desktop/src/main/ipc.ts` and `packages/desktop/src/preload/preload.ts`
- [X] T057 [US2] Render milestone completion, the "2 of 4 done" progress, completion dates, and the confirmation built from the `open-milestones` refusal in `packages/desktop/src/renderer/projects.ts` — the renderer must not compute progress or decide when to confirm (FR-017, FR-034a, Principle II)

**Checkpoint**: Projects can be driven to done and the record survives. US1 and US2 both work independently.

---

## Phase 5: User Story 3 - See at a Glance Which Projects Still Need Structure (Priority: P3)

**Goal**: The project list shows every project's status, milestone progress, and whether it needs structure,
without opening any of them — and the flag blocks nothing.

**Independent Test**: Create projects in each partial state plus one fully structured, view the list, and
confirm exactly the incomplete ones are flagged and every operation still works on a flagged project.
Covers [quickstart §8, §9](quickstart.md).

### Tests for User Story 3 ⚠️

- [X] T058 [P] [US3] Write failing tests that each `ProjectSummary` carries status, `milestonesDone`/`milestonesTotal`, `gaps`, and `completedOn`, so a client can render the list without opening any project, in `packages/core/tests/project-service.list.test.ts` (FR-031, SC-007)
- [X] T059 [P] [US3] Write failing test that flag accuracy holds across every combination with no false flags and no misses, and that deleting a `next action:` line directly in the stored file flips the flag on the next read with the application uninvolved, in `packages/core/tests/gaps-accuracy.test.ts` (FR-018, FR-020, SC-004)
- [X] T060 [P] [US3] Write failing test that every mutating verb succeeds on a flagged project identically to an unflagged one — zero operations blocked, gated, or given an extra confirmation — in `packages/core/tests/flag-never-blocks.test.ts` (FR-019, FR-034e, SC-006)

### Implementation for User Story 3

- [X] T061 [P] [US3] Write the failing Playwright E2E for [quickstart §8, §9](quickstart.md) in `packages/desktop/tests/e2e/projects-list.spec.ts`, before the renderer work below (Principle I)
- [X] T062 [US3] Upgrade the picker from T044 into the full project list in `packages/desktop/src/renderer/projects.ts` — status, milestone progress, and a distinguishable needs-structure marker, rendering exactly what `projects:list-active` returns (FR-031, SC-007)

**Checkpoint**: Nothing sits half-defined without being visible. US1–US3 all work independently.

---

## Phase 6: User Story 4 - Keep Areas Ongoing and Unstructured (Priority: P4)

**Goal**: An area holds a title and a status and is never asked for structure it is not supposed to have.

**Independent Test**: Create an area, confirm it offers no outcome, milestone, next action, DRI, or
completion affordance anywhere, offers exactly two statuses, and is never flagged. Covers
[quickstart §12](quickstart.md).

### Tests for User Story 4 ⚠️

- [X] T063 [P] [US4] Write failing tests for `AreaService` — `list`, `get`, `create`, `setTitle`, `setStatus` between `active` and `parked` only, and a hand-edited out-of-range status returned as read and never rewritten — in `packages/core/tests/area-service.test.ts` (FR-040, FR-041, FR-041a, FR-041b, FR-041c)
- [X] T064 [P] [US4] Write failing test that an area file hand-edited to contain a `## Milestones` section stays an area — the content preserved, ignored, and never adopted — in `packages/core/tests/area-not-a-project.test.ts` (FR-043)
- [X] T065 [P] [US4] Write failing test that an area is never flagged as needing structure and exposes no gaps concept at all, in `packages/core/tests/area-never-flagged.test.ts` (FR-024, SC-013)
- [X] T066 [P] [US4] Write failing tests for `AreaService.dismissUnprocessed` — sort routes items into areas too, so an area's `## Unprocessed` items must be readable and individually dismissable to `trash.md` on the same terms as a project's — in `packages/core/tests/area-unprocessed.test.ts` (FR-046a, FR-046b, FR-046d, FR-046e)

### Implementation for User Story 4

- [X] T067 [US4] Implement `AreaService` in `packages/core/src/projects/area-service.ts`, including `dismissUnprocessed` — but **no** `setOutcome`, no milestone verb, no `complete`, no `gaps`; those absences are the design, so do not add them "for symmetry" (FR-024, FR-040, FR-041a, FR-046b)
- [X] T068 [P] [US4] Write the failing Playwright E2E for [quickstart §12](quickstart.md) in `packages/desktop/tests/e2e/areas.spec.ts`, before the renderer work below (Principle I)
- [X] T069 [US4] Add the `areas:*` IPC channels in `packages/desktop/src/main/ipc.ts` and `packages/desktop/src/preload/preload.ts` per [contracts/ipc-projects.md](contracts/ipc-projects.md)
- [X] T070 [US4] Build the area view in `packages/desktop/src/renderer/projects.ts` — title, status with exactly two choices, and unprocessed items; projects and areas visibly distinguishable, with structure and completion affordances appearing only on projects (FR-042, SC-013)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The change signal, the non-functional guarantees, and the documentation that keeps the format
contracts honest.

- [X] T071 [P] Write failing test that `VaultChanged` notifies every subscriber, survives a throwing listener, and carries no payload naming its cause, in `packages/desktop/tests/vault-changed.test.ts` (research R7)
- [X] T072 [P] Create `VaultChanged` in `packages/desktop/src/main/vault-changed.ts`, mirroring `inbox-changed.ts` — a separate emitter from `InboxChanged` because that one fires on every capture, which is noise for a projects window (research R7)
- [X] T073 Raise `vault:changed` after every write path in `packages/desktop/src/main/ipc.ts` and forward it to the window in `packages/desktop/src/main/projects-window.ts`, keeping `projects:refresh` (redraw on show) distinct from `vault:changed` (do not disturb what the user is typing)
- [X] T074 [P] Write Playwright E2E covering [quickstart §13](quickstart.md) in `packages/desktop/tests/e2e/projects-refresh.spec.ts`, asserting both the in-process refresh **and** the deliberate limit that an external text-editor edit is not reflected until the window reopens (research R7)
- [X] T075 [P] Write performance test asserting the project list is available in under 100 ms over 100 projects, in `packages/core/tests/project-list-perf.test.ts` — a regression signal, with real hardware authoritative, as in Features 1 and 2 (SC-017)
- [X] T076 [P] Write test asserting every verb completes with no network access available, in `packages/core/tests/project-offline.test.ts` (FR-047, SC-015)
- [X] T077 [P] Write test asserting no verb generates, ranks, defaults, or pre-fills an outcome, milestone, next action, DRI, or verifier, in `packages/core/tests/project-no-suggestion.test.ts` (FR-048, SC-016)
- [X] T078 [P] Write test asserting no verb deletes a project or area file, that no such verb is exported, and that the exported surface introduces no active-project limit, top-three selection, review ritual, or network interface, in `packages/core/tests/project-scope-boundaries.test.ts` (FR-049, [contracts/projects-api.md](contracts/projects-api.md) guarantee 14)
- [X] T079 [P] Amend `specs/002-inbox-view-sort/contracts/vault-format.md` to point at [contracts/project-format.md](contracts/project-format.md) for the extended project shape, stating that the stub it describes remains valid rather than being superseded
- [X] T080 [P] Mark Feature 3 complete in `ROADMAP.md` and record that `## Unprocessed` is drained by showing and dismissing items rather than by automatic conversion, which stays with Feature 8 (FR-046c)
- [X] T081 Run the full [quickstart.md](quickstart.md) end to end against a scratch vault, including the `git status --porcelain` check in §2 that opening projects produces no diff

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Stories (Phases 3–6)**: All depend on Foundational completion; then parallelizable or sequential by priority
- **Polish (Phase 7)**: Depends on the user stories it touches; T079–T080 are documentation and can be done any time after Phase 2

### Critical path inside Phase 2

T003 → T004/T005 → T006/T007 → T008–T011 → **T012/T013 (byte-identical round-trip)** → T014/T015 → T016/T017, with T018/T019 parallel to the document work.

T013 is the hard gate. Every service verb writes through the renderer built there, so shipping it red means
every later byte-preservation test fails for a reason that has nothing to do with the verb under test.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. No dependency on other stories. Owns `listActive()` because its picker needs it (T030, T044).
- **US2 (P2)**: Depends on Foundational. Builds on US1's service and view in practice, but its verbs and tests are independent — completion can be tested against fixtures without any US1 task.
- **US3 (P3)**: Depends on Foundational, and on T044 for the picker it upgrades. If US3 is built before US1's view, T062 supplies that view instead.
- **US4 (P4)**: Depends on Foundational only. Genuinely independent — `AreaService` shares no code path with `ProjectService` beyond the document parser.

### Within Each User Story

- Every test task precedes its implementation task and MUST be observed failing first (Principle I). This includes the E2E specs — T039, T055, T061, and T068 are each written before the renderer work they drive, so the red step is real rather than skipped for the Electron layer.
- Pure functions before services; services before IPC; IPC before renderer
- Core complete before the Electron layer for that story

### Parallel Opportunities

- T001 and T002 together
- All of T004, T006, T008, T009, T010, T012, T014, T016, T018 — different test files, no shared state
- All ten US1 test tasks (T020–T029) together, before any US1 implementation
- All five US2 test tasks (T047–T051) together
- All four US4 test tasks (T063–T066) together
- Implementation tasks touching `project-service.ts` (T030–T035, T037, T052–T054) are **not** parallel with each other — same file. Likewise T043, T044, T057, T062, and T070 all touch `renderer/projects.ts`
- US2, US3, and US4 can be developed by different people once Phase 2 is done
- T075–T078 are independent test files and run together

---

## Parallel Example: User Story 1

```bash
# Write every US1 test first, in parallel — then watch all ten fail:
Task: "Read tests in packages/core/tests/project-service.read.test.ts"
Task: "Create tests in packages/core/tests/project-service.create.test.ts"
Task: "Scalar field tests in packages/core/tests/project-service.fields.test.ts"
Task: "Persistence tests in packages/core/tests/project-service.persistence.test.ts"
Task: "Verification tests in packages/core/tests/project-service.verify.test.ts"
Task: "Status tests in packages/core/tests/project-service.status.test.ts"
Task: "Milestone-add tests in packages/core/tests/project-service.milestones-add.test.ts"
Task: "Milestone-overflow tests in packages/core/tests/project-service.milestones-overflow.test.ts"
Task: "Milestone-edit tests in packages/core/tests/project-service.milestones-edit.test.ts"
Task: "Unprocessed tests in packages/core/tests/project-unprocessed.test.ts"

# Then implement sequentially — T030–T037 all touch project-service.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational — **do not leave T013 red**
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: [quickstart §1, §2, §3, §4, §11](quickstart.md)
5. Demo: a stub sort created becomes a structured project, in pieces, with no diff on open

### Incremental Delivery

1. Setup + Foundational → the format is provably lossless
2. + US1 → structure can be added (MVP)
3. + US2 → projects can be driven to done and the record kept
4. + US3 → half-defined projects become impossible to miss
5. + US4 → areas stay honest, and the flag stops being noise
6. + Polish → open views stay current, and the contract docs agree

### Parallel Team Strategy

Phase 2 is best done by one person — it is a single format with a single round-trip gate, and splitting it
invites two half-compatible parsers. After that: Developer A on US1 (the largest), Developer B on US2 and
US4, Developer C on US3 and the Phase 7 signal work.

---

## Notes

- `[P]` = different files, no dependencies on incomplete work
- Every task cites the requirements it satisfies, individually rather than as a range, so `grep FR-034b tasks.md` shows real coverage
- Verify each test fails for the right reason before implementing — a test that passes immediately is testing nothing
- Commit after each task or logical pair
- `packages/core/src/projects/types.ts` (T003) refines [plan.md](plan.md)'s module list, which named five files; the types are separated for the same reason Feature 2 put them in `sort/decision.ts`
- Two things that look like omissions and are deliberate: no filesystem watching (research R7) and no write-ahead journal for dismissal (research R9). Both are argued in [research.md](research.md); do not add either without revisiting that reasoning
- One thing that looks like duplication and is deliberate: `list()` and `listActive()` both exist. `listActive()` is the FR-032 rule, kept in the core so no client reimplements it; `list()` serves Feature 5's review and the retrospective, which need done projects too
