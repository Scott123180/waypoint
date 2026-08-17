---

description: "Task list for 006-retrospective-view"
---

# Tasks: Retrospective View

**Input**: Design documents from `/specs/006-retrospective-view/`

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
- **Suffixed IDs** (T011a, T026a…) are tasks added after the first numbering pass, sitting in the phase they
  belong to. Suffixes rather than a renumber, so every cross-reference in this file stays valid. Every one
  here was added by the `/speckit-analyze` pass on 2026-08-16; the finding that produced it is cited inline

## Path Conventions

npm workspaces monorepo: `packages/core/src`, `packages/core/tests`, `packages/desktop/src`. Core holds all
domain logic and imports nothing from Electron; the desktop client renders and routes input only.

## The existing tests that change

**One, and it was not the one this section predicted.** The claim here was "none", and that was wrong —
recorded rather than quietly amended, because the number of old tests a feature disturbs is the honest
measure of how far it reached.

- `packages/core/tests/project-scope-boundaries.test.ts` — a Feature 3 guard asserting that core exports
  nothing matching `/weeklyreview|retrospective|httpserver/i`, on the grounds that each named a *later*
  feature. Feature 6 is now that feature, so `retrospective` was removed from the pattern with a dated note
  explaining why; `httpserver` stays, because Feature 7 has not shipped. The guard did exactly its job: it
  fired the moment a new surface appeared, and forced a deliberate decision instead of an accident.

`decision-points.test.ts` **is** unedited and still asserts five points (T100), which was the prediction that
mattered — no rule was added.

**If any existing test needs changing, stop and say so here with the reason before changing it.** On this
branch specifically, an edit to an old test is a strong signal that something has been added to a shipped
shape that this feature was not supposed to touch — an unexplained edit is a scope breach wearing a test edit
as a disguise.

Two shipped files *are* edited, both additively and neither breaking an existing assertion:

- `packages/core/src/weekly/iso-week.ts` gains `weekEnd(id)` (T068). `iso-week.test.ts` and
  `iso-week-arithmetic.test.ts` pass unmodified.
- `packages/core/src/index.ts` gains exports (T010). No existing export changes signature.

Plus two one-line build/menu edits: `build:renderer` in the root `package.json` (T003) and a tray entry
(T041).

## The trap this feature's tests are prone to

**A read-only feature's headline assertion can pass vacuously.** "The vault is byte-for-byte unchanged" is
true of a test that never ran the service, never opened the vault, or silently caught an error. T017 is
therefore paired with T018, which dirties the same fixture through a different path and asserts the check
*fails* — a guard that the guard works. Do not delete T018 because it "tests the test"; it is the reason
T017 means anything.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeleton and the test scaffolding every later phase leans on

- [x] T001 Create `packages/core/src/retrospective/` with empty `types.ts`, `select.ts`, `weeks.ts`, `report.ts`, and `retrospective-service.ts`
- [x] T002 [P] Create `packages/core/tests/retro-fakes.ts`: an in-memory `Pick<VaultStore, "list" | "read">` that counts reads per path and is wrapped in a Proxy throwing on any property other than `list` and `read`, so every test using it proves no write path was taken
- [x] T003 [P] Add `retrospective.html` to the `build:renderer` script in the root `package.json`
- [x] T004 [P] Add vault content builders to `packages/core/tests/retro-fakes.ts`: project files with milestones and ledgers, a `top-three.md` spanning weeks, and `log/YYYY-Www.md` files in both complete and in-progress states

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shapes and the one verb every user story calls

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Define `DateRange`, `RetrospectiveQuery`, `RetrospectiveRefusal`, and `RetrospectiveResult` in `packages/core/src/retrospective/types.ts` per [data-model.md](./data-model.md)
- [x] T006 Define `Completion`, `CompletionKind`, `OutcomeCompletion`, `OutcomeWeekGroup`, `WeekNarrative`, `UnreviewedWeeks`, `Narrative`, `ProjectScoped<T>`, `ProjectHistory`, `UnreadableSource`, and `Retrospective` in `packages/core/src/retrospective/types.ts`
- [x] T007 [P] Write failing test in `packages/core/tests/retrospective-refusals.test.ts`: `read` refuses `invalid-date` when an endpoint is not `YYYY-MM-DD`, and `range-inverted` when `to < from`, each with a message naming the offending values, and neither reading nor writing anything
- [x] T008 Implement `RetrospectiveService` in `packages/core/src/retrospective/retrospective-service.ts` with `RetrospectiveServiceDeps` narrowed by `Pick<>` (no `policy`, no `clock`), and `read(query)` returning refusals per T007 and an otherwise-empty `Retrospective`
- [x] T009 Implement `renderReport(retrospective)` header in `packages/core/src/retrospective/report.ts`: the range line, and the project line when narrowed, per [report-format.md](./contracts/report-format.md) §2
- [x] T010 Export the public surface from `packages/core/src/index.ts` per [retrospective-api.md](./contracts/retrospective-api.md) §5

