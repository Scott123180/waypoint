---

description: "Task list for 005-weekly-review-ritual"
---

# Tasks: Weekly Review Ritual

**Input**: Design documents from `/specs/005-weekly-review-ritual/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Required, not optional.** Constitution Principle I is non-negotiable — tests are written first
and observed to fail for the right reason before implementation. Every implementation task below is preceded
by its test task.

**Organization**: Grouped by user story so each ships as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: US1–US6, mapping to the user stories in spec.md
- Every task names its exact file path
- **Suffixed IDs** (T014a, T032a…) are tasks added after the first numbering pass, sitting in the phase they
  belong to. Suffixes rather than a renumber, so every cross-reference in this file stays valid

## Path Conventions

npm workspaces monorepo: `packages/core/src`, `packages/core/tests`, `packages/desktop/src`. Core holds all
domain logic and imports nothing from Electron; the desktop client renders and routes input only.

## The existing tests that change

**Nine files. Eight because a shape grew; one because a behaviour did.** The distinction is the whole point
of keeping this list, so it is kept honestly: the count started at one, was corrected to three during US1, and
is now nine.

**Shape grew, so the test that asserts the shape says so** — no behavioural assertion weakened:

- `packages/core/tests/decision-points.test.ts` — 3 decision points to 5 (T006).
- `packages/core/tests/default-policy.test.ts` — the well-formed-decision loop now covers all five points, so
  its context builder gained two cases (T009).
- `packages/core/tests/policy-config.test.ts` — two whole-object `deepEqual` assertions had to include the two
  new keys (T007/T008). **Not anticipated when this list was written**: `PolicyConfig` cannot gain a field
  without an exact-shape assertion failing. That is the assertion working as intended — it is what forces a
  new setting to get a default chosen on purpose rather than arriving as `undefined`.
- `packages/core/tests/project-service.list.test.ts` — the `ProjectSummary` key-set assertion gained
  `statusSince` (T053). Same mechanism as `policy-config.test.ts`, one layer down; Feature 4 had already
  amended this same assertion for `dri` and `needsDri`, and left a dated note saying why.
- `packages/core/tests/gaps.test.ts`, `identity-ambiguity.test.ts`, `identity-corpus.test.ts`,
  `needs-dri.test.ts` — four `Project` fixtures built as object literals, each needing `ledger: []` now that
  `Project` carries one (T052). Mechanical; making the field optional instead would have been weakening the
  type to avoid touching four lines.

**Behaviour changed, and the test said so plainly** — the one that matters:

- `packages/core/tests/project-service.status.test.ts` — "changes only the status line" asserted that
  `setStatus` altered nothing but `status:`, by stripping that line and comparing the rest byte for byte. A
  status change now also appends one ledger entry, in the same write, by design (T053, FR-089). The
  assertion was **widened to name the second thing allowed to change** — and strengthened with a check that
  the entry is exactly the transition — rather than relaxed to stop looking. Everything else in the file
  still may not move.

`packages/core/tests/sort-fakes.ts` also changed (T004), but it is a helper rather than a test.

**Nothing else in Feature 2's, 3's, or 4's suites may be edited.** If another existing test needs changing,
say so here with the reason before changing it — an unexplained edit to an old test is a behaviour regression
wearing a test edit as a disguise.

---

## Phase 1: Setup

**Purpose**: Directories, build wiring, and test-double capacity. No behavior.

- [X] T001 [P] Create module directories `packages/core/src/review/` and `packages/core/src/waiting/`
- [X] T002 [P] Add `packages/desktop/src/renderer/review.html` to the `build:renderer` copy step in `package.json` — the script copies each renderer HTML file by name, so a new window is invisible to the build until it is listed
- [X] T003 Widen `VaultStore.list` to `(dir: "projects" | "areas" | "log")` in `packages/core/src/ports/index.ts`; `packages/desktop/src/main/adapters/fs-vault-store.ts` needs no logic change, its implementation is already directory-generic (research R12)
- [X] T004 Extend `FakeVaultStore` in `packages/core/tests/sort-fakes.ts` to serve `list("log")` from its in-memory files, keeping the existing `readLog: string[]` counting intact. Purely additive — Feature 2, 3, and 4 suites must stay untouched

**Checkpoint**: `npm test` green, nothing behaviorally changed.

---

## Phase 2: Foundational — The Seam Extension

**Purpose**: The two new decision points and their configuration. Core declares where the new rules are
asked; the rules themselves are added by the story that owns them.

**⚠️ BLOCKING**: No user story can begin until this phase is complete.

- [X] T005 Declare `review.inbox.advance` and `waiting.stale.check` in `packages/core/src/ports/index.ts`: add both to `DECISION_POINTS`, add `ReviewInboxAdvanceContext` and `WaitingStaleContext` to the `DecisionContext` union per [contracts/policy-seam.md](./contracts/policy-seam.md). Types only — no rule implementation
- [X] T006 Update `packages/core/tests/decision-points.test.ts` from 3 to 5, asserting the exact set of five names and that they remain unique. The count is what changed, not any behaviour — see "The existing tests that change" above
- [X] T007 [P] Write failing tests in `packages/core/tests/policy-config.test.ts` for the two new keys: absent file → `inbox gate: warn` and `staleness days: 7`; each value parsed; an unrecognised `inbox gate` value falls back to `warn` **and** reports a problem; `staleness days: 0` honored, not corrected; per-value fallback so a typo in one key cannot reset another (FR-084)
- [X] T008 Implement the two new keys in `packages/core/src/policy/policy-config.ts`, adding a keyword reader beside the existing `readCount` for the enum-valued key. Extend `PolicyConfig` and `DEFAULT_POLICY_CONFIG` per [data-model.md](./data-model.md)
- [X] T009 [P] Write failing tests in `packages/core/tests/default-policy.test.ts` asserting the module returns a well-formed `Decision` at all **five** points, and that `reason` is non-empty whenever the verdict is not `allow`
- [X] T010 Extend the `route` switch in `packages/core/src/policy/default-policy.ts` to handle both new points, returning `allow` for now. The inbox gate rule lands in T022, the staleness rule in T055

**Checkpoint**: Five decision points exist, two of them consulted by nothing yet. `npm test` green, including
all of Features 2–4.

---

## Phase 3: User Story 1 — Run the Ritual End to End (Priority: P1) 🎯 MVP

**Goal**: Start a review, move through four steps in order, complete it, and have a permanent plain-text
record of that week on disk — with the summary port declared and no provider supplied.

**Independent test**: With one project, one waiting-for item, and a non-empty inbox, start a review, pass all
four steps changing nothing, and complete it. A log file for the current ISO week exists, names the week,
records each step as reviewed, and reads correctly in a text editor with the app closed. Run a second review
the following week; the first week's file is byte-for-byte unchanged.

### Tests for User Story 1 ⚠️ Write first, observe failing

- [X] T011 [P] [US1] Write failing tests for the log document in `packages/core/tests/review-document.test.ts`: parse the preamble (`status`, `started`, `step`, `completed`); parse each line grammar in [contracts/review-log-format.md](./contracts/review-log-format.md); an unknown section and prose under a heading are carried through untouched; appending a line touches only that section; a hand-edited file round-trips byte-for-byte when nothing is appended
- [X] T012 [P] [US1] Write failing tests in `packages/core/tests/review-lifecycle.test.ts`: `start()` creates `log/<current week>.md` with `status: in progress`; calling it twice returns the same review rather than a second one (FR-005); `log/` is not created until `start()` is called (FR-062, Principle IV)
- [X] T013 [P] [US1] Write failing tests in `packages/core/tests/review-step-order.test.ts`: steps present in the order inbox → projects → waiting → top-three; reaching a later step before an earlier one is passed refuses with `step-order`; `goTo()` a passed step shows its recorded decisions and discards nothing (FR-002, FR-003)
- [X] T014 [P] [US1] Write failing tests in `packages/core/tests/review-inbox-step.test.ts`: count derived from `inbox.md` on every call and never cached; hand-written lines count (FR-015); a non-empty inbox warns with the count and can be passed with `{ confirmed: true }`; an empty inbox advances silently (FR-020)
- [X] T014a [P] [US1] Write failing tests in `packages/core/tests/review-inbox-resort.test.ts`: after items are sorted out of `inbox.md`, calling `inboxStep()` again returns the **new** count with no cached value and no review state reset; sorting the inbox to zero turns a warn into a silent advance (FR-016). Core's half of "go sort them and come back"
- [X] T015 [P] [US1] Write failing tests in `packages/core/tests/review-complete.test.ts`: completion refused unless every step is passed (FR-010); completion flips `status` to `complete`, adds `completed:`, and writes the note verbatim; a skipped note records that none was written and fabricates nothing (FR-101); any write against a completed review refuses with `already-complete` (FR-011)
- [X] T016 [P] [US1] Write failing tests in `packages/core/tests/review-history.test.ts`: `history()` returns past reviews newest first, each identified by its week; `get(week)` reads a past review as it stands; completing this week's review leaves every earlier log byte-for-byte unchanged (FR-070); a hand-edited log is returned as it reads and is never repaired (FR-072)
- [X] T017 [P] [US1] Write failing tests in `packages/core/tests/review-empty-vault.test.ts`: with no projects, an empty `waiting.md`, an empty inbox and no top three, every step reports its empty state explicitly and the review still completes with a log written (FR-007, SC-018)
- [X] T018 [P] [US1] Write failing tests in `packages/core/tests/review-summary-port.test.ts`: with no provider supplied, `draftSummary()` returns `{ available: false }` and completion works normally (FR-103); a declined draft leaves the log byte-for-byte as it would have been (FR-105); an accepted draft is written to its own attributed section, separate from the note, never merged (FR-106, FR-107); a provider that throws or hangs yields `{ available: false, failure }` and never blocks completion (FR-111); empty or whitespace-only draft text records nothing
- [X] T019 [P] [US1] Write the payload-containment test in `packages/core/tests/summary-payload.test.ts`: a stub provider records what it was handed; the fixture puts distinctive marker strings in a project file, `inbox.md`, and `identity.md`, and none may appear in the payload (FR-108, SC-015c)
- [X] T020 [P] [US1] Write the offline test in `packages/core/tests/review-offline.test.ts`, mirroring `project-offline.test.ts`: every verb including `complete()` works with no network available and no provider supplied (FR-085, FR-104)

### Implementation for User Story 1

- [X] T021 [P] [US1] Create `packages/core/src/review/types.ts`: `Review`, `ReviewStepName`, the four step-record types, `AcceptedSummary`, `ReviewRefusal`, `ReviewResult` per [data-model.md](./data-model.md)
- [X] T022 [US1] Implement the inbox gate rule in `packages/core/src/policy/default-policy.ts`: `allow` at zero whichever way it is configured; `warn` naming the count by default; `block` naming the count and that sorting unblocks it when configured. Core must not be able to compute either branch
- [X] T023 [US1] Declare `SummaryProvider` and `ReviewRecord` in `packages/core/src/ports/index.ts` per [contracts/summary-port.md](./contracts/summary-port.md). `draft()` takes a `ReviewRecord`, never a `VaultStore` — the payload boundary is the signature
- [X] T024 [US1] Implement `packages/core/src/review/review-document.ts` to pass T011: parse, render, and append-within-section, with its own local section handling (research R11 — this is the third copy, with the extraction trigger recorded)
- [X] T025 [US1] Implement `packages/core/src/review/review-service.ts` — `start`, `current`, `history`, `get`, `inboxStep`, `advance`, `goTo`, `draftSummary`, `complete` — to pass T012–T020. Absent `policy` defaults to the shipped module; absent `summary` means **no summary** (research R10)
- [X] T026 [US1] Add the one-write-at-a-time queue to `ReviewService`, reusing the `serialize` pattern from `packages/core/src/weekly/top-three-service.ts`, and cover it with a test in `packages/core/tests/review-concurrent-writes.test.ts` asserting two overlapping records both survive
- [X] T027 [US1] Export the new public surface from `packages/core/src/index.ts`: `ReviewService`, its deps type, the review types, `SummaryProvider`, `ReviewRecord`. Do **not** export any registration or discovery API (FR-112)
- [X] T028 [P] [US1] Create `packages/desktop/src/main/review-window.ts`, following `top-three-window.ts`: creates on demand, re-reads on open, subscribes to the generic `vault:changed` signal
- [X] T029 [P] [US1] Create `packages/desktop/src/renderer/review.html` — the window shell with the four-step rail, the inbox step, and the completion panel with the note field
- [X] T030 [US1] Implement `registerReviewIpc` in `packages/desktop/src/main/ipc.ts` for the channels in [contracts/review-api.md](./contracts/review-api.md). No channel may raise the vault change signal — `FsVaultStore` raises it from its write path
- [X] T031 [US1] Add `reviewApi` to `packages/desktop/src/preload/preload.ts`, exposing only the channels registered in T030
- [X] T032 [US1] Implement `packages/desktop/src/renderer/review.ts` for the spine: step rail, inbox step, advance with the warn confirmation, the note field, completion. Renders what core hands it and computes no counts, verdicts, or messages of its own
- [X] T032a [US1] Add the "go sort the inbox" path to the inbox step in `packages/desktop/src/renderer/review.ts`, `packages/desktop/src/main/ipc.ts`, and `packages/desktop/src/preload/preload.ts`: a `review:open-sort` channel that shows the existing sort window, leaving the review open on the inbox step. Returning re-invokes `review:step-inbox` for a freshly derived count. **Navigation only** — sorting stays Feature 2's surface and is not reimplemented here (FR-016)
- [X] T032b [US1] Render the exact `ReviewRecord` that a provider would receive, in `packages/desktop/src/renderer/review.ts`, before any provider is invoked — plain data the client already holds, shown so the user can see what would leave the machine (FR-109). Visible even in the shipped no-provider configuration, where it shows what *would* be sent if one were configured
- [X] T033 [US1] Wire the review into `packages/desktop/src/main/main.ts`: construct `ReviewService` with the **shared** `vaultStore` (so its writes raise the existing change signal), the existing `projectService`, `topThreeService`, and `sortService`, and **no** summary provider; create the window; register the IPC; subscribe it to `vaultChanged`
- [X] T034 [US1] Add a tray entry to open the review in `packages/desktop/src/main/tray.ts`, matching how the projects and top-three windows are opened
- [X] T035 [US1] Write a desktop-level test in `packages/desktop/tests/review-ipc.test.ts` asserting: the renderer receives core's messages and verdicts verbatim — the trap Feature 4 recorded, where a client silently reshapes a refusal; the sort-navigation channel shows the sort window without hiding the review (T032a); and **nothing in `main.ts` starts, schedules, times, or auto-opens a review** — a review begins only on an explicit user action (FR-006)

**Checkpoint**: A review can be run start to finish and leaves a permanent record. The project, waiting, and
top-three steps pass with placeholder content; the summary port exists with no provider. `npm test` green
including Features 2–4.

---

## Phase 4: User Story 2 — Walk Every Project (Priority: P2)

**Goal**: Walk the active and waiting projects one at a time, act on each through the existing verbs, and
record what happened — with the project ledger underneath, because a duration is only observable at the
transition.

**Independent test**: With a fixture covering one fully structured active project, one missing a DRI, one
missing an outcome, one with open milestones, and two `waiting` projects on either side of the threshold,
walk the step end to end. Each project appears exactly once in a stable order with its gaps and needs-a-DRI
signal; the over-threshold waiting project is flagged and the other is not; a status change, a next-action
change, and a milestone completion each write through and are recorded; a project passed over is recorded as
reviewed rather than absent.

### Tests for User Story 2 ⚠️ Write first, observe failing

- [X] T036 [P] [US2] Write failing tests for ledger parsing and rendering in `packages/core/tests/ledger-document.test.ts`: the grammar in [contracts/project-ledger.md](./contracts/project-ledger.md); oldest-first order; the ` — after Nd <state>` tail optional; a hand-written entry parsed and preserved verbatim; a malformed line carried through and ignored rather than dropped
- [X] T037 [P] [US2] Write failing tests in `packages/core/tests/ledger-status-since.test.ts`: `statusSince` is the `on` of the **last** entry entering the current status; a project that bounced between statuses reports its most recent spell; no matching entry yields `null`; a `null` duration is never flagged stale (FR-093, FR-094)
- [X] T038 [P] [US2] Write failing tests in `packages/core/tests/ledger-writes.test.ts`: `setStatus`, `complete`, and `reopen` each append exactly one entry naming the status left and entered; the entry and the `status:` line land in **one** `vault.write` (assert the write count, not the content alone); a no-op change (`from === to`) appends nothing (FR-089, contracts/project-ledger.md)
- [X] T039 [P] [US2] Write failing tests in `packages/core/tests/ledger-no-migration.test.ts`: reading, listing, and resolving projects never adds a `## Ledger` section; a project file with no ledger is byte-for-byte unchanged until an action is recorded against it (FR-099, SC-012f)
- [X] T040 [P] [US2] Write failing tests in `packages/core/tests/ledger-append-only.test.ts`: 20 successive status changes leave every earlier entry unaltered and in place — zero rewritten, reordered, or removed (FR-091, SC-012d)
- [X] T041 [P] [US2] Write failing tests in `packages/core/tests/review-walk-set.test.ts`: the walk covers `active` and `waiting` and excludes `parked` and `done`; each project appears exactly once; order is identical across repeated reads of unchanged data (FR-021, FR-022)
- [X] T042 [P] [US2] Write the read-counting test in `packages/core/tests/review-read-count.test.ts`: building the walk over 100 projects reads each project file at most once, asserted from `FakeVaultStore.readLog` — counted, not timed, so a quadratic walk fails on fast hardware too (SC-016)
- [X] T043 [P] [US2] Write failing tests in `packages/core/tests/review-walk-signals.test.ts`: each walk entry carries the full field set FR-023 names — title, status, outcome, next action, DRI, how that DRI resolves, and the milestones with their done state — plus its structure gaps and its needs-a-DRI signal; a project missing only a DRI shows that signal and **no** structure gap (FR-023, FR-024, FR-025)
- [X] T044 [P] [US2] Write failing tests in `packages/core/tests/review-stale-projects.test.ts`: a `waiting` project past the threshold is flagged with policy's own words and its day count; one under the threshold is not; one with an unknown `statusSince` is walked but never put to the rule; nothing changes a project's status whatever the user answers; a stale project the user leaves is recorded as surfaced-and-left with its status untouched (FR-022a, FR-022b, SC-012b)
- [X] T045 [P] [US2] Write the WIP-limit parity test in `packages/core/tests/review-parity-wip.test.ts`: taking a project to `active` at the limit, through the review and through `ProjectService` directly, yields the same verdict, the same message, and the same named subjects (FR-031, SC-009)
- [X] T046 [P] [US2] Write the open-milestone parity test in `packages/core/tests/review-parity-open-milestones.test.ts`: marking a project done with milestones open fires the same confirmation with the same milestones named, through the review and directly, and confirming proceeds identically
- [X] T047 [P] [US2] Write the milestone-cap parity test in `packages/core/tests/review-parity-milestone-cap.test.ts`: adding a milestone beyond the cap while fixing a flagged project's structure inside the review refuses with the same message as adding one directly
- [X] T048 [P] [US2] Write failing tests in `packages/core/tests/review-project-records.test.ts`: each recording verb writes through the owning service **and** appends its line; a refusal from the underlying verb is returned unchanged and records nothing; `recordNoChange` marks the project reviewed, distinguishable from never reached (FR-030, FR-033, FR-034)
- [X] T049 [P] [US2] Write failing tests in `packages/core/tests/review-verify-before-write.test.ts`: a field edited on disk while the review has the project on screen causes the write to be refused and the project re-presented, inheriting Feature 3's behavior (FR-035)

