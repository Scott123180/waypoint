---

description: "Task list for 004-top-three-wip-limit"
---

# Tasks: Weekly Top Three and WIP Limit

**Input**: Design documents from `/specs/004-top-three-wip-limit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Required, not optional.** Constitution Principle I is non-negotiable — tests are written
first and observed to fail for the right reason before implementation. Every implementation task below is
preceded by its test task.

**Organization**: Grouped by user story so each ships as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: US1–US4, mapping to the user stories in spec.md
- Every task names its exact file path

## Path Conventions

npm workspaces monorepo: `packages/core/src`, `packages/core/tests`, `packages/desktop/src`. Core holds all
domain logic and imports nothing from Electron; the desktop client renders and routes input only.

---

## Phase 1: Setup

**Purpose**: Directories and test-double capacity. No behavior.

- [X] T001 [P] Create module directories `packages/core/src/identity/`, `packages/core/src/policy/`, and `packages/core/src/weekly/`
- [X] T002 Add a `readLog: string[]` field to `FakeVaultStore` in `packages/core/tests/sort-fakes.ts`, pushed on every `read()`. Purely additive — no existing behavior changes, so Feature 3's suites stay untouched (research R6)
- [X] T003 [P] Add `packages/desktop/src/renderer/top-three.html` to the `build:renderer` copy step in `package.json` — the script copies each renderer HTML file by name, so a new window is invisible to the build until it is listed

**Checkpoint**: `npm test` still green, nothing behaviorally changed.

---

## Phase 2: Foundational — The Policy Seam

**Purpose**: The seam every user story consults. Core declares where rules are asked; it never learns what
they are.

**⚠️ BLOCKING**: No user story can begin until this phase is complete.

- [X] T004 Declare the seam in `packages/core/src/ports/index.ts`: `PolicyModule`, `DecisionPoint` (exactly the three names), `DecisionVerdict`, `Decision`, and the three context types per [contracts/policy-seam.md](./contracts/policy-seam.md). Types only — no implementation
- [X] T005 [P] Write a failing test in `packages/core/tests/decision-points.test.ts` asserting `DecisionPoint` has exactly three members and that they are the three named ones. Cheap, and it is what stops a fourth point being declared speculatively later (FR-063a)
- [X] T006 [P] Write failing tests for policy config parsing in `packages/core/tests/policy-config.test.ts`: absent file → all defaults (3/4/3); each value parsed; **per-value** fallback so one malformed key cannot reset another; zero honored, not corrected; negative and non-integer rejected to default (FR-060)
- [X] T007 Implement `packages/core/src/policy/policy-config.ts` to pass T006
- [X] T008 [P] Write failing tests in `packages/core/tests/default-policy.test.ts` asserting the default module returns a well-formed `Decision` for each of the three points, and that `reason` is non-empty whenever the verdict is not `allow`
- [X] T009 Implement `packages/core/src/policy/default-policy.ts` with `createDefaultPolicy(vault)` — skeleton returning `allow` at every point. Individual rules are added by the story that owns them (T026 weekly cap, T062 WIP limit, T070/T071 the two migrated rules)
- [X] T010 [P] Write the import-direction test in `packages/core/tests/policy-boundary.test.ts`: read the source files and assert `identity/` never imports `policy/`; `projects/` and `weekly/` import `policy/` only via the `createDefaultPolicy` factory; `policy/` imports no service. This is what makes the module boundary real without a third workspace package (research R2)
- [X] T011 Export the new public surface from `packages/core/src/index.ts`: the seam types and `createDefaultPolicy`. Do **not** export an extension-registration API — FR-064 forbids a loader, discovery, or public extension point

**Checkpoint**: The seam exists and is consulted by nothing. `npm test` green, including all of Feature 3.

---

## Phase 3: User Story 1 — Weekly Top Three (Priority: P1) 🎯 MVP

**Goal**: Record one to three outcomes a week, change them, complete them, and keep every past week intact.

**Independent test**: With no identity configured and no projects on disk, set a week, change an entry,
complete another, advance the clock a week, set a different top three — both weeks readable, the earlier one
untouched, everything legible in a text editor.

### Tests (write first, observe failing)

- [X] T012 [P] [US1] Write failing tests in `packages/core/tests/iso-week.test.ts`: a table of dates → `YYYY-Www` spanning at least three year boundaries, a 53-week year, 1 Jan belonging to the previous ISO year, 31 Dec belonging to the next, and Sunday→Monday turnover. Assert identifiers sort chronologically as text over 60 consecutive weeks (SC-002a, SC-002b). Relies on the `TZ=America/New_York` pin already in the `test` script
- [X] T013 [P] [US1] Write failing round-trip tests in `packages/core/tests/top-three-document.test.ts`: parse → render is byte-identical for a hand-shaped file; unknown `##` sections, non-task lines under a week, and a hand-edited four-outcome week all survive untouched (FR-015). Include a fixture-level assertion that a stored week is readable and hand-editable as plain text with no application running (FR-014, SC-004)
- [X] T014 [P] [US1] Write failing tests in `packages/core/tests/top-three-service.read.test.ts`: absent file → empty current week, no error (FR-006); `history()` newest first (FR-012); `Week.current` derived from the clock, never stored
- [X] T015 [P] [US1] Write failing tests in `packages/core/tests/top-three-service.write.test.ts` for add / edit / remove / complete / reopen, including empty-text refusal (FR-005) and completion date set and cleared (FR-009, FR-010)
- [X] T016 [P] [US1] Write failing verify-before-write tests in `packages/core/tests/top-three-verify.test.ts`: editing an entry changed on disk refuses `entry-changed` and leaves the file **byte-for-byte** unchanged; an unrelated hand-edit elsewhere in the same week does **not** cancel the write (FR-015a, FR-015b, FR-015c, SC-004a)
- [X] T017 [P] [US1] Write failing preservation tests in `packages/core/tests/top-three-preservation.test.ts`: inserting a new week leaves every prior week's bytes identical (FR-011, SC-001); a write targeting a past week refuses `past-week` (FR-013)
- [X] T018 [P] [US1] Write a failing test in `packages/core/tests/top-three-offline.test.ts` mirroring `project-offline.test.ts` — every verb succeeds with no network available (FR-065)
- [X] T019 [P] [US1] Write the failing prohibition test in `packages/core/tests/top-three-no-suggestion.test.ts`, mirroring Feature 3's `project-no-suggestion.test.ts`: no outcome is ever generated, suggested, pre-filled, or ranked, and every stored outcome traces to an explicit user entry (FR-016, SC-017). A prohibition with no test is a comment