**Checkpoint**: `read` exists, refuses correctly, and renders a header. User stories can begin.

---

## Phase 3: User Story 1 - See What I Actually Finished Over a Range I Choose (Priority: P1) 🎯 MVP

**Goal**: A chosen date range returns every milestone and project completed in it, each milestone naming its
project, ordered by completion date, with undated records shown as undated and never placed.

**Independent Test**: With a fixture of completions spread across fourteen months plus several marked done
with no date, read a range covering part of that span. Confirm exactly the dated in-range completions appear,
each milestone names its project, the order is stable across repeated reads, undated entries appear as undated
with no date invented, and no file in the vault changes.

### Tests for User Story 1 ⚠️

> Write these first and observe each fail for the right reason before implementing.

- [x] T011 [P] [US1] Boundary selection in `packages/core/tests/retrospective-range.test.ts`: completions dated `from - 1`, `from`, `to`, and `to + 1`, asserting both endpoints are inclusive (SC-002)
- [x] T011a [P] [US1] No timezone conversion in `packages/core/tests/retrospective-range.test.ts`: completions dated on a DST-transition day and on either side of it are selected on their recorded text alone, asserted under at least two `TZ` values so a regression to instant comparison fails rather than passing under the pinned zone (FR-002) — *analysis finding C2*
- [x] T012 [P] [US1] Project attribution in `packages/core/tests/retrospective-completions.test.ts`: every milestone completion carries its project's current title, including a project renamed after the milestone was completed (FR-007)
- [x] T013 [P] [US1] Project completions in `packages/core/tests/retrospective-completions.test.ts`: a project with a completion date in range appears as a `project` completion, distinct from any milestone (FR-006)
- [x] T014 [P] [US1] Ordering in `packages/core/tests/retrospective-ordering.test.ts`: date descending, with two milestones on different projects sharing a date appearing in a stable order identical across repeated reads (FR-008, SC-003)
- [x] T015 [P] [US1] Undated split in `packages/core/tests/retrospective-undated.test.ts`: a record marked done with a null date lands in `undated` with `completedOn` and `rawDate` both null; one with `2026-13-45` lands in `undated` with `rawDate` verbatim and `completedOn` null, and appears in neither the dated set nor the range (FR-016, FR-018)
- [x] T016 [P] [US1] No reconciliation in `packages/core/tests/retrospective-never-repairs.test.ts`: a project carrying a completion date while `status:` says `active` is selected on the date and shown with the status as it reads, with neither repaired (FR-019)
- [x] T017 [P] [US1] Immutability in `packages/core/tests/retrospective-immutable.test.ts`: hash every file in a fixture vault before and after a read, asserting no change (SC-004, FR-051)
- [x] T018 [P] [US1] The guard's guard in `packages/core/tests/retrospective-immutable.test.ts`: dirty the same fixture through a direct write and assert the hash comparison from T017 *fails*, proving the assertion is not vacuous
- [x] T019 [P] [US1] Read counting in `packages/core/tests/retrospective-reads.test.ts`: over a four-year range across 100 projects, each project file is read exactly once and nothing reads inside a per-entry loop (SC-019)
- [x] T020 [P] [US1] Completeness in `packages/core/tests/retrospective-complete-result.test.ts`: a fixture of 2,000 dated completions over four years returns all 2,000, with nothing capped, sampled, or truncated (FR-006a, SC-022)
- [x] T021 [P] [US1] Offline in `packages/core/tests/retrospective-offline.test.ts`, mirroring `project-offline.test.ts` (SC-016)
- [x] T022 [P] [US1] Empty range in `packages/core/tests/retrospective-empty.test.ts`: a range with no completions returns an empty result rather than an error, and a single-day range is accepted (FR-009, FR-004)
- [x] T023 [P] [US1] Report sections in `packages/core/tests/report-completions.test.ts`: the `## Completions` and `## Undated` sections render per [report-format.md](./contracts/report-format.md) §3–§4, including the `(undated: "…")` form and the fixed explanatory sentence
- [x] T024 [P] [US1] Empty sections in `packages/core/tests/report-empty.test.ts`: every section prints with `(0)` and its own "found none of" sentence rather than being omitted (FR-010f, report-format §9)
- [x] T025 [P] [US1] Counts in `packages/core/tests/report-counts.test.ts`: every section's count equals the number of entries printed beneath it, including zero, and no count is stored on any shape (FR-010f, SC-015a)
- [x] T026 [P] [US1] No derived figures in `packages/core/tests/report-counts.test.ts`: no rate, average, streak, per-period split, or comparison appears anywhere in a rendered report (FR-010g, FR-054, SC-015a)
- [x] T026a [P] [US1] Nothing is generated in `packages/core/tests/report-nothing-generated.test.ts`: render a report over a fixture whose every user-supplied string is a distinctive marker, then assert that each non-whitespace run in the output is either one of those markers or a member of the fixed-label set exported from `report.ts` — so a summary, a paraphrase, a rewording, or an inserted adjective fails the test rather than reading plausibly (FR-053, SC-015) — *analysis finding C1: the feature's headline promise had no task*
- [x] T027 [P] [US1] Determinism in `packages/core/tests/retrospective-deterministic.test.ts`: the same range read twice over unchanged files renders to byte-identical strings (SC-003)