### Implementation for User Story 2

- [X] T050 [P] [US2] Create `packages/core/src/projects/ledger.ts`: `LedgerEntry`, `parseLedgerLine`, `renderLedgerLine`, and `statusSince(entries, status)` per [data-model.md](./data-model.md)
- [X] T051 [US2] Add `LEDGER_HEADING` and an `appendLedgerLine(content, line)` writer to `packages/core/src/projects/document.ts`, placing a new `## Ledger` section above `## Unprocessed` via the existing `insertSection` so raw material stays below structure
- [X] T052 [US2] Add `LedgerEntry` and `ProjectSummary.statusSince` to `packages/core/src/projects/types.ts`
- [X] T053 [US2] Compose the ledger append into the status verbs in `packages/core/src/projects/project-service.ts` — `setStatus`, `complete`, `reopen` — as a single content transform producing one `vault.write` (research R5). Derive `statusSince` in `summarize()` beside `gaps` and `needsDri`
- [X] T054 [US2] Parse the `## Ledger` section in `parseProject` in `packages/core/src/projects/document.ts` and expose it on `Project`, leaving every other field and Feature 3's parse behavior untouched
- [X] T055 [US2] Implement the staleness rule in `packages/core/src/policy/default-policy.ts` at `waiting.stale.check`: `warn` past the threshold with the day count in the reason, `allow` otherwise, one threshold for both subjects (contracts/policy-seam.md). US4 consumes the same rule with no second implementation
- [X] T056 [US2] Implement `projectStep()` and the recording verbs — `recordStatus`, `recordNextAction`, `recordMilestoneDone`, `recordStructure`, `recordNoChange` — in `packages/core/src/review/review-service.ts`. Every one delegates to `ProjectService` and records only after it succeeds
- [X] T056a [US2] Implement `recordLeft`'s **project** branch in `packages/core/src/review/review-service.ts`: a stale waiting project the user chose to leave is recorded so the log shows it was surfaced and left, with its status untouched (US2 scenario 1d, FR-022b). The waiting-for **item** branch lands with the rest of that step in T077 — the two share a signature and are split so US2 stays independently testable
- [X] T057 [US2] Derive the walk position in `packages/core/src/review/review-service.ts`: the next project is the first in the walk set with no record against it in the log, computed on read with no stored cursor (research R3)
- [X] T058 [US2] Implement the walk in `packages/desktop/src/renderer/review.ts`: one project at a time, its gaps, needs-a-DRI signal, milestones, and stale flag, with the actions the contract exposes and nothing computed locally
- [X] T059 [US2] Extend `registerReviewIpc` in `packages/desktop/src/main/ipc.ts` and `reviewApi` in `packages/desktop/src/preload/preload.ts` with the project-step and recording channels