### Implementation

- [X] T020 [US1] Implement `packages/core/src/weekly/iso-week.ts` — `isoWeek(date): WeekId`, pure and synchronous, no dependency (research R1)
- [X] T021 [US1] Add `WeekId`, `Outcome`, `Week`, `OutcomeRef`, `TopThreeRefusal`, `TopThreeOutcomeResult` to `packages/core/src/weekly/types.ts` per [data-model.md](./data-model.md). `outcome-cap` belongs to `TopThreeRefusal`, **not** to the projects `RefusalReason` union
- [X] T022 [US1] Implement `packages/core/src/weekly/top-three-document.ts` — parse and surgical section writes, reusing `parseMilestone`/`renderMilestone` from `packages/core/src/projects/milestone.ts` for the task-line shape. Parsing never fails; only the section being changed is rewritten (research R5, R8)
- [X] T023 [US1] Implement read verbs `current()` and `history()` in `packages/core/src/weekly/top-three-service.ts`
- [X] T024 [US1] Implement `editOutcome`, `removeOutcome`, `completeOutcome`, `reopenOutcome` in `packages/core/src/weekly/top-three-service.ts` with entry-level verify-before-write
- [X] T025 [P] [US1] Write a failing test in `packages/core/tests/top-three-cap.test.ts`: a week at the configured maximum refuses `outcome-cap`; the cap comes from `policy.md` and defaults to 3; existing outcomes unchanged on refusal; verified at the default and at one other configured value (FR-004, SC-003). Assert the concept stays named "top three" at every configured cap — the cap is a rule, not a rename (FR-063b)
- [X] T026 [US1] Implement `addOutcome` in `packages/core/src/weekly/top-three-service.ts`, consulting the `week.outcome.record` decision point, and register the weekly-outcome-cap rule in `packages/core/src/policy/default-policy.ts`
- [X] T027 [US1] Export `TopThreeService`, `isoWeek`, and the weekly types from `packages/core/src/index.ts`

