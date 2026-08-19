---

description: "Task list for 009-daily-shutdown"
---

# Tasks: Daily Shutdown

**Input**: Design documents from `/specs/009-daily-shutdown/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **Required, not optional.** Constitution Principle I is non-negotiable, and the feature input
asked for TDD in as many words. Tests are written first and observed to fail *for the right reason* before
implementation. Every implementation task below is preceded by its test task.

**Organization**: Grouped by user story so each ships as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: US1–US3, mapping to the user stories in spec.md
- Every task names its exact file path

## Path Conventions

npm workspaces monorepo: `packages/core/src`, `packages/core/tests`, `packages/desktop/src`,
`packages/desktop/tests`. Core holds all domain logic and imports nothing from Electron; the desktop client
renders and routes input only.

**Playwright reads `packages/desktop/tests/e2e` and nothing else** (`playwright.config.ts:4`). A spec placed
anywhere else is silently never run — Feature 6 lost four specs to this and recorded it.

## The existing tests that change

**None.** That is the prediction, and it is load-bearing rather than decorative:

- `packages/core/tests/decision-points.test.ts` must stay untouched and green. This feature adds no decision
  point; if that file needs an edit, a rule was added and the design is wrong (T019 asserts the count
  independently).
- `packages/core/tests/waiting-service.test.ts` and `waiting-document.test.ts` must pass unmodified.
  `WaitingService.read()` is additive; `list()` and `unreadable()` keep their behaviour and their callers.
- `packages/core/tests/default-policy.test.ts` must pass unmodified. `subject` widens; no existing branch,
  threshold, or message changes.
- Features 1–8 suites pass unmodified.

**If any existing test needs changing, stop and say so here with the reason before changing it.** On this
branch an edit to an old test is a strong signal that something was added to a shipped shape this feature
was not supposed to touch.

Five shipped files *are* edited, all additively and none breaking an existing assertion:

- `packages/core/src/ports/index.ts` — `WaitingStaleContext.subject` gains `"calendar"` (T017).
  `DECISION_POINTS` is **not** touched.
- `packages/core/src/policy/default-policy.ts` — one message branch in `stale()` (T018).
- `packages/core/src/waiting/waiting-service.ts` — `read()` added (T014).
  `packages/core/src/waiting/types.ts` — one doc comment widened (T012).
- `packages/core/src/index.ts` — additive exports only (T024).
- `packages/core/tests/retro-fakes.ts` — `readOnlyVault`'s guard message gains a parameter (T003). It
  currently reads "the retrospective touched `X` on the vault … (006 FR-051)", so a shutdown write path
  would fail loudly under the wrong feature's name. The parameter defaults to the existing wording, so
  every retrospective test is behaviourally untouched. This is a helper, not a test file — the "no existing
  test changes" prediction above still stands.

Plus three one-line client edits: `build:renderer` in the root `package.json` (T004), a tray entry (T060),
and the window wiring in `main.ts` (T061).

## The traps this feature's tests are prone to

Three assertions here can pass **vacuously** — they are true of a test whose subject never ran, or of a
value nothing could have touched. All three ship paired, and no pair may be collapsed:

1. **"The vault is byte-for-byte unchanged" (T033)** is true of a test that never opened the vault. T034
   dirties the same fixture through the same helper and asserts the comparison *fails*. It is not a test of
   the code; it is the reason T033 means anything.
2. **"No decision point was added" (T019)** is true of a test in which no panel was ever built. T042 asserts
   from the other side that `waiting.stale.check` **was** consulted, with `subject` `"item"` **and**
   `"calendar"`, so "consulted nothing" cannot masquerade as "consulted nothing new".
3. **"Membership did not change" (T072b)** is true of *any* immutable value, and `ShutdownView` is one —
   `ShutdownService` performs no action, so nothing could have changed it. T072a asserts from the other
   side that a **fresh** `read()` after the same writes *does* change: the chased item leaves the stale
   list, the received item is gone for good. The on-screen half of SC-012 is T082's, in the running app,
   because "the row updated in place and its neighbours did not move" is a renderer fact.

A fourth trap has no pair because it is structural: the vault stub is a Proxy that throws on any property
other than `list` and `read`, so a write path taken from `ShutdownService` fails loudly rather than
silently succeeding.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeletons and the fixture builders every later phase leans on

- [X] T001 Create `packages/core/src/shutdown/` with empty `types.ts` and `shutdown-service.ts`
- [X] T002 [P] Create `packages/core/src/calendar/` with empty `types.ts` and `calendar-document.ts`
- [X] T003 [P] Create `packages/core/tests/shutdown-fakes.ts` re-exporting `readOnlyVault`, `CountingVault`, `projectFile`, and `topThreeFile` from `packages/core/tests/retro-fakes.ts`, and adding `waitingFile()` and `calendarFile()` content builders that render lines through the shipped `waitingLine`/`calendarLine` helpers so a fixture cannot drift from the grammar the parsers expect. Also parameterize `readOnlyVault`'s guard
  message in `retro-fakes.ts` (defaulting to its current wording) so a shutdown write path does not fail
  under the retrospective's name
- [X] T004 [P] Add `shutdown.html` to the `build:renderer` script in the root `package.json`
- [X] T005 Add `policyFile()` and a recording policy spy to `packages/core/tests/shutdown-fakes.ts`: the spy wraps `createDefaultPolicy()`, records every `DecisionContext` it is handed, and returns the real decision, so tests can assert both which points were consulted and what they answered
- [X] T006 Add `shutdownFor(files)` to `packages/core/tests/shutdown-fakes.ts` — **not** `serviceFor()`, which already exists in `retro-fakes.ts` with a different shape (a sibling fixture file re-exported by T003): wires a `ShutdownService` over an in-memory vault with a real `ProjectService`, `TopThreeService`, and `WaitingService`, a fixed `Clock`, and the recording policy, returning the service, the counting vault, and the spy

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The calendar grammar, the single-read waiting verb, the third staleness subject, and the shape
of the view — everything all three stories call

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Reading `calendar.md`

- [X] T007 [P] Write failing test in `packages/core/tests/calendar-document.test.ts`: `readCalendar` reads `- <flagged-on> — [<capture-timestamp> ]<text>` per [calendar-format.md](./contracts/calendar-format.md), with and without a capture timestamp, rejoins two-space continuation lines with newlines, preserves file order, and assigns 0-based `index` among well-formed items
- [X] T008 [P] Write failing test in `packages/core/tests/calendar-unreadable.test.ts`: parsing never throws on any input including a file of noise; a malformed line is returned verbatim with its **1-based** line number and is never rewritten, normalized, or dropped; a continuation line inside an open item is that item's text and not an unreadable line; an empty file and an absent file both yield no items and no unreadable lines
- [X] T009 Define `CalendarItem` in `packages/core/src/calendar/types.ts` per [data-model.md](./data-model.md)
- [X] T010 Implement `CALENDAR_PATH` and `readCalendar(content)` in `packages/core/src/calendar/calendar-document.ts`, making T007 and T008 pass
- [X] T011 [P] Write failing test in `packages/core/tests/calendar-no-write-surface.test.ts`: the calendar module's exports contain no function that writes, appends, renders a line, or takes a ref — asserted over the module's own export names, the way `suggest-no-write-surface.test.ts` asserts its equivalent (FR-031, FR-042)
- [X] T012 Widen the `UnreadableLine` doc comment in `packages/core/src/waiting/types.ts` from "a line of `waiting.md`" to "a line of a running list"; no code changes, and `waiting-document.test.ts` passes unmodified

### One read of `waiting.md`

- [X] T013 Write failing test in `packages/core/tests/waiting-read-once.test.ts`: `WaitingService.read()` returns exactly what `list()` and `unreadable()` return for the same content, and reads `waiting.md` **once** — asserted with the counting vault, and asserted to be two reads when `list()` and `unreadable()` are called separately, so the reason the method exists is visible in the test
- [X] T014 Implement `WaitingService.read()` in `packages/core/src/waiting/waiting-service.ts`; `list()` and `unreadable()` are untouched and `waiting-service.test.ts` passes unmodified

### One rule, a third subject

- [X] T015 [P] Write failing test in `packages/core/tests/calendar-staleness-rule.test.ts`: `waiting.stale.check` with `subject: "calendar"` returns `warn` at and past `stalenessDays`, `allow` below it, and `allow` for an unreadable or future date; the boundary day itself is asserted on both sides; the reason names the day count and the calendar remediation per [shutdown-api.md](./contracts/shutdown-api.md) §2, pluralizing through the existing helper
- [X] T016 [P] Write failing test in `packages/core/tests/shutdown-shared-threshold.test.ts`: one `policy.md` value drives all three subjects — `"item"`, `"project"`, and `"calendar"` given the same `since` and `today` get the same verdict at the same boundary, and changing `staleness days` moves all three together; no calendar-specific key is read from `policy.md` and none is added to `PolicyConfig`
- [X] T017 Widen `WaitingStaleContext.subject` to `"item" | "project" | "calendar"` in `packages/core/src/ports/index.ts`, updating its doc comment to say the subject decides the message and never the decision; **`DECISION_POINTS` is not edited**
- [X] T018 Add the calendar branch to `stale()` in `packages/core/src/policy/default-policy.ts`, making T015 and T016 pass; `default-policy.test.ts` passes unmodified
- [X] T019 [P] Write test in `packages/core/tests/shutdown-adds-no-decision-point.test.ts`: `DECISION_POINTS` has exactly five entries and contains no point whose name mentions calendar, shutdown, or a day — the sibling of T042, which asserts from the other side that the existing point *was* consulted (FR-039)

### The shape of the view

- [X] T020 Define `SourceFailure` and `Panel<T>` in `packages/core/src/shutdown/types.ts` per [data-model.md](./data-model.md), as a two-state union so an empty panel and a failed panel cannot be the same value
- [X] T021 Define `TopThreePanel`, `MyProject`, `StaleWaiting`, `StaleCalendar`, and `ShutdownView` in `packages/core/src/shutdown/types.ts` per [data-model.md](./data-model.md). `TopThreePanel` is a two-state union like `Panel<T>` — `{ week: Week; failure: null } | { week: null; failure: SourceFailure }` — so an unreadable `top-three.md` cannot be represented as a fabricated empty week (FR-011c, FR-009)
- [X] T022 Write failing test in `packages/core/tests/shutdown-empty-vault.test.ts`: against a vault with no files at all, `read()` resolves (never rejects), returns `today` from the injected clock, and returns `topThree` as `{ week, failure: null }` with the week holding no outcomes, and the three list panels each as `{ items: [], failure: null }` — the explicit empty state, with zero errors (FR-011, SC-011)
- [X] T023 Implement `ShutdownService` in `packages/core/src/shutdown/shutdown-service.ts` with `ShutdownServiceDeps` narrowed per [shutdown-api.md](./contracts/shutdown-api.md) §1 — `vault: Pick<VaultStore, "read">`, structural `ProjectSource`/`TopThreeSource`/`WaitingSource`, no intelligence dependency — and `read()` returning `today` and four empty panels, making T022 pass
- [X] T024 Export the public surface from `packages/core/src/index.ts` per [shutdown-api.md](./contracts/shutdown-api.md) §1; additive only, no existing export changes signature

**Checkpoint**: The calendar grammar reads, `waiting.md` reads once, the rule answers for three subjects
from one threshold, and `read()` exists and returns an empty screen. User stories can begin.

---

## Phase 3: User Story 1 - See the Whole Day's Loose Ends on One Screen (Priority: P1) 🎯 MVP

**Goal**: Four panels — the current week's top three, the user's active projects with their next actions and
open milestones, stale waiting-for items, stale calendar flags — presented together on one screen, read at
one moment, changing nothing on disk.

**Independent Test**: With a fixture holding a current-week top three (one done, two open), six projects
covering active/waiting/parked/done and DRIs resolving to mine, someone else's, unassigned, and ambiguous,
four waiting-for items on either side of the threshold with and without follow-ups, and three
calendar-flagged items on either side, open the shutdown and confirm each panel shows exactly the right
members and nothing else. Then confirm opening and closing leaves the vault byte-for-byte unchanged.

### Tests for User Story 1 ⚠️ Write first, watch fail, then implement

- [X] T025 [P] [US1] Write failing test in `packages/core/tests/shutdown-top-three-panel.test.ts`: the panel shows the **current ISO week only**, with open and done outcomes together in file order, each done outcome's `completedOn`, and text verbatim; a week with no section gives an empty panel that is not an error and proposes nothing; no past or future week is reachable through the returned value (FR-012–FR-016)
- [X] T026 [P] [US1] Write failing test in `packages/core/tests/shutdown-project-panel.test.ts`: against a fixture crossing every status (`active`, `waiting`, `parked`, `done`) with every DRI resolution (mine, theirs, unassigned, ambiguous), the panel lists exactly the active-and-mine projects and nothing else — ambiguous and unassigned are never listed and nothing guesses the human behind them (FR-017–FR-019, SC-007)
- [X] T027 [P] [US1] Write failing test in `packages/core/tests/shutdown-project-detail.test.ts`: each listed project carries its title, its next action verbatim or `null` where none is recorded, and its **open** milestones only; nothing is inferred where a next action is absent; the list is in slug order and is never limited, truncated, or ranked, including at thirty projects (FR-020–FR-023)
- [X] T028 [P] [US1] Write failing test in `packages/core/tests/shutdown-waiting-panel.test.ts`: only outstanding items are listed; an item with a recorded receipt is absent at any age; staleness is measured from the last recorded action and not from `since`, so an item chased yesterday but delegated three months ago is absent; each listed item carries owner, verbatim text, `untouchedDays`, and `waitingDays` (FR-024–FR-027)
- [X] T029 [P] [US1] Write failing test in `packages/core/tests/shutdown-calendar-panel.test.ts`: exactly those flags at or past the threshold are listed, each with verbatim text and `unscheduledDays`; a flag with an unreadable or future date is never listed (FR-028, FR-029a)
- [X] T030 [P] [US1] Write failing test in `packages/core/tests/shutdown-one-threshold.test.ts`: against waiting items, waiting projects, and calendar flags dated 0–30 days back, assert membership of all three sets at the default of 7 and at one other configured value, including the boundary day on both sides — one number moves all three or the test fails (SC-006)
- [X] T031 [P] [US1] Write failing test in `packages/core/tests/shutdown-ordering.test.ts`: every panel is in source order — file order for the three lists, slug order for projects — and two `read()` calls over unchanged data produce identical values; nothing is sorted by age, staleness, or urgency (FR-009, FR-010, US1 scenario 15)
- [X] T032 [P] [US1] Write failing test in `packages/core/tests/shutdown-ages.test.ts`: every day count comes from the single `today` on the view; `untouchedDays` and `waitingDays` for one item are computed against that same date and cannot disagree; advancing the clock after `read()` changes nothing in the returned value (edge case "the date changes while the screen is open")
- [X] T033 [P] [US1] Write failing test in `packages/core/tests/shutdown-changes-nothing.test.ts`: snapshot every file in a populated fixture, call `read()`, read every panel, and compare byte for byte; the vault stub throws on any property other than `list` and `read`, so a write path fails loudly (FR-053, SC-002)
- [X] T034 [US1] Write test in `packages/core/tests/shutdown-changes-nothing.test.ts` pairing T033 (same file as T033, so **not** parallel with it): dirty the same fixture through the same snapshot helper and assert the comparison **fails**. Do not delete this because it "tests the test" — it is the reason T033 means anything
- [X] T035 [P] [US1] Write failing test in `packages/core/tests/shutdown-no-files-created.test.ts`: with no `top-three.md`, no `waiting.md`, no `calendar.md`, and no `policy.md`, `read()` creates none of them and no directory; the vault is inspected after the call and holds exactly what it held before (FR-011c, Principle IV)
- [X] T036 [P] [US1] Write failing test in `packages/core/tests/shutdown-source-failure.test.ts`: a source that throws on read produces `failure: { path, message }` on its own panel with `items: []`, while the other three panels are built, populated, and returned; `read()` still resolves; a **missing** file is the empty state and never a failure, so "nothing here" and "could not read this" are different values (FR-011b, FR-011c)
- [X] T037 [P] [US1] Write failing test in `packages/core/tests/shutdown-degradation.test.ts`: five paths — no `policy.md`, a `staleness days` that will not parse, no `waiting.md`, no `calendar.md`, an unreadable project file — each leave `read()` resolving with every unaffected panel built and its actions' inputs intact (SC-011a)
- [X] T038 [P] [US1] Write failing test in `packages/core/tests/shutdown-unreadable-lines.test.ts`: unreadable lines from `waiting.md` and `calendar.md` are surfaced on the view with their 1-based line numbers and verbatim text, are never listed as stale, never counted toward a panel, never rewritten, and never dropped (FR-032)
- [X] T039 [P] [US1] Write failing test in `packages/core/tests/shutdown-policy-notices.test.ts`: an absent `policy.md` applies the documented default of 7 with no notice; a malformed `staleness days` applies the default for that value alone, reports the problem in `policyNotices` for display, and never throws or blocks (FR-030)
- [X] T040 [P] [US1] Write failing test in `packages/core/tests/shutdown-reads.test.ts`: over a 100-project fixture with a populated `waiting.md` and `calendar.md`, one `read()` reads each **panel source** at most once — `top-three.md`, `identity.md`, every `projects/*.md`, `waiting.md`, `calendar.md` — asserted over the read log **filtered to those paths**, the way `review-read-count.test.ts` filters to `projects/`, with the failure message naming any repeated path. **`policy.md` is excluded and asserted separately**: `DefaultPolicy.decide()` re-reads its config on every decision, so it is read once per candidate item and a bare `maxReadCount() === 1` would fail on any populated fixture — it must not be used here. Counted, never timed (FR-011a, SC-013)
- [X] T041 [P] [US1] Write failing test in `packages/core/tests/shutdown-offline.test.ts`: `read()` completes with every network primitive stubbed to throw, and no outbound attempt is made — mirroring `retrospective-offline.test.ts` and `review-no-outbound.test.ts` (FR-008, SC-009)
- [X] T042 [P] [US1] Write failing test in `packages/core/tests/shutdown-nothing-generated.test.ts`: the recording spy shows the **only** point consulted during a full `read()` is `waiting.stale.check`, that it **was** consulted with `subject: "item"` and with `subject: "calendar"`, and that every string on the view is either verbatim from a source file or the policy module's own reason — nothing is summarized, scored, ranked, or suggested (FR-009, and the sibling of T019)

### Implementation for User Story 1

- [X] T043 [US1] Implement the top-three panel in `packages/core/src/shutdown/shutdown-service.ts` from `TopThreeSource.current()`, making T025 pass
- [X] T044 [US1] Implement the project panel from `ProjectSource.listDetailed()`, filtering on `status === "active" && dri.resolution === "mine"` using core's existing resolution unchanged, making T026 pass
- [X] T045 [US1] Populate `MyProject` with the next action and open milestones from the same pass, making T027 pass — no second read of any project file
- [X] T046 [US1] Implement the waiting panel from `WaitingSource.read()`: filter with the shipped `outstanding()`, ask `waiting.stale.check` with `subject: "item"` about `untouchedSince(item)`, and carry the policy reason through untouched, making T028 pass
- [X] T047 [US1] Implement the calendar panel from `vault.read(CALENDAR_PATH)` and `readCalendar`, asking the same point with `subject: "calendar"` about `flaggedOn`, making T029 and T030 pass
- [X] T048 [US1] Compute `today` once at the top of `read()` from the injected clock and derive every day count from it with the shipped `daysBetween`, making T031 and T032 pass — no second definition of "how many days"
- [X] T049 [US1] Wrap each panel's construction in its own `try`/`catch` producing `SourceFailure`, so `read()` never rejects, making T036 and T037 pass
- [X] T050 [US1] Surface `unreadableWaiting`, `unreadableCalendar`, and `policyNotices` on the view, making T038 and T039 pass
- [X] T051 [US1] Verify T033, T034, T035, T040, T041, and T042 pass against the completed `read()`; fix any per-item read the count test exposes

### The window (User Story 1)

- [X] T052 [P] [US1] Write failing test in `packages/desktop/tests/shutdown-window.test.ts`: `ShutdownWindow.show()` sends `shutdown:opened` to its renderer every time it is shown, including when the window already exists and was merely hidden, so a second opening is a cold one (FR-010c, research R8)
- [X] T053 [P] [US1] Write failing test in `packages/desktop/tests/shutdown-no-refresh.test.ts`: `ShutdownWindow` exposes no `vaultChanged`/`inboxChanged` handler and `main.ts` registers no change subscription for it — membership is fixed at open and no panel re-reads while the screen stays open (FR-010a, FR-011a, research R7)
- [X] T054 [US1] Implement `packages/desktop/src/main/shutdown-window.ts` following `top-three-window.ts` in shape: hides on close, `show()` sends `shutdown:opened`, subscribes to nothing
- [X] T055 [US1] Add `registerShutdownIpc` to `packages/desktop/src/main/ipc.ts` handling `shutdown:read` and `shutdown:dismiss` per [shutdown-api.md](./contracts/shutdown-api.md) §4
- [X] T056 [US1] Add the `shutdown` bridge to `packages/desktop/src/preload/preload.ts` with `read`, `dismiss`, and `onOpened` — no domain logic, no threshold, no filter, no sentence about the user's data
- [X] T057 [US1] Create `packages/desktop/src/renderer/shutdown.html`: four panels rendered together, unnumbered, in no sequence, with no "next", no step, no progress indicator, and no completion affordance (FR-001, FR-002, FR-005)
- [X] T058 [US1] Implement `packages/desktop/src/renderer/shutdown.ts` rendering the four panels from `ShutdownView`, including each panel's explicit empty state, its failure state naming the file, the unreadable-line lists, and any policy notice — displaying core's strings and composing none of its own
- [X] T059 [US1] Re-read on `shutdown:opened` as well as on first load in `packages/desktop/src/renderer/shutdown.ts`, making T052's behaviour reachable from the renderer
- [X] T060 [US1] Add a "Daily shutdown" entry to `packages/desktop/src/main/tray.ts` — the only way the screen opens; no schedule, timer, launch-on-open, or prompt is added anywhere (FR-006, FR-007)
- [X] T061 [US1] Wire `ShutdownService` and `ShutdownWindow` in `packages/desktop/src/main/main.ts` over the existing `projectService`, `topThreeService`, `waitingService`, `vaultStore`, and the default policy; register no `vaultChanged` or `inboxChanged` subscription for this window
- [X] T062 [P] [US1] Write `packages/desktop/tests/e2e/shutdown-glance.spec.ts`: open from the tray against a populated fixture vault, assert all four panels are present together with the expected members, close and reopen and assert the same screen from cold with no resume and no prompt, and assert the vault is unchanged afterwards (SC-002, SC-010)

**Checkpoint**: The shutdown opens, shows four true panels, and changes nothing. This is a complete,
shippable increment — a read-only shutdown already answers "is anything hanging, and what am I walking into
tomorrow?"

---

## Phase 4: User Story 2 - Act on What I See Without Leaving the Screen (Priority: P2)

**Goal**: Mark an outcome done, mark a milestone done, change a next action, record a follow-up, record a
receipt — each through the same core verb the ordinary surface calls, with the same validation, refusals,
ledger writes, and policy consultation.

**Independent Test**: From the shutdown alone, perform all five actions. Confirm each produces the
byte-identical file change the same action produces from its existing surface, that every decision point is
consulted with the same result, that a refusal carries the same reason text, and that no additional file is
written by any of them.

### Tests for User Story 2 ⚠️ Write first, watch fail, then implement

- [X] T063 [P] [US2] Write failing test in `packages/core/tests/shutdown-parity-outcome.test.ts`: two identical vaults; `TopThreeService.completeOutcome` invoked as the shutdown invokes it and as the top-three window invokes it; `top-three.md` compared byte for byte, including the local completion date (FR-033, SC-004)
- [X] T064 [P] [US2] Write failing test in `packages/core/tests/shutdown-parity-milestone.test.ts`: the same comparison for `ProjectService.completeMilestone`, with the project file compared whole so the ledger line is included (FR-034)
- [X] T065 [P] [US2] Write failing test in `packages/core/tests/shutdown-parity-next-action.test.ts`: the same comparison for `ProjectService.setNextAction`, asserting only the next action changed and every other field and section of the project file is untouched (FR-035)
- [X] T066 [P] [US2] Write failing test in `packages/core/tests/shutdown-parity-waiting.test.ts`: `WaitingService.recordFollowUp` appends `followed up <date>` under the item and preserves `since`; `recordReceived` appends `received <date>`; `waiting.md` is byte-identical to the same verb's result from the review's path (FR-036, FR-036a)
- [X] T067 [P] [US2] Write failing test in `packages/core/tests/shutdown-writes-no-record.test.ts`: after every one of the five actions, no file under `log/` is created or modified, no daily log, history, counter, or timestamp of any kind appears anywhere in the vault, and nothing resembling a daily plan, a tomorrow list, a carried-over item, or a day's state is written to any file (FR-052); the only changed bytes are in the file the verb owns — verified by full-vault comparison against the same changes made from the existing surfaces (FR-050, FR-051, FR-052, SC-003)
- [X] T068 [P] [US2] Write failing test in `packages/core/tests/shutdown-refusal-parity.test.ts`: for each reachable refusal — an outcome or milestone whose line changed on disk, a `not-found` waiting item, a policy `block` — the shutdown's path returns the same `reason` and the same `message` as the ordinary surface's, character for character (FR-038, SC-005)
- [X] T069 [P] [US2] Write failing test in `packages/core/tests/shutdown-verify-before-write.test.ts`: an item edited in a text editor between being shown and being written causes the write to be refused, the file to be left unchanged, and the item to be re-presented as it now reads (FR-040)
- [X] T070 [P] [US2] Write failing test in `packages/core/tests/shutdown-warn-not-bypassed.test.ts`: where a rule warns rather than blocks, the shutdown's path surfaces the same warning and the same choice; no parameter or flag on any core verb offers a bypass, override, suppression, or "don't ask again". The channel and bridge half of that assertion is **T071's**, because core imports nothing from Electron and cannot see them (FR-039, FR-041)
- [X] T071 [P] [US2] Write failing test in `packages/desktop/tests/shutdown-ipc-contract.test.ts`: `waiting:record-follow-up` and `waiting:record-received` call `WaitingService` directly and **not** `ReviewService`; no channel named for the shutdown performs a write; the next-action channel is the projects window's own `projects:set-field` with field `"next-action"`; **no channel, handler, or bridge method writes to `calendar.md`, clears a flag, or schedules anything** — the client half of T073, asserted here because core cannot see a channel; and `shutdown:dismiss` is an `ipcMain.on` window-hide that writes nothing, matching `top-three:dismiss` and the four other shipped windows (FR-042, research R2, [shutdown-api.md](./contracts/shutdown-api.md) §3, §4)
- [X] T072 [P] [US2] Write failing test in `packages/core/tests/shutdown-membership-frozen.test.ts`, **in two halves that pair**: **(a)** a fresh `read()` after `recordFollowUp` shows the chased item gone from the stale list, and after `recordReceived` gone for good — this half has teeth and must fail before T046/T047 exist; **(b)** the view value returned *before* those writes is unchanged by them, including under a concurrent write from a second vault handle. (b) alone is true of any immutable value and may never ship without (a) — the same pairing T033/T034 and T019/T042 use. SC-012's on-screen half — membership and order unchanged in the rendered panels, only the acted-on row differing — is **T082's**, because `ShutdownService` performs no action at all (FR-010a, FR-010c)
- [X] T073 [P] [US2] Write failing test in `packages/core/tests/shutdown-calendar-read-only.test.ts`: nothing **in core** can write a calendar flag — `packages/core/src/calendar/` exports no writer, appender, or line renderer, there is no `CalendarRef`, `StaleCalendar` carries no ref a verb could take, and no core verb accepts a `CalendarItem`; calendar items are information only. The channel and bridge half is **T071's**, because core cannot see them (FR-042)
- [X] T074 [P] [US2] Write failing test in `packages/core/tests/shutdown-no-action-no-write.test.ts`: a `read()` followed by no action writes nothing, defaults nothing, and marks nothing as seen, acknowledged, or reviewed. The close-the-window half is **T062's**, which asserts the vault unchanged across a close and a reopen (FR-041, US2 scenario 12)

### Implementation for User Story 2

- [X] T075 [US2] Add `waiting:record-follow-up` and `waiting:record-received` to `packages/desktop/src/main/ipc.ts`, calling `WaitingService.recordFollowUp` and `recordReceived` directly; channels named for the verb, not for this screen
- [X] T076 [US2] Add the five action methods to the `shutdown` bridge in `packages/desktop/src/preload/preload.ts`, each forwarding to the channel the ordinary surface uses per [shutdown-api.md](./contracts/shutdown-api.md) §4
- [X] T077 [US2] Wire `waitingService` into `registerShutdownIpc`'s registration in `packages/desktop/src/main/main.ts`
- [X] T078 [US2] Add the outcome-done and milestone-done affordances to `packages/desktop/src/renderer/shutdown.ts`, updating the acted-on row in place from the verb's return value and leaving membership and order untouched
- [X] T079 [US2] Add the next-action edit affordance to `packages/desktop/src/renderer/shutdown.ts`, sending the value it was shown as `expected` so verify-before-write can refuse a stale write
- [X] T080 [US2] Add the follow-up and received affordances to `packages/desktop/src/renderer/shutdown.ts`, offering **both** on every listed item with neither inferred, preferred, nor defaulted (FR-036a)
- [X] T081 [US2] Render refusals and warnings in `packages/desktop/src/renderer/shutdown.ts` using the `reason` and `message` core returns, verbatim, with no bypass, no suppression, and no "don't ask again"; on `entry-changed`, re-present the row as the refusal reports it
- [X] T082 [P] [US2] Write `packages/desktop/tests/e2e/shutdown-actions.spec.ts`: from the running app, mark an outcome done, mark a milestone done, replace a next action, chase one waiting item and receive another, then attempt something a rule refuses and assert the message matches the weekly review's; assert panel membership and order are unchanged for the rest of the opening with only the acted-on row showing its new state, and that reopening rebuilds — **this is where SC-012 and FR-010b are proven**, because the in-place row update is a renderer behaviour that core cannot express (SC-012, FR-010b)

**Checkpoint**: Everything visible on the shutdown is actionable from it, through verbs that do not know
this screen exists.

---

## Phase 5: User Story 3 - Dump What's Still in My Head Into the Inbox (Priority: P3)

**Goal**: A capture box on the shutdown that writes to the ordinary inbox through the ordinary verb, leaving
nothing that records where the thought was typed.

**Independent Test**: From the shutdown, capture three items in a row and confirm each lands in the inbox
with the same grammar, timestamp, and undo behaviour as an item captured from the existing capture surface,
that focus stays on the shutdown throughout, and that the inbox file is indistinguishable from one produced
by capturing the same three items anywhere else.

### Tests for User Story 3 ⚠️ Write first, watch fail, then implement

- [X] T083 [P] [US3] Write failing test in `packages/desktop/tests/shutdown-capture-parity.test.ts`: three captures made through the shutdown's bridge produce an `inbox.md` byte-identical to the same three made through the capture window's, with the same grammar and capture timestamps and no marker, tag, field, or ordering recording their origin (FR-044, FR-045, SC-008)
- [X] T084 [P] [US3] Write failing test in `packages/desktop/tests/shutdown-capture-behaviour.test.ts`: consecutive captures are separate items in capture order with no merging, splitting, deduplication, or rewriting; an empty or whitespace-only entry captures nothing; the shutdown's capture uses the existing `capture:submit` channel and adds no channel of its own. FR-046's responsiveness budget is **inherited from `CaptureService` and deliberately not re-asserted here** — no capture code is added, changed, or wrapped, so re-testing the budget would be re-testing Feature 1 (FR-047, FR-048; FR-046 inherited)
- [X] T085 [P] [US3] Write failing test in `packages/desktop/tests/shutdown-capture-undo.test.ts`: a capture made from the shutdown is undoable through the existing `capture:undo` verb with the same behaviour it has at the capture surface, and the tray's undo entry continues to reflect it (FR-049)

### Implementation for User Story 3

- [X] T086 [US3] Add `capture` and `undoCapture` to the `shutdown` bridge in `packages/desktop/src/preload/preload.ts`, forwarding to the existing `capture:submit` and `capture:undo` channels; no new channel, no new service, no change to `CaptureService`
- [X] T087 [US3] Add the capture box to `packages/desktop/src/renderer/shutdown.html` and `shutdown.ts`: confirming captures and clears the box, focus stays on the shutdown, no panel is navigated away from, and closing mid-typing saves no draft
- [X] T088 [US3] Render the same undo affordance the capture surface renders after a successful capture in `packages/desktop/src/renderer/shutdown.ts`, calling `capture:undo` with the returned id
- [X] T089 [P] [US3] Write `packages/desktop/tests/e2e/shutdown-capture.spec.ts`: type three thoughts in a row from the running shutdown, assert each lands in the inbox in order, assert focus never leaves the screen, assert an empty entry captures nothing, and assert undo behaves as it does at the capture surface

**Checkpoint**: The two-minute pass is complete — read four panels, fix what is quick, empty the head, close
the laptop.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T090 [P] Write `packages/core/tests/shutdown-vocabulary.test.ts`: the feature's exported surface introduces no domain term the core does not already have, and no string it produces contains the word "shutdown" — the word names a window, and nothing on disk knows it (FR-039, Principle VII)
- [X] T091 [P] Write `packages/core/tests/shutdown-scope-boundaries.test.ts` following `project-scope-boundaries.test.ts`: `packages/core/src/shutdown/` and `packages/core/src/calendar/` import nothing from Electron, nothing from `node:http`/`node:https`/`node:net`, and nothing from the review or intelligence modules
- [X] T092 [P] Add `shutdown.html` copying to the `build:renderer` verification: run `npm run build` from clean and confirm `packages/desktop/dist/src/renderer/shutdown.html` exists (T004's edit, proven)
- [X] T093 Run `npm run typecheck && npm test && npm run test:e2e` and confirm Features 1–8 suites pass unmodified, `decision-points.test.ts` is untouched and green, and `git diff --stat` shows no change to `package-lock.json` and no new dependency in either workspace
- [X] T094 Walk [quickstart.md](./quickstart.md) end to end, including the two manual scenarios no unit test can make: **scenario 9**, the under-two-minute read (SC-001), and **scenario 7**, the offline pass with networking actually disabled (SC-009)
- [X] T095 [P] Update `ROADMAP.md`: mark Feature 9 shipped with its date, and record what shipped — the four-panel glance, the calendar list read for the first time, the third staleness subject on the existing point, and the fact that no on-disk representation was added
- [X] T096 [P] Record in [plan.md](./plan.md) any deviation from the Complexity Tracking table found during implementation, including whether the `projects/` failure naming concession held as predicted

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start here
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.** T007–T012 (calendar), T013–T014
  (single read), T015–T019 (the rule), and T020–T024 (the shape) are four independent tracks within it and
  can proceed in parallel
- **US1 (Phase 3)**: depends on Foundational. No dependency on US2 or US3
- **US2 (Phase 4)**: depends on Foundational, and on US1's window existing for its client half (T075–T082).
  Its core parity tests (T063–T070, T072–T074) depend only on Foundational and can be written and run
  before the window exists
- **US3 (Phase 5)**: depends on Foundational, and on US1's window for its client half. Independent of US2
- **Polish (Phase 6)**: depends on every story it checks

### Within each story

Tests before implementation, always. Within Phase 3, T025–T042 are parallel except T034, which appends to
T033's file; T043–T051 are sequential (one file, `shutdown-service.ts`); T052–T062 are mostly sequential
across the client files they share.

### Parallel opportunities

- **Phase 1**: T002, T003, and T004 parallel after T001. **T005 and T006 are sequential after T003** — all
  three write `shutdown-fakes.ts`
- **Phase 2**: the four tracks named above; within them T007/T008, T015/T016, and T019 are parallel
- **Phase 3**: seventeen test tasks in parallel (T025–T042, with **T034 sequential after T033** — they
  share `shutdown-changes-nothing.test.ts`) — the largest parallel block in the feature
- **Phase 4**: twelve test tasks (T063–T074) in parallel
- **Phase 5**: three test tasks (T083–T085) in parallel
- **Phase 6**: T090, T091, T092, T095, T096 in parallel; T093 and T094 last

---

## Implementation Strategy

### MVP

**Phases 1–3 (T001–T062).** A read-only shutdown that shows four true panels and changes nothing is the
smallest genuinely useful slice, and the spec says so: the glance alone is what makes the end of the day
feel closed. Ship it, use it for a week, and let that decide whether the actions land as designed.

### Incremental delivery

1. **Foundational** — the calendar reads, `waiting.md` reads once, one rule answers for three subjects
2. **US1** — the glance. Independently valuable, independently testable, writes nothing
3. **US2** — acting from where you see it. Turns a two-minute glance that spawns a ten-minute detour back
   into a two-minute glance
4. **US3** — emptying the head. The last thing the pass needs, and the cheapest, because capture already
   exists everywhere else

Each phase leaves the app shippable. Nothing in a later phase changes anything an earlier phase built.