**Checkpoint**: The walk works, the ledger records how each project got where it is, and every rule gives the
same answer inside the review as outside it. Features 2–4 suites still pass unmodified.

---

## Phase 5: User Story 3 — Pause Partway and Come Back (Priority: P3)

**Goal**: A review survives the application closing and resumes exactly where it was, having lost nothing.

**Independent test**: Start a review, record decisions across two steps, destroy the service instance
entirely, and construct a new one against the same vault. It resumes at the same step and position with every
prior decision present, and the partial state is legible in a text editor.

### Tests for User Story 3 ⚠️ Write first, observe failing

- [X] T060 [P] [US3] Write failing tests in `packages/core/tests/review-resume.test.ts`: after each recording verb the log on disk already contains that decision — asserted by re-reading the file, not the in-memory review (FR-054, SC-006); a fresh service against the same vault resumes at the same step and position (FR-055, FR-056)
- [X] T061 [P] [US3] Write failing tests in `packages/core/tests/review-resume-fresh-data.test.ts`: a project completed between pause and resume is reflected on resume rather than replayed from the paused view; a project added mid-review joins the walk (FR-009, FR-061)
- [X] T062 [P] [US3] Write failing tests in `packages/core/tests/review-week-turnover.test.ts`: with the clock advanced past the week boundary, an in-progress review stays attached to its own week, is never auto-completed or deleted, and a review started in the new week is a separate file (FR-059, FR-060)
- [X] T062a [P] [US3] Write failing tests in `packages/core/tests/review-abandonment.test.ts`: abandoning a review part-way completes no step, writes no completed log — `status` stays `in progress` and no `completed:` line appears — and alters no project, waiting-for item, inbox item, or outcome; a later review of a later week does not backfill or complete it (FR-008, FR-060)
- [X] T063 [P] [US3] Write a failing test in `packages/core/tests/review-derived-position.test.ts`: deleting one project's line from `## Projects` by hand causes that project to be offered again, proving position is derived rather than stored (research R3)