### Client

- [X] T028 [P] [US1] Add the top-three IPC channels to `packages/desktop/src/main/ipc.ts` per [contracts/top-three-api.md](./contracts/top-three-api.md)
- [X] T029 [P] [US1] Expose the channels in `packages/desktop/src/preload/preload.ts` following the existing `wp.projects` shape
- [X] T030 [US1] Create `packages/desktop/src/main/top-three-window.ts` modelled on `projects-window.ts`, including a `vaultChanged()` forwarding method
- [X] T031 [US1] Wire the window and `TopThreeService` in `packages/desktop/src/main/main.ts`, subscribing it to the **existing** `VaultChanged` emitter — no new signal (research R9)
- [X] T032 [P] [US1] Create `packages/desktop/src/renderer/top-three.html`
- [X] T033 [US1] Implement `packages/desktop/src/renderer/top-three.ts` — renders the current week editable and past weeks as a read-only record, re-reads on `vault:changed`, and displays refusal messages verbatim. It must not compute the current week, decide editability, or phrase a refusal (Principle II)

**Checkpoint**: US1 ships alone. A user with an empty vault gets a working top three.

---

## Phase 4: User Story 2 — Know Which Projects Are Mine (Priority: P2)

**Goal**: Every project reports whether the user is the DRI, someone else is, nobody is, or it is ambiguous
— and projects with no DRI are surfaced without being called incomplete.

**Independent test**: With no policy limit in play, configure a canonical name and two aliases, list
projects, and confirm each reports exactly one of the four results against a hand-checked mapping.

### Tests (write first, observe failing)