### Implementation for User Story 1

- [x] T028 [US1] Implement the local-date predicate and dated/undated/unreadable-date classification in `packages/core/src/retrospective/select.ts`, comparing `YYYY-MM-DD` as text and reusing the shape `daysBetween` already validates (research R3)
- [x] T029 [US1] Implement milestone and project completion extraction from `Project[]` in `packages/core/src/retrospective/select.ts`
- [x] T030 [US1] Implement the ordering comparator in `packages/core/src/retrospective/select.ts`: date descending, then project slug, then projects before milestones, then milestone index (research R8)
- [x] T031 [US1] Wire project reading through `Pick<ProjectService, "listDetailed">` in `packages/core/src/retrospective/retrospective-service.ts`, populating `completions` and `undated`
- [x] T032 [US1] Implement the `## Completions` and `## Undated` sections in `packages/core/src/retrospective/report.ts`, computing each count from the array being printed
- [x] T033 [US1] Implement empty-section wording for every section in `packages/core/src/retrospective/report.ts`
- [x] T033a [US1] Collect every fixed string the report can emit into one exported `REPORT_LABELS` constant in `packages/core/src/retrospective/report.ts`, and render only from it — so the set of words the view may invent is enumerable, and T026a has something to assert against (FR-053) — *analysis finding C1*

### Desktop client for User Story 1

- [x] T034 [P] [US1] Held reading test in `packages/desktop/tests/e2e/retrospective-held.spec.ts` (Playwright): with a reading on screen, a write from another window leaves every entry in place and raises a notice (FR-010a, FR-010b, SC-020)
- [x] T035 [P] [US1] Re-read test in `packages/desktop/tests/e2e/retrospective-held.spec.ts`: the notice's action produces a fresh reading, and ignoring the notice leaves the existing reading readable and exportable (FR-010c, FR-010d)
- [x] T035a [P] [US1] No pagination in `packages/desktop/tests/e2e/retrospective-held.spec.ts`: over a range of several hundred entries, the oldest entry is reachable by scrolling alone, with no page, slice, or "show more" control between the user and it (FR-010e) — *analysis finding C5*
- [x] T036 [US1] Create `packages/desktop/src/main/retrospective-window.ts`
- [x] T037 [US1] Create `packages/desktop/src/renderer/retrospective.html` and `packages/desktop/src/renderer/retrospective.ts`: two date controls, the report display, and the change notice — chrome only, displaying the string core rendered
- [x] T038 [US1] Add `registerRetrospectiveIpc` with the `retrospective:read` and `retrospective:render` channels in `packages/desktop/src/main/ipc.ts`
- [x] T039 [US1] Add the `retrospective` bridge to `packages/desktop/src/preload/preload.ts` per [retrospective-api.md](./contracts/retrospective-api.md) §4
- [x] T040 [US1] Wire the service and window in `packages/desktop/src/main/main.ts`, subscribing the existing `VaultChanged` emitter and pushing `retrospective:changed` to the window (research R9)
- [x] T041 [US1] Add the retrospective entry to the tray menu in `packages/desktop/src/main/tray.ts`

**Checkpoint**: A user can pick a range and see what they finished in it, hold it while the data moves under
them, and read undated work as undated. This is the MVP — everything else adds sections to a report that
already works.

---

## Phase 4: User Story 2 - See the Weekly Outcomes I Finished, Grouped by the Week I Committed to Them (Priority: P2)

**Goal**: Weekly outcomes completed in range, gathered under the week each was committed to.

**Independent Test**: With a `top-three.md` spanning several weeks including an ISO year boundary, containing
outcomes done inside the range, done outside it, and not done at all, read the range. Confirm exactly the
outcomes with a completion date in range appear, each under the week it was committed to rather than the week
it was finished in, and that not-done outcomes do not appear.

### Tests for User Story 2 ⚠️