### Implementation for User Story 3

- [X] T064 [US3] Make every recording verb in `packages/core/src/review/review-service.ts` persist before returning, and confirm no verb holds decisions in memory pending completion
- [X] T065 [US3] Implement resume in `packages/desktop/src/renderer/review.ts`: opening the window calls `current()` and lands on the recorded step and derived position rather than the beginning
- [X] T066 [US3] Ensure an abandoned earlier-week review is readable through `history()` and marked plainly as incomplete in `packages/core/src/review/review-document.ts`, with a test in `packages/core/tests/review-abandoned.test.ts`

**Checkpoint**: A review can be interrupted at any point and resumed with nothing lost.

---

## Phase 6: User Story 4 — Catch the Waiting-For Items (Priority: P4)

**Goal**: Surface delegated items that have gone quiet, and let the user record a follow-up or a receipt —
without deleting anything or contacting anyone.

**Independent test**: With items dated on both sides of the threshold, exactly the over-threshold ones are
surfaced with owner and age; below-threshold items are counted but not flagged; a follow-up and a receipt each
write through; changing the configured threshold alone changes which items are surfaced.

### Tests for User Story 4 ⚠️ Write first, observe failing

- [X] T067 [P] [US4] Write failing tests for `waiting.md` parsing in `packages/core/tests/waiting-document.test.ts`: Feature 2's item line unchanged; nested `  - followed up <date>` and `  - received <date>` recognised as actions; a plain indented line remains item text (research R8); an unparseable line shown as it reads and never dropped (FR-044)
- [X] T068 [P] [US4] Write failing tests in `packages/core/tests/waiting-derived.test.ts`: `untouchedSince` is the last action's date, or `waiting-since` when there are none; `outstanding` is false once a `received` action exists; a future-dated item is not stale and is not corrected (FR-037, FR-042)
- [X] T069 [P] [US4] Write failing tests in `packages/core/tests/waiting-service.test.ts`: `recordFollowUp` appends beneath the item, leaves `waiting-since` untouched, and keeps the item outstanding (FR-041, FR-043a); a second follow-up does not replace the first (FR-043b); `recordReceived` leaves the line and its history in the file (FR-043c); a hand-written action line reads identically to a written one (FR-043d)
- [X] T070 [P] [US4] Write failing tests in `packages/core/tests/waiting-verify.test.ts`: a `WaitingRef` whose block changed on disk refuses with `entry-changed` and writes nothing
- [X] T071 [P] [US4] Write failing tests in `packages/core/tests/review-waiting-step.test.ts` over a fixture of items aged 0–30 days: the stale set matches the threshold exactly at the default and at one other value; the total counts outstanding items only; received items appear in neither; each surfaced item carries the full field set FR-040 names — text, owner, the date it started waiting, any follow-ups already recorded, and how long it has gone untouched; an absent `waiting.md` reports an empty list rather than failing (FR-036, FR-039, FR-040, SC-012)
- [X] T072 [P] [US4] Write a failing test in `packages/core/tests/review-shared-threshold.test.ts`: one change to `staleness days` changes both the surfaced items **and** the surfaced waiting projects — there is no way to configure them apart (FR-022c, SC-012a)
- [X] T073 [P] [US4] Write a failing test in `packages/core/tests/review-no-outbound.test.ts`: across the waiting step, zero messages, emails, reminders, or notifications are emitted to any party, asserted against injected doubles that would record one (FR-046, SC-013)