- [X] T034 [P] [US2] Write failing tests in `packages/core/tests/identity-config.test.ts`: parse `identity.md`; absent file → `{ canonical: null, aliases: [] }`; blank `me` → not configured; absent `## Aliases` valid; duplicate and redundant aliases harmless (FR-017, FR-031)
- [X] T035 [P] [US2] Write failing tests in `packages/core/tests/identity-normalize.test.ts` for the four formatting rules — case, surrounding whitespace, collapsed internal runs, one trailing period — returning a word list, with blank and `.`-only treated as absent (FR-022, FR-023, FR-024, FR-025)
- [X] T036 [P] [US2] Write the failing **prohibition** table in `packages/core/tests/identity-resolve.test.ts`: every shorter/longer pair resolves `theirs` — no prefix, initial expansion, first-name, substring, or fuzzy match ever succeeds (FR-026, FR-027, SC-006). Include `Scott`/`Scott Rodgers` both directions, `S. Rodgers`, and `scottrodgers`
- [X] T037 [P] [US2] Extend `packages/core/tests/identity-resolve.test.ts` with the four-way resolution table: formatting variants → `mine`; unknown name → `theirs`; absent DRI → `unassigned`; no canonical configured → `theirs`, never `unassigned` (FR-021, SC-005, SC-007)
- [X] T038 [P] [US2] Write failing ambiguity tests in `packages/core/tests/identity-ambiguity.test.ts`: alias `Scott` + corpus `Scott R.` → `ambiguous` with `collidesWith`; corpus name **shorter** than the match → still `mine`; `Scottie` → `mine` (word-level, not character-level); multiple collisions all reported; a name matching an identity value is not evidence against itself (FR-028, FR-028c, FR-029, SC-008)
- [X] T039 [P] [US2] Write failing corpus tests in `packages/core/tests/identity-corpus.test.ts`: built from DRI **and** milestone verifier values; a colliding name appearing only as a verifier still triggers ambiguity; a name only in `waiting.md` does **not**, and no file other than the project files and `identity.md` is read (FR-028a, FR-028b, SC-008a)
- [X] T040 [P] [US2] Write the failing read-count test in `packages/core/tests/identity-read-count.test.ts`: a 100-project list issues exactly 100 project reads via `FakeVaultStore.readLog`. **Counting, not timing** — a timing test passes on fast hardware even when the implementation is quadratic (FR-020c, SC-016c)
- [X] T041 [P] [US2] Write the failing regression test in `packages/core/tests/needs-dri.test.ts`: a project with an outcome, milestones, and a next action but no DRI has `gaps: []` and `needsDri: true`. This is the Feature 3 FR-009 guard (FR-032, FR-033, FR-034, FR-036, SC-009)
- [X] T042 [P] [US2] Write a failing test in `packages/core/tests/identity-absent.test.ts`: with no `identity.md`, no project resolves `mine`, nothing errors, and the not-configured state is distinguishable from "nothing is mine" (FR-031)
- [X] T043 [P] [US2] Extend `packages/core/tests/project-list-perf.test.ts` — a **new** case, leaving existing cases untouched — asserting a 100-project list with resolution and ambiguity stays inside the existing 100 ms budget (SC-016a), plus single-project open in a 100-project vault (SC-016b)
- [X] T044 [P] [US2] Write the failing prohibition test in `packages/core/tests/identity-no-inference.test.ts`: after running every verb that touches a project's DRI, `identity.md` is unchanged — no alias is added, inferred, suggested, learned, or auto-populated, and no alias editor surface exists (FR-030, SC-017)
- [X] T045 [P] [US2] Write the failing exclusion test in `packages/core/tests/area-no-dri.test.ts`, mirroring `area-never-flagged.test.ts`: `AreaSummary` carries neither a resolution nor a needs-a-DRI signal, and no area contributes a name to the corpus (FR-037)

### Implementation

- [X] T046 [P] [US2] Implement `packages/core/src/identity/normalize.ts`
- [X] T047 [P] [US2] Implement `packages/core/src/identity/identity-config.ts`
- [X] T048 [US2] Implement `packages/core/src/identity/corpus.ts` — `buildCorpus(projects)` over already-parsed projects, taking DRIs and verifiers
- [X] T049 [US2] Implement `packages/core/src/identity/resolve.ts` — `resolveDri(dri, identity, corpus)`, pure and synchronous. The corpus is an **argument**, never fetched, which is what forces the single-pass read path (identity-api.md)
- [X] T050 [US2] Add `DriResolution`, `ResolvedDri`, and the `ProjectSummary.dri` / `ProjectSummary.needsDri` fields to `packages/core/src/projects/types.ts`. Leave `StructureGap` **unchanged** — adding `"dri"` would silently reverse FR-009
- [X] T051 [US2] Rework `ProjectService.list()` in `packages/core/src/projects/project-service.ts` to parse every project once, build the corpus from that array, and derive each summary's resolution from it. Do **not** cache, memoize, or persist (FR-020b)
- [X] T052 [US2] Give `ProjectService.get()` the same corpus-backed resolution in `packages/core/src/projects/project-service.ts`, so a single-project view and the list cannot disagree (FR-020a)
- [X] T053 [US2] Export the identity surface from `packages/core/src/index.ts` — reachable **without** importing anything from `policy/`, so Feature 5 and Feature 6 can use it (FR-020, FR-053)
- [X] T054 [P] [US2] Render resolution, the needs-a-DRI note, and the ambiguity reason in `packages/desktop/src/renderer/projects.ts` and `projects.html`, informational only — nothing blocks, gates, or delays on any of them (FR-035, SC-015)