- [x] T042 [P] [US2] Selection in `packages/core/tests/retrospective-outcomes.test.ts`: only outcomes with a recorded completion date in range appear, and outcomes never marked done appear nowhere (FR-011, FR-014)
- [x] T043 [P] [US2] Grouping in `packages/core/tests/retrospective-outcomes.test.ts`: an outcome committed to in `2026-W20` and finished in `2026-W23` appears under `2026-W20` carrying its W23 completion date (FR-011, FR-013)
- [x] T044 [P] [US2] Week ordering in `packages/core/tests/retrospective-outcomes.test.ts`: groups descending by identifier, outcomes in file order within a group
- [x] T045 [P] [US2] ISO year boundary in `packages/core/tests/retrospective-outcomes-boundary.test.ts`: a range spanning a 53-week year groups every outcome into the identifier the existing rule produces, with no week duplicated or lost (FR-012, SC-009)
- [x] T046 [P] [US2] Undated outcomes in `packages/core/tests/retrospective-outcomes.test.ts`: an outcome marked done with no date lands in `undatedOutcomes`, exactly as an undated milestone does (FR-016)
- [x] T047 [P] [US2] Absent file in `packages/core/tests/retrospective-missing-sources.test.ts`: with no `top-three.md`, the outcomes section reports none recorded and every other section still works (FR-015, FR-063)
- [x] T048 [P] [US2] Unreadable lines in `packages/core/tests/retrospective-unreadable.test.ts`: a line inside an in-range week section that is neither blank, a heading, nor a parseable outcome is reported in `unreadable` with its path, 1-based line number, and raw text, and is never dropped or rewritten (FR-020)
- [x] T048a [P] [US2] Unreadable section in `packages/core/tests/report-unreadable.test.ts`: `## Could not be read` renders per [report-format.md](./contracts/report-format.md) §8 when anything could not be read, is absent when nothing could, names each source by path and 1-based line, and prints the raw text with no speculation about the cause (FR-020) — *analysis finding I2: was T101 in Polish, which left US2 and US3 collecting unreadable sources that the report never showed*
- [x] T049 [P] [US2] Report section in `packages/core/tests/report-outcomes.test.ts`: `## Weekly outcomes` renders per [report-format.md](./contracts/report-format.md) §5, with the section count being the total outcomes rather than the number of weeks

### Implementation for User Story 2

- [x] T050 [US2] Implement outcome extraction and grouping by committed week in `packages/core/src/retrospective/select.ts`, reading through `Pick<TopThreeService, "history">`
- [x] T051 [US2] Implement the unreadable-line second pass in `packages/core/src/retrospective/select.ts` using the exported `weekLines` and `parseOutcome`, leaving `parseTopThree` untouched (research R6)
- [x] T052 [US2] Populate `outcomes`, `undatedOutcomes`, and `unreadable` in `packages/core/src/retrospective/retrospective-service.ts`
- [x] T053 [US2] Implement the `## Weekly outcomes` section and its undated subheading in `packages/core/src/retrospective/report.ts`
- [x] T053a [US2] Implement the `## Could not be read` section in `packages/core/src/retrospective/report.ts`, present only when non-empty — *analysis finding I2, moved from Polish*

**Checkpoint**: Milestones, projects, and the commitments the user made to themselves all appear in one range,
and anything that could not be read says so on the page rather than only in the returned value.

---

## Phase 5: User Story 3 - Read What I Wrote at the Time, and See Plainly Where I Wrote Nothing (Priority: P3)

**Goal**: For weeks with a log, the user's own note and what the log recorded as slipped; for weeks without
one, a single report naming every week that was never reviewed.

**Independent Test**: With logs present for some weeks in the range and absent for others, including one
in-progress log and one recording no note, read the range. Confirm notes and slipped records appear verbatim,
every unreviewed week is named in one report carrying both counts, a week whose log records no note is
distinguishable from a week with no log, the in-progress log is marked incomplete, and no log file is altered.

### Tests for User Story 3 ⚠️