### Implementation for User Story 4

- [X] T074 [P] [US4] Create `packages/core/src/waiting/types.ts`: `WaitingItem`, `WaitingAction`, `WaitingRef` per [data-model.md](./data-model.md)
- [X] T075 [US4] Implement `packages/core/src/waiting/waiting-document.ts` to pass T067–T068: parse items with their continuation lines and nested actions, render an appended action, surgical writes only
- [X] T076 [US4] Implement `packages/core/src/waiting/waiting-service.ts`: `list`, `recordFollowUp`, `recordReceived`, with entry-level verify-before-write and the same write queue discipline
- [X] T077 [US4] Implement `waitingStep()`, `recordFollowUp`, `recordReceived`, and `recordLeft`'s **item** branch in `packages/core/src/review/review-service.ts`, consulting `waiting.stale.check` once per outstanding item. The project branch of `recordLeft` already exists from T056a — extend it, do not duplicate it
- [X] T078 [US4] Export the waiting surface from `packages/core/src/index.ts`
- [X] T079 [US4] Implement the waiting step in `packages/desktop/src/renderer/review.ts`: stale items with owner, age, and prior follow-ups, plus the three actions. Nothing is sent anywhere from the client
- [X] T080 [US4] Extend `registerReviewIpc` in `packages/desktop/src/main/ipc.ts` and `reviewApi` in `packages/desktop/src/preload/preload.ts` with the waiting-step channels

**Checkpoint**: Delegated work that has gone quiet is surfaced, and both staleness subjects share one rule
and one threshold.

---

## Phase 7: User Story 5 — Commit to the Week Ahead (Priority: P5)

**Goal**: Show what was actually finished this week, then commit to the next — which means widening the top
three's writable window on every surface, not just inside the review.

**Independent test**: With the reviewed week holding a mix of done and not-done outcomes, the step shows them
with their state, an outcome can be marked done from within the step, commitments land in the following
week's section, a write two weeks ahead is refused naming the writable weeks, and every earlier week is
untouched and offers no edit.

### Tests for User Story 5 ⚠️ Write first, observe failing