**Checkpoint**: Projects report ownership. No limit exists yet.

---

## Phase 5: User Story 3 — The WIP Limit (Priority: P3)

**Goal**: Refuse a project going active beyond the limit, explain why, and name what to finish or park.

**Independent test**: With identity set and the limit at three, take three of the user's projects active,
attempt a fourth, confirm the refusal and its named remediation. Then confirm ten other-owned and five
unassigned projects go active with zero refusals.

### Tests (write first, observe failing)

- [X] T055 [P] [US3] Write failing tests in `packages/core/tests/wip-limit.test.ts`: at the limit, a fourth of the user's projects is refused `wip-limit`; the message states the rule, count, and limit; `subjects` names the active projects to finish or park, all verifiably active and `mine` (FR-038, FR-039, FR-044, FR-045, FR-046, SC-010, SC-012). Include the concurrency case from the spec's Edge Cases: when another window parks one of the counted projects between the count and the decision, the refusal must not name a project that is no longer active (FR-047)
- [X] T056 [P] [US3] Write failing exclusion tests in `packages/core/tests/wip-limit-scope.test.ts`: 10 `theirs` + 5 `unassigned` + any `ambiguous` projects all go active at the limit with zero refusals and zero warnings (FR-040, FR-041, FR-042, SC-011)
- [X] T057 [P] [US3] Write failing tests in `packages/core/tests/wip-limit-transitions.test.ts`: `parked`/`waiting`/`done` never counted (FR-043); active→parked/waiting/done never blocked (FR-048); re-setting an already-active project to active does not count itself
- [X] T058 [P] [US3] Write a failing test in `packages/core/tests/wip-limit-unconfigured.test.ts`: with no `identity.md` the limit never fires (FR-049); with `wip limit: 0` every activation of the user's projects is refused and not corrected
- [X] T059 [P] [US3] Write a failing test in `packages/core/tests/wip-over-limit.test.ts`: a vault hand-edited past the limit surfaces the over-limit state, blocks nothing, and changes nothing (FR-050, FR-051)
- [X] T060 [P] [US3] Write a failing test in `packages/core/tests/wip-lazy-context.test.ts` asserting the milestone-cap decision never invokes `activeProjectsDrivenByUser` — counted via the fake — so a rule that does not need the vault does not pay for it (research R4)

### Implementation

- [X] T061 [US3] Build the `StatusChangeContext` in `packages/core/src/projects/project-service.ts` with `activeProjectsDrivenByUser` as a **lazy accessor** excluding the project being changed, and consult `project.status.change` in `setStatus`, `complete`, and `reopen`
- [X] T062 [US3] Implement the WIP rule in `packages/core/src/policy/default-policy.ts` — fires only when `to === "active"`, `from !== "active"`, `dri.resolution === "mine"`, and the count is at or above the limit
- [X] T063 [US3] Add the `wip-limit` refusal reason **and a new optional `subjects` field** to `ProjectOutcome` in `packages/core/src/projects/types.ts`, then map a `block` decision onto `{ ok: false, reason: "wip-limit", message, subjects }`. Do **not** reuse `open` — it means "the still-open milestones", and a client already renders it as a confirmation list, so overloading it would show a WIP block as an offer to complete the project ([contracts/policy-seam.md](./contracts/policy-seam.md))
- [X] T064 [US3] Expose the over-limit state from core for the project list header in `packages/core/src/projects/project-service.ts` — count from core, comparison from policy, finished answer to the client (research R11)
- [X] T065 [P] [US3] Render the refusal and the over-limit banner in `packages/desktop/src/renderer/projects.ts`, displaying `message` and `subjects` verbatim without recomputing either