- [x] T054 [P] [US3] `weekEnd` in `packages/core/tests/iso-week-end.test.ts`: the Sunday of a week identifier in local time, round-tripping with `weekStart` and correct across a 53-week year boundary
- [x] T055 [P] [US3] Week enumeration in `packages/core/tests/retrospective-weeks.test.ts`: every week overlapping a range is enumerated, including a week only partly covered at each end, walking with `nextWeek` rather than adding seven days (research R5)
- [x] T056 [P] [US3] Note verbatim in `packages/core/tests/retrospective-narrative.test.ts`: a week's note is carried and rendered with no prefix, no blockquote, and no rewrapping (FR-021)
- [x] T057 [P] [US3] Slipped and waiting in `packages/core/tests/retrospective-narrative.test.ts`: the log's own `slipped` and waiting records are shown as recorded, with nothing recomputed against current data (FR-022, FR-023)
- [x] T058 [P] [US3] In-progress log in `packages/core/tests/retrospective-narrative.test.ts`: a review still in progress is shown as it reads and marked incomplete, never completed or hidden (FR-026)
- [x] T059 [P] [US3] Summary attribution in `packages/core/tests/retrospective-narrative.test.ts`: an accepted generated summary keeps its attribution and stays plainly separate from the user's note (FR-027)
- [x] T060 [P] [US3] Note absent vs log absent in `packages/core/tests/retrospective-unreviewed.test.ts`: a week whose log records no note renders `Note: none recorded.`, distinguishable from a week named in the unreviewed report (FR-025, SC-007)
- [x] T061 [P] [US3] Unreviewed report in `packages/core/tests/retrospective-unreviewed.test.ts`: every week with no log is named by identifier alongside both counts, and none is omitted (FR-024a, FR-024b, SC-007a)
- [x] T062 [P] [US3] No threshold in `packages/core/tests/retrospective-unreviewed.test.ts`: a 209-week range and a 13-week range produce the same shape, with no range size at which the behaviour changes (FR-024c)
- [x] T063 [P] [US3] All weeks reviewed in `packages/core/tests/retrospective-unreviewed.test.ts`: the report still appears and states that none were missed (FR-024d)
- [x] T064 [P] [US3] Spans in `packages/core/tests/report-narrative.test.ts`: every individually shown week states its identifier and the calendar dates it spans (FR-028)
- [x] T065 [P] [US3] Missing log directory in `packages/core/tests/retrospective-missing-sources.test.ts`: every week in range is named unreviewed, nothing errors, and `log/` is not created (FR-029)
- [x] T066 [P] [US3] Not-a-week file in `packages/core/tests/retrospective-unreadable.test.ts`: a file in `log/` whose name is not a week identifier is reported in `unreadable` by path rather than parsed as a week or skipped (research R4)
- [x] T066a [P] [US3] Degraded sources in `packages/core/tests/retrospective-missing-sources.test.ts`: a garbled log file and a malformed completion date each leave every other section of the report intact and the reading usable, completing SC-017's five paths alongside T047 and T065 (FR-020, FR-063, SC-017) — *analysis finding C3: two of five paths were covered*
- [x] T067 [P] [US3] Independence in `packages/core/tests/retrospective-completions-vs-logs.test.ts`: a completion recorded in a week with no log still appears, because completions come from recorded dates and not from the log (FR-005, SC-006)

### Implementation for User Story 3

- [x] T068 [US3] Add `weekEnd(id)` to `packages/core/src/weekly/iso-week.ts`, beside `weekStart`, additively
- [x] T069 [US3] Implement week enumeration and spans in `packages/core/src/retrospective/weeks.ts`
- [x] T070 [US3] Implement log reading in `packages/core/src/retrospective/retrospective-service.ts` via `vault.list(LOG_DIR)`, `isWeekId`, `reviewPath`, and `parseReview` — not through `ReviewService` (research R4)
- [x] T071 [US3] Populate `narrative.weeks` and `narrative.unreviewed` in `packages/core/src/retrospective/retrospective-service.ts`
- [x] T072 [US3] Implement the `## Weekly notes` section and the unreviewed report in `packages/core/src/retrospective/report.ts` per [report-format.md](./contracts/report-format.md) §6

**Checkpoint**: The numbers now have the story around them, and the silence where there is none is visible.

---

## Phase 6: User Story 4 - Narrow to One Project (Priority: P4)

**Goal**: The same range, limited to one project, with the sections a project does not have omitted and the
reason stated.

**Independent Test**: With completions across several projects in range, narrow to one and confirm only its
completions appear; confirm the outcome and narrative sections are omitted with a stated reason rather than
shown empty; confirm clearing the filter reproduces the unnarrowed report byte-identically; confirm nothing
is written.

### Tests for User Story 4 ⚠️

- [x] T073 [P] [US4] Filtering in `packages/core/tests/retrospective-narrowing.test.ts`: only the named project's milestone completions and its own completion appear (FR-031)
- [x] T074 [P] [US4] Stated omission in `packages/core/tests/retrospective-narrowing.test.ts`: `outcomes`, `undatedOutcomes`, and `narrative` are `{ applies: false, reason }` with the reason supplied by core, and there is no array to render as empty (FR-032, FR-033)
- [x] T075 [P] [US4] Unknown slug in `packages/core/tests/retrospective-narrowing.test.ts`: narrowing to a project with no file yields an empty reading rather than a refusal (FR-034)
- [x] T076 [P] [US4] Round trip in `packages/core/tests/retrospective-narrowing.test.ts`: clearing the filter reproduces the unnarrowed report byte-identically (SC-010)
- [x] T077 [P] [US4] Nothing written in `packages/core/tests/retrospective-immutable.test.ts`: narrowing, clearing, and changing the range write no file, preference, or view state (FR-035)
- [x] T078 [P] [US4] Report reasons in `packages/core/tests/report-narrowing.test.ts`: omitted sections print their heading and reason with no count, per [report-format.md](./contracts/report-format.md) §5–§6