- [X] T081 [P] [US5] Write failing tests in `packages/core/tests/iso-week-arithmetic.test.ts`: `weekStart(id)` returns the Monday of that ISO week; `isoWeek(weekStart(id)) === id` round-trips over at least 60 consecutive weeks spanning three year boundaries including a 53-week year; `nextWeek("2026-W53") === "2027-W01"` (FR-049c, SC-012g)
- [X] T082 [P] [US5] Write failing tests in `packages/core/tests/top-three-window.test.ts`: writes to the current week and the next week succeed; a write two or more weeks ahead refuses with `future-week` and a message naming the writable weeks; a write to an earlier week still refuses with `past-week`, unchanged (FR-049a, FR-049b, SC-012h)
- [X] T083 [P] [US5] Write failing tests in `packages/core/tests/top-three-next-week.test.ts`: `addOutcome(text, week)` targets the given week and defaults to the current one when omitted; the configured cap, the empty-text refusal, and verify-before-write all apply to the next week identically (FR-050)
- [X] T084 [P] [US5] Write failing tests in `packages/core/tests/review-top-three-step.test.ts`: the step returns the reviewed week and the week ahead; an outcome of the reviewed week can be marked done from within the step (FR-048); earlier weeks offer no edit affordance (FR-048a); the step is passable with nothing set and the review still completes (FR-052); **an unfinished outcome of the reviewed week never appears in the week ahead** — nothing is suggested, pre-filled, ranked, or carried forward, and the week ahead starts empty (FR-053, SC-015)
- [X] T085 [P] [US5] Write a failing test in `packages/core/tests/review-top-three-record.test.ts`: completion records finished, slipped, and committed outcomes with the `forWeek` identifier, and every earlier week's outcomes, done marks, and completion dates are unaltered (FR-065, FR-066)
- [X] T086 [P] [US5] Confirm `packages/core/tests/top-three-preservation.test.ts` passes **unmodified** after the widening — it asserts the `past-week` refusal, which must not move

### Implementation for User Story 5

- [X] T087 [US5] Add `weekStart(id)` and `nextWeek(id)` to `packages/core/src/weekly/iso-week.ts`, both built on the existing `isoWeek` so there is exactly one implementation of week arithmetic in the repo (research R9)
- [X] T088 [US5] Add the `future-week` refusal to `packages/core/src/weekly/types.ts`
- [X] T089 [US5] Widen the writable window in `packages/core/src/weekly/top-three-service.ts`: `verify()` accepts current and next, refuses earlier with `past-week` and later with `future-week`; `addOutcome(text, week?)` takes an optional target defaulting to current
- [X] T090 [US5] Implement `topThreeStep()` and the top-three step record in `packages/core/src/review/review-service.ts`
- [X] T091 [US5] Extend the top-three IPC channels in `packages/desktop/src/main/ipc.ts` and `packages/desktop/src/preload/preload.ts` with the optional week parameter
- [X] T092 [US5] Make the next week editable in `packages/desktop/src/renderer/top-three.ts` — the widening is a property of the top three, not a review-only power (FR-049a)
- [X] T093 [US5] Implement the top-three step in `packages/desktop/src/renderer/review.ts`: the reviewed week with its done state and a way to mark a straggler done, beside the week ahead

**Checkpoint**: The review commits to the week ahead, and the same capability exists in the ordinary
top-three window.

---

## Phase 8: User Story 6 — The Rules Are Mine to Change (Priority: P6)

**Goal**: Both opinions this feature holds live in the policy module and its configuration, changeable by
editing the vault alone.

**Independent test**: With the default configuration a non-empty inbox warns and can be passed; with
`inbox gate: block` the same state prevents advancing; changing `staleness days` changes the surfaced set.
Both changes are made by editing the data directory only, with no application change.

### Tests for User Story 6 ⚠️ Write first, observe failing

- [X] T094 [P] [US6] Write failing tests in `packages/core/tests/review-inbox-gate-config.test.ts`: default warns with the count and can be passed; `inbox gate: block` prevents advancing and names sorting as the unblock; an empty inbox advances silently under `block` (FR-018, FR-019, SC-010)
- [X] T095 [P] [US6] Write failing tests in `packages/core/tests/review-policy-defaults.test.ts`: with no `policy.md`, the documented defaults apply, nothing errors, and no file is created (FR-083); a malformed value applies the documented default, surfaces the problem, and blocks no step (FR-084, SC-018)
- [X] T096 [P] [US6] Write a failing test in `packages/core/tests/review-two-clients.test.ts`: two independently constructed services over the same vault receive identical decisions for the same action (FR-081, SC-011)
- [X] T097 [P] [US6] Extend `packages/core/tests/policy-boundary.test.ts` with three source-scan assertions: (a) neither the inbox gate nor the staleness threshold appears anywhere outside `packages/core/src/policy/` — no threshold constant and no gate branch in `review/`, `waiting/`, or `projects/` (FR-078, FR-079); (b) `review/` and `waiting/` import nothing from Electron and hold every rule the client renders, so the client cannot be holding domain logic (FR-086, Principle II); (c) `draft(` has **exactly one** call site in the whole of `packages/core/src`, guarding the one-call-site claim the way T006 guards the decision-point count (FR-102, FR-112)

### Implementation for User Story 6

- [X] T098 [US6] Relocate behind the seam any rule remnant the T097 scan finds in `packages/core/src/review/`, `packages/core/src/waiting/`, or `packages/core/src/projects/`. If T097 passes on the first run, record that here rather than adding code
  - **Result: no rule remnant found; no code relocated.** The scan did fire three times, and all three were the *scan* being wrong rather than the source:
    1. `review/review-service.ts` matched `=== "block"` — but that is core reacting to a verdict, which is its job. The assertion was narrowed to catch core *computing* one.
    2. `review/types.ts` matched the words "inbox gate" **in a doc comment**. Comments are now stripped before scanning: a module explaining the rule it consults is good, and an assertion that punishes the prose teaches people to delete the prose.
    3. `projects/ledger.ts` matched `days < 0`, a sign check against a hand-edited future date. Narrowed to positive numbers — a threshold is a number somebody chose, and zero is not one.
  - The scan did find one **real** defect on its way past: `parseReview` read the log line "warned" back as the verdict `"warned"`, while a freshly decided record carries `"warn"`. Same field, two shapes, depending on whether it had been through the file. Fixed in `review-document.ts`; `review-document.test.ts` had codified the bug and now asserts `warn`.
- [X] T099 [US6] Surface configuration problems in the review view in `packages/desktop/src/renderer/review.ts`, rendering the module's own words without blocking any step

**Checkpoint**: Both rules are configurable from the vault, and neither exists anywhere but the policy
module.

---

## Phase 9: Polish & Cross-Cutting