**Checkpoint**: The limit works end to end. Feature 3's rules are still inside core.

---

## Phase 6: User Story 4 — Rules Live With My Data (Priority: P4)

**Goal**: Relocate Feature 3's two shipped rules behind decision points with zero user-visible change, and
make the limits editable in the vault.

**⚠️ This is the only phase that touches shipped behavior.**

**A note on TDD here**: T066–T068 are *characterization* tests. They are written against current behavior
and **pass immediately** — there is no Red, because a refactor adds no behavior. The Red step is supplied by
T069 instead: deliberately break the relocated rule and confirm the tests fail. A characterization test
that cannot fail is decoration.

- [X] T066 [P] [US4] Write boundary tests in `packages/core/tests/milestone-cap-boundary.test.ts` against **current** behavior: third and fourth milestone accepted **silently**, fifth refused `milestone-cap`. The silent rows matter as much as the refusing ones — a relocated rule that fires *more* is drift a cap test alone would miss (FR-061, FR-062a, SC-014a)
- [X] T067 [P] [US4] Write boundary tests in `packages/core/tests/open-milestones-boundary.test.ts` against current behavior: marking done with **zero** open milestones asks nothing; with one and with several it asks, naming them (FR-062, FR-062a, SC-014a)
- [X] T068 [P] [US4] Write a desktop-level test in `packages/desktop/tests/open-milestones-dialog.test.ts` asserting the client still receives `reason === "open-milestones"` and a populated `open` array. `renderer/projects.ts:630` branches on that literal string — rename it and the confirmation silently stops appearing, which no core test would catch ([contracts/policy-seam.md](./contracts/policy-seam.md))
- [X] T069 [US4] Verify T066–T068 can fail: temporarily change `MILESTONE_CAP` and the open-milestone condition in `packages/core/src/projects/project-service.ts`, confirm `packages/core/tests/milestone-cap-boundary.test.ts`, `packages/core/tests/open-milestones-boundary.test.ts`, and `packages/desktop/tests/open-milestones-dialog.test.ts` each fail, then revert. Do not proceed until every characterization test has been observed failing
- [X] T070 [US4] Move the milestone cap out of `addMilestone` in `packages/core/src/projects/project-service.ts` and behind the `project.milestone.add` decision point; implement the rule in `packages/core/src/policy/default-policy.ts` reading `milestone cap` (default 4). Keep `MILESTONE_CAP` exported from `packages/core/src/index.ts` as a deprecated alias for the default, so no importer breaks
- [X] T071 [US4] Move the open-milestone confirmation out of `complete()` in `packages/core/src/projects/project-service.ts` and behind the `project.status.change` decision point as a `warn`; translate the decision back into `{ ok: false, reason: "open-milestones", message, open: subjects }` **byte-identically** for clients
- [X] T072 [US4] Run Feature 3's suites and confirm `git status --porcelain packages/core/tests/` reports no modified Feature 3 test file — **with exactly one permitted exception, recorded 2026-08-14**: `project-scope-boundaries.test.ts`, whose "no WIP limit or top-three" block is a tripwire Feature 3 planted *for* Feature 4's arrival ("a later feature arriving early"). Its boundary moved forward; every assertion in that file touching the milestone cap or the open-milestone confirmation is untouched, which is what FR-062b actually protects. Confirm no other file changed — specifically `packages/core/tests/project-service.milestones-add.test.ts`, `project-service.milestones-overflow.test.ts`, `project-complete.test.ts`, `project-scope-boundaries.test.ts`, and `flag-never-blocks.test.ts`, the five that exercise the migrated rules. If a test needed editing, the migration is wrong and the test is right — revert and fix the implementation (FR-062b, SC-014)
- [X] T073 [P] [US4] Write a test in `packages/core/tests/policy-config-live.test.ts`: editing `policy.md` alone changes enforced behavior with no application change, verified at two different WIP values and one changed weekly cap (FR-057, FR-058, SC-013)
- [X] T074 [P] [US4] Write a test in `packages/core/tests/policy-config-malformed.test.ts`: a malformed value falls back for that value alone, the problem is surfaced, and no operation is blocked — including rules whose own config is fine (FR-060, SC-015)
- [X] T075 [P] [US4] Write a test in `packages/core/tests/policy-no-files-created.test.ts`: running every verb against a vault with no `policy.md`, `identity.md`, or `top-three.md` creates none of them (FR-018, FR-019, FR-059)