### Implementation for User Story 4

- [x] T079 [US4] Implement `query.project` filtering of completions in `packages/core/src/retrospective/select.ts`
- [x] T080 [US4] Populate `ProjectScoped` sections and `projectTitle` in `packages/core/src/retrospective/retrospective-service.ts`
- [x] T081 [US4] Render omitted sections with their stated reasons in `packages/core/src/retrospective/report.ts`
- [x] T082 [US4] Add the project picker to `packages/desktop/src/renderer/retrospective.ts`, reusing the existing `projects:list` channel — handler and preload bridge both already exist, so nothing is added to either. (*Analysis finding U1 claimed the bridge was missing; that was a false positive from a truncated grep, corrected during implementation. The picker uses the unfiltered list because a retrospective is mostly about finished projects, which `list-active` excludes.*)

**Checkpoint**: The whole range or one project, from the same reading.

---

## Phase 7: User Story 5 - Export It as Plain Text (Priority: P5)

**Goal**: What is on screen, as plain text the user can paste or save.

**Independent Test**: With a populated reading on screen, export it and compare against what is displayed:
same entries, same order, same undated and no-review statements, nothing added or dropped. Confirm the
exported text is legible with no application running, that nothing in the vault changed, and that the same
holds for a narrowed view.

### Tests for User Story 5 ⚠️

- [x] T083 [P] [US5] Export identity in `packages/core/tests/report-export-identity.test.ts`: the exported text is the same string the view was handed — asserted as an identity rather than by comparing two renderings, which is only expressible because `renderReport` is the only renderer (FR-045, SC-011)
- [x] T084 [P] [US5] Self-describing in `packages/core/tests/report-export-identity.test.ts`: the export states its range and any active narrowing (FR-046)
- [x] T085 [P] [US5] Empty export in `packages/core/tests/report-empty.test.ts`: an empty retrospective still exports, stating the range and that nothing is recorded (FR-048)
- [x] T086 [P] [US5] Save location in `packages/desktop/tests/e2e/retrospective-export.spec.ts`: the save dialog's default directory is never inside the vault root, and a cancelled dialog returns `saved: false` without error (FR-049, FR-050)
- [x] T087 [P] [US5] Stale export in `packages/desktop/tests/e2e/retrospective-export.spec.ts`: an export taken after the data changed but before the user re-read matches the displayed reading, with no entry from the newer data in it (SC-021)

### Implementation for User Story 5

- [x] T088 [US5] Add the `retrospective:copy` and `retrospective:save` channels in `packages/desktop/src/main/ipc.ts`, using `clipboard.writeText` and `dialog.showSaveDialog` defaulting to the user's documents directory (research R10)
- [x] T089 [US5] Add the copy and save actions to `packages/desktop/src/renderer/retrospective.ts` and `packages/desktop/src/renderer/retrospective.html`, operating on the string already displayed

**Checkpoint**: The report reaches the document the user is writing without being retyped.

---

## Phase 8: User Story 6 - See How a Project Moved (Priority: P6)

**Goal**: A project's recorded status history, under the project filter, read from its ledger and nowhere
else.

**Independent Test**: With a project whose ledger holds several status changes — some carrying a duration and
some not — and a second with no ledger, narrow to each in turn. Confirm every entry is shown with its date and
statuses, durations appear only where recorded and read as unknown otherwise, the ledger-less project reports
no recorded history, no history appears unnarrowed, and neither the project view nor the review's project walk
has changed.

### Tests for User Story 6 ⚠️

- [x] T090 [P] [US6] Entries verbatim in `packages/core/tests/retrospective-history.test.ts`: each ledger entry appears with its recorded date and the statuses it names, in file order (FR-037, FR-038)
- [x] T091 [P] [US6] Durations in `packages/core/tests/retrospective-history.test.ts`: `afterDays` is shown only where the entry records one, reads as unknown otherwise, and is never computed from surrounding dates (FR-039, SC-013)
- [x] T092 [P] [US6] No ledger in `packages/core/tests/retrospective-history.test.ts`: a project with an empty ledger reports that no history is recorded, distinguishable from one that has never changed status (FR-040, SC-014)
- [x] T093 [P] [US6] Disagreement in `packages/core/tests/retrospective-never-repairs.test.ts`: where `status:` and the last ledger entry disagree, both are printed and neither is repaired (FR-041)
- [x] T094 [P] [US6] Hand-written entries in `packages/core/tests/retrospective-history.test.ts`: an entry written by hand is read exactly as an application-written one (FR-042)
- [x] T095 [P] [US6] Scope in `packages/core/tests/retrospective-history.test.ts`: `history` is null in every unnarrowed reading, and no ledger is written, reordered, or compacted by viewing one (FR-036a, FR-043, SC-014a)
- [x] T096 [P] [US6] Surfaces unchanged in `packages/core/tests/retrospective-history.test.ts`: neither the project view's nor the review walk's shapes gain a history, asserted against the existing exported types (FR-036a)
- [x] T097 [P] [US6] Report section in `packages/core/tests/report-history.test.ts`: `## Project history` renders per [report-format.md](./contracts/report-format.md) §7, including the `— after 67d active` tail only where recorded