- [X] T099a [P] Write the whole-vault no-op guard in `packages/core/tests/review-changes-nothing.test.ts`: snapshot every file in a fixture vault, run a complete review in which the user changes nothing at any step, and assert the vault is byte-for-byte identical apart from the review's own log file — no project, milestone, waiting-for item, inbox item, or outcome touched (FR-073, SC-014). The broadest guard in the suite, and the one that would catch a "helpful" write nobody asked for
- [X] T100 [P] Run the full `quickstart.md` validation end to end against a scratch vault, including the eight manual scenarios
  - **Partly done, and the part not done is named.** Every automatable step ran clean: `npm run typecheck`, `npm test` (1480 passing), the three guard suites, and `git diff --stat packages/core/tests/`. The eight **manual** scenarios in the running app were not performed — they need a person at a GUI. The five Playwright specs in `packages/desktop/tests/e2e/review.spec.ts` cover scenarios 1, 3, and 8 automatically; scenarios 2, 4, 5, 6, and 7 remain a manual pass someone should do before release.
  - The quickstart's "exactly one existing test file changes" claim was wrong and has been corrected in place.
- [X] T101 [P] Confirm `git diff --stat packages/core/tests/` shows `decision-points.test.ts` and new files only — no other Feature 2, 3, or 4 test edited
  - **This check failed as written, and the check was wrong rather than the work.** Ten existing test files changed, plus one helper. Nine are accounted for in "The existing tests that change" above; the tenth is `policy-boundary.test.ts`, which T097 was written to extend and which this task forgot to name. Every edit is listed there with its reason, and exactly one of them — `project-service.status.test.ts` — was a behaviour change rather than a shape change.
- [X] T102 [P] Add a Playwright smoke test in `packages/desktop/tests/review.e2e.spec.ts` opening the review window, advancing a step, and completing, matching how the existing e2e specs are written
- [X] T103 [P] Update `ROADMAP.md`: mark Feature 5 shipped with what landed — `log/YYYY-Www.md`, the project ledger, five decision points, the widened top-three window, and the summary port with no provider — and note that Feature 6 reads these logs and Feature 8 supplies the provider
- [X] T104 [P] Record the `vault/markdown.ts` extraction trigger in `packages/core/src/review/review-document.ts`'s header comment, naming the other two copies so a future fourth document type finds it (research R11)
- [X] T105 Review every new file under `packages/core/src/review/`, `packages/core/src/waiting/`, and `packages/core/src/projects/ledger.ts` for the house comment style: what the code does, and why the rejected alternative was rejected
- [X] T106 Run `npm run typecheck && npm test` clean using the scripts in `package.json`, then `npm run dev` for a final manual pass
  - `npm run typecheck` clean; `npm test` 1480 passing, 0 failing; `npx playwright test` 161 passing. **`npm run dev` was not run** — a final manual pass needs a person at the app, and reporting one that did not happen would be worse than leaving it open.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → no dependencies
- **Foundational (Phase 2)** → depends on Setup; **blocks every user story**
- **US1 (Phase 3)** → depends on Foundational. Nothing depends on it being *complete*, but it is the spine and
  every other story records into the log it creates
- **US2 (Phase 4)** → depends on Foundational and on US1's `ReviewService` existing
- **US3 (Phase 5)** → depends on US1; genuinely testable once US2 gives it decisions worth resuming
- **US4 (Phase 6)** → depends on US1, and reuses two things built in US2: the staleness rule (T055) and
  `recordLeft`'s project branch (T056a), which T077 extends to items rather than duplicating
- **US5 (Phase 7)** → depends on US1; the top-three widening (T087–T089, T092) is independent of every other
  story and can be done at any point after Setup
- **US6 (Phase 8)** → depends on the rules existing (T022 in US1, T055 in US2)
- **Polish (Phase 9)** → depends on everything intended for this release

### Within each story

- Tests are written and observed failing before the implementation that satisfies them
- Document modules before services; services before IPC; IPC before renderer
- Core before client, always — the client cannot be written against an interface that does not exist

### Parallel opportunities

- T001, T002 in Setup
- T007 and T009 in Foundational
- Every test task inside a story is marked [P] — they touch different files and no implementation exists yet
- T050 (ledger module) and T074 (waiting types) are independent of everything else in their phases
- The top-three widening (T087–T089) can proceed in parallel with US2's walk work — different files entirely

## Parallel example: User Story 2 tests