**Checkpoint**: All three rules live in the default module. Feature 3's suites pass unmodified.

---

## Phase 7: Polish & Cross-Cutting

- [X] T076 [P] Write an end-to-end Playwright scenario in `packages/desktop/tests/e2e/top-three.spec.ts` covering the quickstart's manual walkthrough: set a week, hit the cap, complete an outcome, see a past week read-only
- [X] T077 [P] Write a live-update test in `packages/desktop/tests/e2e/top-three-live.spec.ts` asserting an open top-three view reflects a hand-edit to `top-three.md` without a reopen, via the existing `vault:changed` signal (research R9)
- [X] T078 [P] Add an offline guard in `packages/core/tests/wip-offline.test.ts` covering identity and policy paths (FR-065, SC-016)
- [X] T078a **Found during T076, not by design**: the end-to-end suite exposed silent data loss — three outcomes typed quickly produced two. Two overlapping read-modify-write races, one per layer. Core now serializes its writes (`TopThreeService.serialize`, regression test in `packages/core/tests/top-three-concurrent-writes.test.ts`), and the renderer clears the add box synchronously instead of after the write returns, which was wiping text the user had already started typing. Both were real user-facing defects, not test artifacts
- [X] T079 Run the full gate from the repo root — `npm run typecheck && npm test` — then re-confirm the four gates in `specs/004-top-three-wip-limit/quickstart.md`: Feature 3 suites unedited (`git status --porcelain packages/core/tests/`), `packages/core/tests/identity-read-count.test.ts` at exactly 100 reads, the prohibition half of `packages/core/tests/identity-resolve.test.ts`, and `packages/core/tests/top-three-preservation.test.ts`
- [X] T080 [P] Update `ROADMAP.md`: tick Feature 4, record the resolved open questions (identity file name and format, the separate needs-a-DRI signal), and note that the licence question remains open and untouched by this feature
- [X] T081 [P] Append a dated Constitution Amendment Note to `specs/003-project-structure/plan.md` recording that its two rules moved behind decision points in Feature 4. **Append only** — do not rewrite the original Constitution Check, which stands as the historical record

---

## Dependencies

```
Phase 1 Setup
    ↓
Phase 2 Foundational — the seam         ⚠️ blocks everything
    ↓
    ├─────────────┬──────────────┬─────────────────┐
    ↓             ↓              ↓                 ↓
Phase 3 US1   Phase 4 US2    (US3 needs US2)   Phase 6 US4
top three     identity            ↓            migration
    │             └──────▶ Phase 5 US3              │
    │                      WIP limit                │
    └─────────────┬──────────────┴─────────────────┘
                  ↓
            Phase 7 Polish
```

**Story dependencies**:

- **US1** depends only on the seam. Fully independent of identity and projects — this is why it is the MVP.
- **US2** depends only on the seam. Independent of US1.
- **US3** depends on **US2** — the limit cannot count what it cannot resolve. This is the one real
  inter-story dependency.
- **US4** depends on the seam only. It can run any time after Phase 2, including in parallel with US1–US3,
  because it touches `project-service.ts` regions the others do not. If two people work at once, US3 and
  US4 both edit `project-service.ts` and should be sequenced — US3 first, since T061 establishes the
  status-change decision point that T071 reuses.

---

## Parallel Opportunities