### Implementation for User Story 6

- [x] T098 [US6] Populate `ProjectHistory` from the narrowed project's `ledger`, carried through unmapped, in `packages/core/src/retrospective/retrospective-service.ts` (research R12)
- [x] T099 [US6] Implement the `## Project history` section in `packages/core/src/retrospective/report.ts`, including the status-disagreement line and the no-history wording

**Checkpoint**: All six stories are independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T100 Assert `packages/core/tests/decision-points.test.ts` is unmodified and still asserts five decision points (SC-018)
- [x] T100a [P] Negative assertions in `packages/core/tests/retrospective-never-does.test.ts`: across the full suite, zero messages, emails, reminders, or notifications are emitted to anyone; no per-person view, aggregation, or ranking of anyone's work exists; and the window neither opens a reading, schedules one, nor prompts for one unasked (FR-055, FR-056, FR-057) — *analysis finding C4; Feature 5 asserted its equivalent in SC-013 rather than treating it as vacuous*
> **~~T101~~ moved, not dropped.** It was "add the `## Could not be read` section", and it is now T048a and
> T053a in User Story 2 — US2 and US3 both produce unreadable sources, so leaving the section in Polish meant
> both checkpoints could pass with a required section missing from the report (*analysis finding I2*). The ID
> is retained and struck rather than renumbered, so every cross-reference in this file stays valid.
- [x] T102 [P] Build the scale fixture — 100 projects, ~2,000 completions, four years, ~209 weeks — as a generator in `packages/core/tests/retro-fakes.ts`, used by T019, T020, and T062
- [x] T103 Run every scenario in [quickstart.md](./quickstart.md) against a real vault, including the ten-second first-entry check (SC-001) and the offline pass (SC-016)
- [x] T104 [P] Run `npm run typecheck` and confirm the `Pick<>` boundary holds — a write attempt must fail typecheck, not a test
- [x] T105 [P] Confirm Features 1–5 suites pass unmodified with `npm test`
- [x] T105a [P] Confirm no shipped shape gained a field: diff the public surface of `packages/core/src/index.ts` and the exported types of Features 3–5 against `master`, expecting additions only and zero changes to `Project`, `Milestone`, `Outcome`, `Week`, `Review`, `LedgerEntry`, or `ProjectSummary` (FR-062) — *analysis finding C6: this rested on process alone*
- [x] T106 Tick Feature 6 in `ROADMAP.md`
- [x] T107 Record in [plan.md](./plan.md) Complexity Tracking any shipped file this feature touched that the table does not already name — the honest count of what was disturbed is the point of that table

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story
- **User Stories (Phases 3–8)**: All depend on Foundational
- **Polish (Phase 9)**: Depends on the stories being delivered

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on any other story. This is the MVP.
- **US2 (P2)**: After Foundational. Independent of US1 in core; shares the report skeleton, so land after US1
  in practice to avoid two people editing `report.ts`.
- **US3 (P3)**: After Foundational. Independent of US1 and US2.
- **US4 (P4)**: After **US2 and US3**, because narrowing has to omit their sections with a stated reason —
  there is nothing to omit until they exist. This is the one genuine cross-story dependency.
- **US5 (P5)**: After US1 (needs a rendered report and a window to export from). Independent of US2–US4,
  though T087 exercises the held reading US1 delivers.
- **US6 (P6)**: After **US4**, because the history appears only under the project filter.

### Within Each User Story

- Tests are written and observed to fail before implementation
- Pure selection logic (`select.ts`, `weeks.ts`) before the service wiring
- Service before the report section that renders its output
- Core before desktop

### Parallel Opportunities

- T002, T003, T004 in Setup
- Every test task within a phase is marked [P] — they are separate files with no shared state
- Implementation tasks within a story are mostly sequential: `select.ts`, `retrospective-service.ts`, and
  `report.ts` are each touched by several stories, so two stories in flight will collide there
- US1, US2, and US3 can be developed in parallel by different people if `report.ts` is sectioned first

---

## Parallel Example: User Story 1