```bash
# All of these are new files with no implementation behind them yet:
Task: "Ledger document tests in packages/core/tests/ledger-document.test.ts"
Task: "statusSince derivation tests in packages/core/tests/ledger-status-since.test.ts"
Task: "Single-write tests in packages/core/tests/ledger-writes.test.ts"
Task: "No-migration tests in packages/core/tests/ledger-no-migration.test.ts"
Task: "Walk set tests in packages/core/tests/review-walk-set.test.ts"
Task: "Read-count guard in packages/core/tests/review-read-count.test.ts"
Task: "WIP parity in packages/core/tests/review-parity-wip.test.ts"
Task: "Open-milestone parity in packages/core/tests/review-parity-open-milestones.test.ts"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — the seam extension
3. Phase 3: US1 — the spine
4. **STOP and VALIDATE**: run a review start to finish, confirm `log/<week>.md` reads correctly with the app
   closed, confirm last week's log is untouched
5. This is genuinely shippable: a weekly written record of commitments where there was none

### Incremental delivery

1. Setup + Foundational → five decision points, two consulted by nothing
2. US1 → the ritual runs and records (**MVP**)
3. US2 → the walk and the ledger; the largest single increment, and where the feature earns its keep
4. US3 → the ritual survives a real week
5. US4 → delegated work stops rotting
6. US5 → the week ahead, and the top-three window gains it too
7. US6 → the rules become the user's

### Notes

- [P] = different files, no dependency on an incomplete task
- Verify each test fails for the *right reason* before implementing — a test that fails because a module is
  missing has not yet told you anything
- Commit after each task or logical group
- Stop at any checkpoint and validate the story independently
- If a Feature 2, 3, or 4 test starts failing, the answer is never to edit it

---

## Phase 10: Convergence

**Added 2026-08-15 by `/speckit-converge`** after Phases 1–9 were complete. Each task names the requirement
it traces to and the kind of gap found. No constitution principle is violated by any of them; the three HIGH
items are all the same shape — core does the work correctly and has the tests to prove it, but the last wire
to a surface was never run, so a user cannot reach it. Test-first still applies (Principle I): each task
below names the test that must fail first.

**Outcome, recorded 2026-08-15.** Five of six landed; T111 is a person's and stays open. Two things worth
carrying forward: one finding (T108) was smaller than converge claimed and says so in place, and the work on
T110 turned up a defect converge had missed entirely — the top-three step was unreachable in the client. Both
are written into the tasks themselves rather than smoothed over, because the value of this list is that it
records what was actually true.

Two existing test files changed in this phase, both this feature's own and both shape growth:
`packages/core/tests/review-policy-defaults.test.ts` and `packages/core/tests/review-waiting-step.test.ts`,
whose whole-object assertions on `waitingStep()` had to include the new `unreadable` field. No Feature 2, 3,
or 4 test was touched.

- [X] T107 Surface past reviews in the review window per FR-071 / US1 scenario 6 (partial). `review.history()` and `review.get(week)` are already wired through `packages/desktop/src/main/ipc.ts`, `packages/desktop/src/preload/preload.ts`, and declared on `RvApi` in `packages/desktop/src/renderer/review.ts:134` — and never called; `review.html` has no element to hold them. Add the list (each entry identified by its week, most recent first, incomplete ones marked as such) and a read-only reader for a selected week, rendering only what core returns. Extend `packages/desktop/tests/e2e/review.spec.ts` first with a failing spec that completes a review, reopens the window, and finds the finished week listed and readable with no re-run or overwrite affordance (FR-011)
- [X] T108 Re-derive the inbox count when the user returns from sorting per FR-016 (partial). `packages/desktop/src/main/main.ts:152` subscribes only `sortWindow` to `inboxChanged`; the review window receives `vaultChanged` and a `review:refresh` sent only from `ReviewWindow.show()`, which `review:open-sort` never triggers because it leaves the review visible. Sorting items to trash writes `inbox.md` through `FsInboxStore` alone, so the review keeps showing the pre-sort count — and the count is exactly what the user went to change. Subscribe the review window to the inbox change signal beside the existing `vaultChanged` subscription, keeping the signal in the adapter's write path where `raiseInboxChanged` already lives. Add the failing assertion to `packages/desktop/tests/review-ipc.test.ts` beside the existing sort-navigation test, which covers the trip out but not the return
  - **The finding overstated the defect, and the correction belongs here.** A `window.addEventListener("focus", …)` handler in `review.ts` already re-derived the count when the review regained focus, which is the ordinary trip back from sorting. So the user was *not* seeing a stale count on the common path, and converge should have found that handler before calling it a gap. What landed is still worth having — an explicit `inbox:changed` subscription does not depend on focus semantics, and covers a write that lands while this window keeps focus — but it is a hardening, not a bug fix. Recorded rather than quietly reframed: a converge finding that turns out to be smaller than claimed is exactly the kind of thing that should not be tidied away.
- [X] T109 Carry unreadable `waiting.md` lines through to the step per FR-044 / US4 scenario 9 (partial). `parseWaiting` in `packages/core/src/waiting/waiting-document.ts:97-102` flushes an ill-formed `- ` line and drops it, and `packages/core/tests/waiting-document.test.ts:99` asserts "only well-formed items are items". The file itself is never rewritten — that half holds — but "shown as it reads on disk" has no channel: no core API returns these lines and no client renders them. Return them from the waiting surface as verbatim text distinct from `WaitingItem`, and show them in the waiting step. Write the failing test first in `waiting-document.test.ts` and `review-waiting-step.test.ts`; the existing assertion is widened to say unreadable lines are not *items* rather than that they are gone
- [X] T110 Automate the share of the quickstart manual scenarios that a spec can hold, per quickstart.md §2, §4, §5, §6, §7 (partial, T100). `packages/desktop/tests/e2e/review.spec.ts` covers §1, §3, and §8; the other five were recorded unperformed. Add specs for §2 (pause, reopen, resume on the fifth project; delete a `## Projects` line by hand and confirm that project is offered again), §5 (a status change from the review and from the projects window produce identical ledger entries), §6 (two follow-ups then a receipt accumulate with `waiting-since` untouched), and §7 (commitments land in the next week's section, and the ordinary top-three window can write it too). §4 is fully covered by `review-shared-threshold.test.ts` at the core level — record that here rather than duplicating it in a slower harness
  - **These specs found a defect nothing else had.** `topThreeStep()` was declared on the renderer's `RvApi`, called by the top-three step, and implemented in **neither the preload nor `ipc.ts`** — so the call was `undefined is not a function`, the step rendered blank, and the user never saw the reviewed week's outcomes or the week ahead (FR-047, FR-049). Typecheck stayed green because `RvApi` is a hand-written interface describing what the renderer *expects* across the context bridge, and nothing checks that anything supplies it. The existing e2e spec asserted `#step-top-three` was *visible*, which an empty section is. Fixed by registering `review:step-top-three` and implementing the preload method, plus two new guards in `review-ipc.test.ts`: every `RvApi` method has a preload implementation, and every channel the preload invokes is registered. This is the third instance of the same shape this phase — core correct, last wire missing — and now the only one with a standing assertion against it.
- [ ] T111 Perform the `npm run dev` manual pass per T106 (partial), or record it explicitly as an unmet release gate in this file. The remaining GUI-only checks after T110 lands are quickstart §4's two-subject staleness in the running app and any visual judgement the specs cannot make. This task is a person's to close — do not mark it `[X]` on the strength of the automated suite
- [X] T112 Record the two shipped files this feature reached into that plan.md does not name, per plan: Source Code map and Complexity Tracking (unrequested). `packages/core/src/vault/lists.ts` gained `daysBetween` (one definition of calendar-day arithmetic, shared by the ledger and the staleness rule) and `packages/core/src/weekly/top-three-document.ts` gained the exported `ParsedWeek`. Both are justified and neither is dead code, but plan.md lists every *other* reach into Feature 2–4 code precisely, and an unlisted one erodes what that list is for. Add them with a dated "Corrected during convergence" note in the way the test-count row was corrected twice — amend, never rewrite