**Phase 2**: T005, T006, T008, and T010 are independent test files — write them at once, then implement
T007 and T009.

**Phase 3 (US1)**: T012–T019 are eight independent test files and can be written in parallel. T028, T029,
and T032 are independent client files.

**Phase 4 (US2)**: T034–T045 are twelve independent test files — the largest parallel block in the feature.
T046 and T047 are independent implementation files.

**Phase 5 (US3)**: T055–T060 are six independent test files.

**Phase 6 (US4)**: T066, T067, and T068 in parallel, then T069 gates on all three. T073–T075 in parallel.

**Phase 7**: T076, T077, T078, T080, and T081 are all independent; only T079 must run last.

**Cross-story**: after Phase 2, US1 and US2 can proceed on separate tracks with no shared files.

---

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1)**. A working weekly top three, storing history in plain text,
with the policy seam underneath it. Delivers value against an empty vault and requires no configuration.

**Increment 2**: Phase 4 (US2) — the project list starts saying whose work is whose, and which projects
need an owner. Still no limit, so nothing can refuse anything.

**Increment 3**: Phase 5 (US3) — the limit turns on. This is the first point at which the feature can tell
the user "no", so it is deliberately last among the user-visible slices.

**Increment 4**: Phase 6 (US4) — no user-visible change, which is exactly why it is the safe thing to defer
if time runs short. Note the constitution assigns it to this feature, so deferring it past release means
shipping a known Principle V violation and should be a recorded decision rather than a silent slip.

**Suggested order for one person**: Phases 1 → 2 → 3 → 4 → 5 → 6 → 7, straight down. The dependency graph
only rewards parallelism with more than one implementer.

---

## Task Summary

| Phase | Story | Tasks | Count |
|---|---|---|---|
| 1 Setup | — | T001–T003 | 3 |
| 2 Foundational | — | T004–T011 | 8 |
| 3 Weekly top three | US1 | T012–T033 | 22 |
| 4 Identity | US2 | T034–T054 | 21 |
| 5 WIP limit | US3 | T055–T065 | 11 |
| 6 Migration | US4 | T066–T075 | 10 |
| 7 Polish | — | T076–T081 | 6 |
| **Total** | | | **81** |

Test tasks: 42 of 81. Every implementation task is preceded by the test that must fail first — except the
three characterization tests in Phase 6, where T069 supplies the Red deliberately.

---

## Phase 8: Convergence

Appended by `/speckit-converge` on 2026-08-14, after Phase 7 completed. Each item traces to
the requirement or plan decision it closes.

- [X] T082 Render the `wip-limit` refusal's `subjects` in `packages/desktop/src/renderer/projects.ts` per FR-046 (partial). Core populates the list, but the status-change handler shows only `outcome.message`, which ends "Finish or park one of these first" with nothing listed — the user is told "these" and shown no names. Follow the pattern the open-milestone confirmation already uses for `outcome.open` at `projects.ts:630`, and cover it with a desktop-level test, since no core test can see what reaches the screen (US3/AC1, SC-012)
- [X] T083 [P] Add the two missing performance cases to `packages/core/tests/project-list-perf.test.ts` per SC-016a and SC-016b (missing). T043 was marked complete but only the read-count test in `identity-read-count.test.ts` was written. Neither existing case configures `identity.md`, so `resolveDri` returns at the not-configured check and the collision comparison — the O(n)-per-project filter ambiguity requires — is never timed. Add: a 100-project list with identity configured and at least one ambiguous DRI, inside the existing 100 ms budget; and `getResolved` on one project in a 100-project vault, likewise inside 100 ms
- [X] T084 [P] Remove the unreachable `projects:identity-configured` handler at `packages/desktop/src/main/ipc.ts:188`, or expose it through the preload if a client needs it (unrequested). No preload method or renderer call reaches it — the projects view takes `identityConfigured` from `projects:load`. Dead IPC surface contradicts the thin-client contract that every channel is one a client actually uses