```bash
# Every US1 test, in parallel — separate files, no shared state:
Task: "Boundary selection in packages/core/tests/retrospective-range.test.ts"
Task: "Ordering in packages/core/tests/retrospective-ordering.test.ts"
Task: "Undated split in packages/core/tests/retrospective-undated.test.ts"
Task: "Read counting in packages/core/tests/retrospective-reads.test.ts"
Task: "Determinism in packages/core/tests/retrospective-deterministic.test.ts"
Task: "Offline in packages/core/tests/retrospective-offline.test.ts"

# Then implementation, which is sequential — all three touch select.ts:
Task: "T028 date predicate and classification"
Task: "T029 completion extraction"   # after T028
Task: "T030 ordering comparator"     # after T029
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — blocks everything
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: a real vault, a real range, undated work shown as undated, the vault unchanged
5. This is genuinely shippable: a user who can produce this list can write their year-end review from it

### Incremental Delivery

1. Setup + Foundational → the verb exists and refuses correctly
2. US1 → completions over a range → **MVP**
3. US2 → the commitments the user made to themselves
4. US3 → the story around the numbers, and the honest silence
5. US4 → one project at a time (needs US2 and US3 to have something to omit)
6. US5 → it reaches the document being written
7. US6 → how a project moved

Each step adds a section to a report that already works. None changes what an earlier one produced, which is
what makes the checkpoints real.

---

## Notes

- [P] = different files, no dependency on an incomplete task
- Verify each test fails for the right reason before implementing — a read-only feature's tests pass
  vacuously more easily than most (see T017/T018)
- Commit after each task or logical group
- **If an existing test needs editing, stop.** On this branch that is a signal of scope creep, not of
  progress. Amend the "existing tests that change" section above with the reason first
- `npm run test:core` is the fast loop; `npm run typecheck` is what catches a stray write, because the
  `Pick<>` boundary is a compile-time guarantee rather than a runtime one

## Phase 10: Convergence

Appended by `/speckit-converge` on 2026-08-16, after `/speckit-implement` closed Phases 1–9 and the work was
committed. Four gaps between these artifacts and the code as it stands. No constitution violation: the four
blocking principles (I Test-First, III Local-First, IV Plain-Text, V Separable Policy) all still hold, and the
decision-point count is still five. Test-first ordering is preserved below — each fix is preceded by the test
that fails on it.

**F1 is the one that matters.** `readNarrative` adds a week to `present` the moment its file is *listed*, then
`continue`s if the read comes back null. The week is then in neither set: not shown individually, not named in
the unreviewed report, and not surfaced as unreadable. Probed against a five-week range whose `log/2026-W20.md`
lists but reads null — 4 of 5 weeks accounted for. This is the exact invariant
`retrospective-unreviewed.test.ts:82` asserts, and it holds in the suite only because every fixture that lists
a log also reads one. FR-020 names a log file explicitly among what must never be silently dropped, and unlike
the project-file race recorded in [plan.md](./plan.md) Complexity Tracking, nothing here argues against fixing
it: `unreadable` is already in scope, already pushed to eleven lines above.

- [X] T108 [P] Add a failing test in `packages/core/tests/retrospective-unreadable.test.ts` for a vault whose `list("log")` names a week its `read` returns null for, asserting the week is surfaced in `unreadable` and that `weeksInRange === weeks.length + unreviewed.weeks.length` still holds per FR-020, FR-028, SC-007 (partial)
- [X] T109 Make `readNarrative` in `packages/core/src/retrospective/retrospective-service.ts` account for a listed-but-unreadable log — push an `UnreadableSource` and leave the week accounted for, rather than `continue` per FR-020, FR-028, SC-007 (partial)
- [X] T110 [P] Add a failing test in `packages/core/tests/retrospective-narrowing.test.ts` for narrowing to a slug no project matches, asserting the report still states which project it was narrowed to and still renders a history section per FR-046, SC-014a (partial)
- [X] T111 Make a narrowing whose project is absent self-describing in `packages/core/src/retrospective/retrospective-service.ts` — the report currently omits outcomes and notes for project-scoping reasons while printing no `Project:` line and no history, so it reads as unnarrowed while behaving as narrowed per FR-046, SC-014a (partial)
- [X] T112 Verify SC-001 for real: run `npm run dev` against a 100-project vault and time opening the view to the first entry, or add an automated budget check — T103 is ticked but was satisfied by the E2E suite, which exercises the paths without measuring the ten seconds per SC-001 (missing)
- [X] T113 [P] Export `historyOf` from `packages/core/src/retrospective/retrospective-service.ts` and `packages/core/src/index.ts` — it is module-private, so the later feature FR-036b anticipates would have to reimplement it rather than reuse it per FR-036b (partial)

---

**Not raised, recorded so the next reader does not re-derive it:** `weeksOverlapping` stops at `MAX_WEEKS`
(200 × 53), so a range longer than two centuries would silently under-count weeks. Left alone — the guard is
deliberate and documented, and the alternative to a ceiling is an unkillable loop rather than a wrong answer.
