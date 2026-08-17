# Implementation Plan: Retrospective View

**Branch**: `006-retrospective-view` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-retrospective-view/spec.md`

## Summary

A read-only core module that answers one question — "what did I finish between these two dates?" — from files
Features 3, 4, and 5 already write, and renders the answer as one string that is simultaneously the view and
the export.

It reads three sources and writes none: milestone and project completion dates from the project files, weekly
outcome completion dates from `top-three.md`, and the weeks' notes and slipped records from `log/YYYY-Www.md`.
Completions come from the recorded dates; the narrative comes from the logs; the two are never reconciled,
which is the user's own distinction and the load-bearing one.

This is the first feature since Feature 3 that adds no decision point, and the first in the repo that must
never write. Both are made structural rather than promised:

- **`RetrospectiveServiceDeps` narrows every dependency with `Pick<>`.** `vault` is
  `Pick<VaultStore, "list" | "read">`, so `write` and `appendLine` do not typecheck; `projects` is
  `Pick<ProjectService, "listDetailed">`, so no write verb is reachable. SC-004's byte-for-byte assertion
  becomes a regression net over something the compiler already holds (research R1).
- **There is no `policy` dependency at all.** Not accepted-and-unused — absent. `DECISION_POINTS` stays at
  five and SC-018's assertion is redundant with the type, which is the right order of belt and braces
  (research R11).

The load-bearing technical decisions:

- **One rendering, in core.** `renderReport(retrospective): string` produces the whole report body; the window
  displays that string and the export writes that string. FR-045's "the export matches the view" collapses
  from a comparison between two renderers into an identity (research R2).
- **Selection is string comparison on local dates.** All three sources already store `completedOn` as
  `string | null` in `YYYY-MM-DD`. Comparing as text is not a shortcut — parsing to instants is what would let
  a timezone move a completion across a boundary, which is the recalculation FR-052 forbids (research R3).
- **Three states, not two.** `null` means undated; a string that does not parse means "something is there and
  it is not a date", kept verbatim so the user can find it in vim. Folding them together would lose the text
  (research R3).
- **Logs are read from the directory, not through `ReviewService`.** Constructing that service requires
  `projects`, `topThree`, `inbox`, `waiting`, and a policy module — the entire review write surface — to read
  files. `LOG_DIR`, `reviewPath`, `isWeekId`, and the total `parseReview` are all already exported
  (research R4).
- **Counts are never stored.** Every total is computed by `renderReport` from the array it is about to print,
  so a number and the list beneath it cannot disagree (research R7).
- **The held reading is the window's.** Core returns a value with no notion of freshness; the existing
  `VaultChanged` emitter — which already fires after any vault write lands, from any window, because it hangs
  off the adapter — drives a notice with a re-read action (research R9).
- **Exactly one existing test file is modified**, and not the one this plan expected. `decision-points.test.ts`
  is untouched and still asserts five points — no rule was added, which was the prediction that mattered. What
  did change is a Feature 3 scope guard that forbade core from exporting anything matching `/retrospective/i`
  because it named a later feature; Feature 6 is now that feature. Corrected from "zero" during
  implementation, and recorded in Complexity Tracking.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 22 (`.nvmrc` pins 22; `engines.node >=22`)

**Primary Dependencies**: None added. Week arithmetic extends `weekly/iso-week.ts` by one function rather than
importing a date library, following that module's own stated reasoning.

**Storage**: None. This feature has no on-disk representation and no format contract, because it stores
nothing. It reads `projects/*.md`, `top-three.md`, and `log/*.md` in the shapes Features 3, 4, and 5 defined,
and adds no file, field, section, index, cache, or migration (FR-062).

**Testing**: `node --test` over compiled output, `TZ=America/New_York` (pinned and load-bearing: week spans
and date comparison are local-calendar facts). Five kinds of test carry the weight — byte-for-byte
immutability, determinism across repeated reads, boundary selection at both endpoints, read counting, and
export identity (research R14). Window behaviour under Playwright, where the config already lives.

**Target Platform**: Electron desktop on Linux and macOS. macOS builds are produced by GitHub Actions on a
macOS runner; nothing is built on the work machine.

**Project Type**: npm workspaces monorepo — `packages/core` (all domain logic, imports nothing from Electron)
and `packages/desktop` (thin client).

**Performance Goals**: One read per project file, one `identity.md`, one `top-three.md`, one `list("log")`,
and one per in-range log file, over a four-year range across 100 projects — verified by counting reads, not by
timing (SC-019). The ten-second first-entry budget (SC-001) is a quickstart smoke check, not a unit test.

**Constraints**: Fully offline. Writes nothing, ever, enforced by the dependency types. Adds no decision
point. The complete result is always returned — never capped, sampled, or paged, at any range length
(FR-006a). No existing behaviour changes; Features 1–5 suites pass unmodified.

**Scale/Scope**: Single user, single vault. Hundreds of projects, ~52 log files a year, ranges up to "since I
joined" — the four-year, 2,000-completion, 209-week case is the one the criteria are written against.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Assessed against Constitution v2.0.0, all seven principles.

| Principle | Assessment | How this plan satisfies it |
|---|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS | Every task is a failing test first. Three deserve naming. The **boundary selection** test fails before any comparator exists, and is the one that pins inclusivity at both endpoints. The **byte-for-byte immutability** test is written before the service can read anything, so its Red is "there is nothing to run yet" rather than "nothing was written" — a test that passes vacuously is the failure mode here, and the fixture is dirtied deliberately in a sibling test to prove the assertion has teeth. The **export identity** test asserts the view string and the export string are the same object's value, which cannot even be written until `renderReport` is the only renderer. |
| **II. Library-First** | PASS | Selection, ordering, the tie-break, week enumeration, grouping by committed week, the unreviewed report, the stated reasons for omitted sections, and every word of the report body are produced by `packages/core`. The window owns two date controls, a project picker, a change notice, two delivery buttons, and the styling of a string it was handed. Nothing about "which completions are in range" or "how this reads" is computable in the renderer, because core hands over the finished text. |
| **III. Local-First / Offline** | PASS | Nothing here has a network path to lose. An offline test mirrors the existing `project-offline.test.ts`. The export is produced in-process and delivered by Electron's clipboard and save dialog; SC-016's "zero bytes leave the machine" is trivially true and asserted anyway. |
| **IV. Durable Plain-Text** | PASS | The feature reads plain text and writes none. The export is markdown — the same plain text the vault is written in — and is legible with no application running (FR-047). Nothing is repaired: an unparseable date, a hand-edited status disagreeing with a ledger, a log file not named for a week, and an unreadable outcome line are each shown as they read and named by path so the user can fix them in an editor. `log/` is not created when absent (FR-029). |
| **V. Enforced Process, Separable Policy** | PASS | No decision point is added and none is consulted; the count stays at five, asserted by the existing `decision-points.test.ts` which is not edited. There is no rule here to allow, warn, or block — a date range is a question, not a commitment — and a point declared with no rule registered against it is exactly what the principle forbids. The absence of a `policy` dependency makes this structural rather than a claim (research R11). |
| **VI. Instant, Non-Blocking Capture** | PASS — not touched | Nothing in the capture path changes. The inbox is not read by this feature at all. |
| **VII. One Consistent Interaction Model** | PASS | Seven terms enter the core and every client inherits them: *retrospective*, *range*, *completion*, *undated*, *narrative*, *unreviewed*, *history* — the last reusing the meaning Feature 5 gave the ledger rather than inventing a second. No client introduces a concept the core does not have, which is guaranteed by the window receiving finished text. Refusals keep the established `{ ok: false, reason, message }` shape. |

**Blocking-principle review (I, III, IV, V)**: no violations. Four concessions are recorded in Complexity
Tracking; none relaxes a blocking guarantee, and two are single additive lines.

### Post-design re-check (after Phase 1)

Re-run against the completed contracts. Still PASS on all seven. Five things the design surfaced that the
pre-design check had not:

- **Principle II was at risk in the report's own words, and the risk is now closed by R2.** The sentence "no
  review was run for 47 of these 52 weeks" is a statement about the user's data. Had the window composed it
  from a structured value, that would have been a client holding domain vocabulary — a Principle VII breach
  reached through a Principle II one. One rendering in core removes the possibility rather than the
  temptation.
- **Principle V's guarantee is stronger than "no point was added".** Because `RetrospectiveServiceDeps` has no
  `policy` field, a future contributor who wanted to consult a rule from here would have to change the
  constructor — a visible edit — rather than quietly calling an injected module that was already there.
- **Principle IV needed an explicit contract line about the note.** FR-021 says the user's note is shown
  verbatim, and markdown's obvious rendering of quoted prose is a blockquote. Four `> ` characters the user
  did not write, arriving in the document they paste into, is a modification.
  [report-format.md](./contracts/report-format.md) therefore says in as many words that the note is
  unprefixed and unwrapped — otherwise the first implementer to reach for a blockquote would have been right
  by every convention except this one.
- **Principle I gained a trap worth naming.** The immutability test can pass without asserting anything, if
  the service under test never ran. It is paired with a deliberately-dirtying sibling so the assertion is
  known to have teeth. A vacuous green is the specific way a read-only feature's headline guarantee rots.
- **One requirement's letter cannot be met, and the design says so rather than pretending.** FR-020 requires
  an unreadable *project file* to be surfaced; `ProjectService.readAll` filters out a file that vanishes
  between `list` and `read`, and reaching that case would mean editing a shipped service. Recorded in
  Complexity Tracking with its blast radius rather than quietly scoped away.

No new violations. The Complexity Tracking table below is the post-design version.

### Post-analysis corrections (2026-08-16)

The `/speckit-analyze` pass found fourteen issues, all now fixed. Four were substantive enough to record here
rather than absorb, because each was a way this plan could have produced a green build that hid missing work:

- **Four Playwright specs were addressed to a directory Playwright does not read.** `playwright.config.ts`
  sets `testDir` to `packages/desktop/tests/e2e`; the tasks named `packages/desktop/tests/`. The held-reading
  and export tests would have been written, committed, and never run. The source tree above now carries the
  constraint inline so the next feature does not repeat it.
- **The feature's headline promise had no test.** FR-053 — nothing generated, summarized, ranked, or
  editorialized — was covered only for *figures*. It now has T026a, backed by T033a exporting the enumerable
  set of fixed labels the report may emit, so an invented adjective fails a test rather than reading
  plausibly.
- **`## Could not be read` was scheduled in Polish** while US2 and US3 both produce unreadable sources. Both
  checkpoints would have passed with a required section missing from the report. Moved to US2.
- **One analysis finding was itself wrong, and is recorded rather than quietly dropped.** The pass reported
  that `projects:list` had no preload bridge; it does, at `preload.ts:254`, and the finding came from a grep
  truncated by `head`. Corrected during implementation. A review that finds fourteen things will occasionally
  find a fifteenth that is not there, and the cost of not saying so is that the next reader trusts the list
  more than it deserves.

The remaining ten were smaller: a missing timezone-conversion test, two of SC-017's five degradation paths,
the FR-055/056/057 negative assertions, a speculative example in the report format that would itself have
violated FR-053, and five documentation inconsistencies.

## Project Structure

### Documentation (this feature)

```text
specs/006-retrospective-view/
├── plan.md                       # This file
├── research.md                   # Phase 0 output — R1–R14
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/                    # Phase 1 output
│   ├── retrospective-api.md      # Service surface, refusals, IPC channels, vocabulary
│   └── report-format.md          # The one rendering: view text and export text
├── checklists/
│   └── requirements.md           # Written by /speckit-specify, re-validated by /speckit-clarify
└── tasks.md                      # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── retrospective/                     # NEW — the whole feature
│   ├── types.ts                       # Query, Completion, Narrative, ProjectScoped, result
│   ├── select.ts                      # pure: date-in-range, dated/undated split, ordering
│   ├── weeks.ts                       # pure: weeks overlapping a range, spans
│   ├── retrospective-service.ts       # the one verb: read(query)
│   └── report.ts                      # pure: renderReport(retrospective) -> string
├── weekly/
│   └── iso-week.ts                    # MODIFIED: + weekEnd(id). Additive; no signature changes.
└── index.ts                           # MODIFIED: additive exports only

packages/core/tests/                   # ~31 new test files, flat, kebab-case by topic
                                       # ZERO existing test files modified

packages/desktop/src/
├── main/
│   ├── main.ts                        # MODIFIED: wire service + window; VaultChanged -> notice
│   ├── ipc.ts                         # MODIFIED: + registerRetrospectiveIpc
│   ├── tray.ts                        # MODIFIED: + menu entry
│   └── retrospective-window.ts        # NEW
├── preload/preload.ts                 # MODIFIED: + retrospective bridge (no write verb);
│                                      #   + the missing projects:list bridge for the picker
├── renderer/
│   ├── retrospective.html             # NEW
│   └── retrospective.ts               # NEW — chrome only; displays the string core rendered
└── ../tests/e2e/                      # NEW: retrospective-held.spec.ts, retrospective-export.spec.ts
                                       #   (playwright.config.ts sets testDir to tests/e2e — a spec
                                       #    placed anywhere else is silently never run)

package.json                           # MODIFIED: build:renderer copies retrospective.html
```

**Structure Decision**: The existing two-package monorepo is kept. `retrospective/` is a new sibling module
inside `packages/core/src`, matching how `capture/`, `inbox/`, `sort/`, `projects/`, `identity/`, `policy/`,
`weekly/`, `waiting/`, and `review/` are already organised.

It is split into four files rather than one because three of them are pure and one does I/O, and that seam is
what makes the selection rules, the week arithmetic, and the report text testable without a filesystem —
the same split `projects/` uses between `document.ts`, `gaps.ts`, and `project-service.ts`.

**Not a fourth document module.** Feature 5's research R11 set a trigger: when a *fourth* document type needs
markdown section handling, extract `vault/markdown.ts` from all four at once. This feature does not trip it.
It parses no document of its own — it reuses `parseProject`, `parseTopThree`/`parseOutcome`, and `parseReview`
through their existing modules — and `report.ts` only *writes* markdown, which is a fresh render rather than
section handling. The trigger is still armed for whoever gets there.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A shipped module gains a function: `weekly/iso-week.ts` exports `weekEnd(id)`. | FR-028 requires every individually shown week to state the calendar dates it spans, so a partially covered week is legible as such. `weekStart(id)` exists; the other end does not. | **A local `weekEnd` in `retrospective/weeks.ts`** — rejected by the rule this repo already wrote for itself, in `daysBetween`'s own comment: *"One definition, because two would disagree… A second implementation that rounded differently would be a bug nobody could see until the two numbers appeared on the same screen."* Week arithmetic has one home. The function is three lines, which is exactly what makes a second copy tempting and undetectable. **Deriving the span from the log file** — rejected: an unreviewed week has no file and the span is a fact about the calendar, not about the log. The change is purely additive: no existing signature moves, and `iso-week.test.ts` and `iso-week-arithmetic.test.ts` pass unmodified. |
| FR-020's letter is not fully met for project files. A project file that vanishes between `vault.list("projects")` and `vault.read` is silently dropped rather than surfaced as unreadable. | `ProjectService.readAll` does `projects.filter((p) => p !== null)`, and it is private. Surfacing that case means widening `listDetailed`'s return type — a shipped service with four list methods and a documented single-pass contract — so that one new reader can report a race that only occurs if a file is deleted mid-read. | **Widening `listDetailed` to `{ projects, missing }`** — edits a shipped service and every existing caller's destructuring, for a case with no user-visible cause. **A second read pass to detect the gap** — reintroduces exactly the quadratic path `listDetailed` was shaped to prevent, and SC-019 counts reads. **Reading projects through `VaultStore` directly** — a second implementation of "read every project once", which is worse than the gap. The two cases FR-020 was actually written for are both covered: an unparseable outcome line and a log file not named for a week both appear in `unreadable` with their paths. `parseProject` is total, so a malformed project file yields a `Project` and is shown as it reads rather than lost. Recorded here rather than scoped out of the spec, because a requirement partially met is worth a reviewer's attention and a silently narrowed one is not. |
| One `identity.md` read per retrospective that this feature does not need. `listDetailed()` resolves every project's DRI; the retrospective uses none of it. | Reusing `listDetailed` is what guarantees one read per project file (SC-019), and it is documented as existing precisely for a caller that needs bodies as well as rows. Its identity read is one per call, not one per project. | **Adding `listProjects(): Promise<Project[]>` to `ProjectService`** — a fifth list method on a shipped class to save a single file read. **Reimplementing `readAll` in the retrospective** — a second way to read all projects, which is the drift `listDetailed` exists to prevent. An accepted waste of exactly one file read per retrospective, bounded and constant. |
| One existing test file is edited: `packages/core/tests/project-scope-boundaries.test.ts` drops `retrospective` from the pattern of names core may not export. | The guard was written when the retrospective was a *later* feature, and an export named for it would have meant Feature 3 growing into unscoped work. That is no longer what such an export means. | **Leaving it red** — impossible; `RetrospectiveService` is this feature's surface. **Renaming the export to slip past the pattern** — the guard would then be passing on a technicality while the thing it guards against had happened. **Deleting the test** — it still guards `httpserver`, and Feature 7 has not shipped. The pattern shrinks as features land and each removal is dated, so a reader can tell a deliberate amendment from an erosion. This plan predicted "zero existing tests modified"; the prediction was wrong and is corrected here rather than in silence. |
| **Added 2026-08-16 (convergence).** Two more existing test files are edited, both of this feature's own: `retrospective-narrowing.test.ts` and `report-empty.test.ts`. The running total of shipped tests this feature disturbed is now three. | Both asserted the defect T111 fixed, as though it were the design. `retrospective-narrowing.test.ts` required that narrowing to a slug with no file yield an empty reading with `history === null` and `projectTitle === null` — the two nulls *were* the bug, on a path that still omits the outcome and narrative sections *because* it is narrowed. `report-empty.test.ts` went further and inverted its own name: "an empty narrowed retrospective **names the project** it found nothing for" asserted `doesNotMatch(/^Project: /m)`. | **Leaving them** — they contradict FR-046 and SC-014a, which a narrowed report must satisfy. **Changing only the implementation** — impossible; a test that pins the old behaviour fails whatever the fix. Both are amended in place with a dated note explaining what they used to assert and why that reading was wrong, rather than deleted: a reader who finds the assertion reversed deserves the reasoning, and `report-empty.test.ts`'s case is instructive on its own — a test whose name states the requirement and whose body asserts the opposite passes forever while guarding nothing. |
| Two build-time edits outside the source tree: root `package.json`'s `build:renderer` script gains a `retrospective.html` copy, and `tray.ts` gains a menu entry. | The renderer build copies HTML per file by name, and a window nobody can open is not a delivered feature. | **A glob in `build:renderer`** — a build-script refactor smuggled into a feature branch, changing how five existing windows are built to avoid appending one filename. Worth doing, and worth doing on its own; noted here so a later cleanup task has something to act on. Both edits are one line each and neither changes existing behaviour. |
