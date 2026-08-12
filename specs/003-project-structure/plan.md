# Implementation Plan: Projects with Milestones

**Branch**: `003-project-structure` | **Date**: 2026-08-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-project-structure/spec.md`

## Summary

Give a project the structure it needs to be driven to completion — an outcome, up to four milestones each
with a verifier, a next action, a DRI, a status — without ever forcing any of it. A stub sort wrote last
week is a valid project; this feature fills it in, in pieces, whenever the user chooses.

Everything lives in `@waypoint/core` behind `ProjectService` and `AreaService`, the verbs Feature 5's
review, Feature 6's HTTP API, Feature 7's LLM layer, and the later retrospective view will call rather than
reimplement. The Electron client renders what those verbs return and sends back what the user typed.

The hard part is not the logic — the rules are small — it is the **format**. Feature 2 already shipped stub
files into vaults that are git-tracked and hand-edited, so this feature extends them in place: new fields
become preamble lines beside the existing `status: active`, and outcome and milestones become `##` sections
above `## Unprocessed`. Nothing migrates. Reading a project never rewrites it, so opening the app produces
no `git diff`.

Two consequences fall out and shape everything else. Writes are **field-level**: each mutator verifies its
own field against disk and refuses on mismatch, which is Feature 2's verify-before-write narrowed from a
whole item to one field. And the incomplete flag is **computed on every read** rather than stored, so a
hand-edit in vim keeps it accurate with the app uninvolved.

**No new ports, no new adapters, no new dependencies.** `VaultStore` as Feature 2 defined it — `list`,
`read`, `write`, `appendLine` — is the complete I/O surface this feature needs.

## Technical Context

**Language/Version**: TypeScript 5.7, `tsc` only, no bundler. Node 22 LTS pinned via `.nvmrc` (v22.22.1).
The system `node` on PATH is 18.19.1 and EOL — `nvm use` before working here.

**Primary Dependencies**: None added. Existing `electron` runtime; `typescript`, `@types/node`,
`electron-builder`, `@playwright/test` as dev. The parser, the renderer, and the gap calculation are string
work over `node:fs/promises` primitives that already exist — a YAML library was the one real temptation and
is rejected in [research R1](research.md), because adopting frontmatter would force a migration of every
stub already in users' vaults.

**Storage**: Plain-text markdown in the existing vault. `projects/<slug>.md` and `areas/<slug>.md` gain
preamble fields and `## Outcome` / `## Milestones` sections; `## Unprocessed`, `trash.md`, and every other
Feature 2 artifact are unchanged. Completion dates are `YYYY-MM-DD` local, stored in the same files, with
no index and no history file (research R10).

**Testing**: `node:test` + `node:assert` for core against the existing `FakeVaultStore`; real-filesystem
tests in `packages/desktop/tests` only where an adapter is genuinely exercised; Playwright `_electron` for
the project view. Because no new adapters are needed, the fast suite covers essentially the whole feature.

**Target Platform**: macOS 14+ Apple Silicon and Linux x64. Dev on Linux x64; macOS artifacts built only by
GitHub Actions on a macOS runner and shipped as release artifacts, per the ROADMAP build-machine rule. No
build or package installation happens on the work machine.

**Project Type**: Desktop app (Electron thin client) over a shared core library.

**Performance Goals**: The project list renders in **under 100 ms** for 100 projects (SC-017) — it reads
every project file to compute progress and gaps, and that read must not become a reason to cache. Recorded
as a spec success criterion rather than left plan-local, following the precedent Feature 2 set, so it is
traceable from the requirement side. Opening a single project is a one-file read and is not separately
budgeted. As with Features 1 and 2, CI timings are a regression signal and the authoritative measurement is
real hardware.

**Constraints**: Fully offline (Principle III). Reading never writes — open-and-close produces no diff
(research R3). No write may destroy a hand-edit (FR-045). No new dependencies.

**Scale/Scope**: Single local user, one vault. Realistically tens of projects and areas, each file a few
kilobytes. Whole files are read into memory, which stays comfortable far past any plausible vault.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this design satisfies it |
|---|---|---|---|
| I | Test-First (NON-NEGOTIABLE) | **PASS** | The highest-risk code — the parser and the milestone line renderer — is pure string work, so the round-trip and byte-preservation properties are testable before any service exists. Core suite runs against `FakeVaultStore` with no filesystem, keeping red-green-refactor fast enough to actually follow. Every task pairs a failing test written first. |
| II | Library-First | **PASS** | `ProjectService` and `AreaService` hold every rule. The core imports nothing from Electron. No new port is introduced: `VaultStore` moves bytes to a vault-relative path and has no concept of a project, so an adapter cannot express "complete a milestone" and a client cannot invent one. |
| III | Local-First & Offline | **PASS** | No network on any code path. Nothing added has an external dependency to lose. |
| IV | Durable Plain-Text Data | **PASS** | The whole feature is a markdown format, specified as a user-facing contract. Milestone state is a GFM checkbox a user edits by typing one character. Completion dates live in the project files themselves so a later retrospective needs no index that could desync. Reading never reformats — the git-diff test in [quickstart §2](quickstart.md) is the enforcement. |
| V | Core Enforces Process | **PASS** (with a deliberate scope note, below) | The milestone cap and the open-milestone confirmation are core refusals, unbypassable by a client (research R8). The incomplete flag is computed by the core so Feature 5's review and the UI cannot disagree. Area statuses are constrained by the type system, not by convention. |
| VI | Instant, Non-Blocking Capture | **PASS** (scoped) | This principle governs the capture surface, which this feature does not touch. Like sort, structure editing awaits the disk so an edit is durable before it is reported saved (FR-030). |
| VII | One Consistent Interaction Model | **PASS** | Each verb is defined once. Feature 6 exposes them over HTTP and Feature 7 calls them with human-confirmed input; neither gets a second path to a completion date. Vocabulary — project, area, outcome, milestone, next action, DRI, verifier — comes from the ROADMAP and the spec, and the file format reuses `@name` and ` — ` from Feature 2's `waiting.md` so the user learns one convention. |

**Post-Phase 1 re-check**: All seven still PASS. The design added no client-side domain logic, no network
dependency, no non-plain-text user data, and — notably — no new port. **No violations — Complexity Tracking
omitted as unused.**

### A scope note on Principle V

The incomplete-structure flag is **informational and never blocks** (FR-019). Read quickly, that looks like
process left to user memory, which Principle V forbids.

It is not. Principle V requires that *defined rituals* be enforced in core logic — inbox zero, the weekly
review sequence, WIP limits. "Every project must be fully structured before you may touch it" is not one of
those rituals, and the spec makes the opposite requirement explicitly and repeatedly: structure is never
forced up front, because forcing it at creation time is what stops people using the tool during a fast
sort. The flag's job is to make half-defined projects *impossible to miss*, and that job is done in the
core — `structureGaps()` is computed there, from the file, so the UI and Feature 5's review get the same
answer.

Where this feature does have a rule, the core enforces it and returns a refusal a client cannot skip: the
fifth milestone (FR-013), the confirmation before closing a project with open work (FR-034a), and the two
statuses an area may hold (FR-041). Those are the process; the flag is the reporting.

### Two deliberate trade-offs

Neither is a principle violation; both are recorded in [research.md](research.md) rather than left implicit.

- **No filesystem watching** (R7). An open project view does not see a text-editor edit until it is
  reopened, exactly as Feature 2's sort view behaves. `fs.watch` would narrow that window, not close it,
  and the guarantee that actually protects the file is FR-045's verification at write time.
- **No write-ahead journal for dismissing an unprocessed item** (R9). It touches two files, so a crash
  between them leaves a duplicate. Sort earned its journal because a duplicated inbox item corrupts the
  inbox-zero state Feature 5 gates on; here the worst outcome is one spare line in an append-only file.

## Project Structure

### Documentation (this feature)

```text
specs/003-project-structure/
├── plan.md                    # This file
├── spec.md                    # Feature specification
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── contracts/                 # Phase 1 output
│   ├── projects-api.md        # @waypoint/core project + area surface
│   ├── project-format.md      # projects/<slug>.md and areas/<slug>.md on disk (user-facing)
│   └── ipc-projects.md        # renderer ↔ main channels for the project view
├── checklists/
│   └── requirements.md        # Spec quality checklist
└── tasks.md                   # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/                                  # @waypoint/core — zero Electron imports
│   ├── src/
│   │   ├── capture/                       # unchanged (Feature 1)
│   │   ├── inbox/                         # unchanged (Features 1–2)
│   │   ├── sort/                          # unchanged (Feature 2)
│   │   ├── projects/
│   │   │   ├── document.ts                # NEW — parse/render a project or area file, lossless
│   │   │   ├── milestone.ts               # NEW — the milestone line format, both directions
│   │   │   ├── gaps.ts                    # NEW — structureGaps(), pure and never stored
│   │   │   ├── project-service.ts         # NEW — the project verbs
│   │   │   └── area-service.ts            # NEW — the area verbs, deliberately smaller
│   │   ├── vault/
│   │   │   ├── slug.ts                    # REUSED unchanged
│   │   │   ├── stub.ts                    # REUSED unchanged — create() emits exactly this
│   │   │   ├── unprocessed.ts             # EXTENDED — read + remove one item; insertion untouched
│   │   │   └── lists.ts                   # REUSED — trashLine(), localDate()
│   │   ├── ports/index.ts                 # UNCHANGED — VaultStore already suffices (R6)
│   │   ├── errors.ts                      # unchanged
│   │   └── index.ts                       # EXTENDED — export the project surface
│   └── tests/                             # node:test, FakeVaultStore, no fs
│
└── desktop/                               # Electron thin client
    ├── src/
    │   ├── main/
    │   │   ├── vault-changed.ts           # NEW — generic "a vault file changed" signal (R7)
    │   │   ├── projects-window.ts         # NEW — the project view window
    │   │   ├── adapters/fs-vault-store.ts # UNCHANGED — no adapter work in this feature
    │   │   ├── ipc.ts                     # EXTENDED — project channels, pass-through only
    │   │   └── main.ts                    # EXTENDED — construct the services, wire the signal
    │   ├── preload/preload.ts             # EXTENDED — expose project channels
    │   └── renderer/
    │       ├── projects.html              # NEW — list + single project view
    │       └── projects.ts                # NEW — input and rendering only
    └── tests/                             # Playwright E2E; no new adapter tests needed
```

**Structure Decision**: Same two-package workspace, extended rather than reshaped. Project logic gets its
own `src/projects/` rather than joining `src/vault/`, because `vault/` holds *format primitives* that both
sort and this feature call — slug, stub, unprocessed insertion, list lines — while `projects/` holds the
verbs. Keeping that line means `vault/stub.ts` stays the single definition of what a new project file looks
like, called by both features, which is what guarantees a project created here and one created mid-sort are
byte-identical.

`document.ts` and `milestone.ts` sit beside each other because they are the two halves of one format and
must change together, the same reasoning that put `inbox/parse.ts` next to `inbox/serialize.ts`.

## Implementation Sequencing

Ordered so each slice is independently testable and delivers the priority above it (P1–P4 from the spec).
Detailed tasks come from `/speckit-tasks`.

| Slice | Delivers | Gate |
|---|---|---|
| 0. Milestone format | `milestone.ts` — parse and render, right-to-left tail parsing | Round-trip on every fixture; a definition of done containing ` — ` and `@` survives |
| 1. Document format | `document.ts` — parse a project/area, render back losslessly | **Byte-identical round-trip with no edit**, including unknown keys, unknown sections, hand-shaped order |
| 2. Gaps | `gaps.ts` — the incomplete flag, derived | Every combination of the three missing elements; DRI never flags; status never influences |
| 3. Project reads (P1) | `list()`, `listActive()`, `get()`, `create()` over `FakeVaultStore` | A bare stub reads as a valid project with three nulls; `create()` output equals `renderStub()` byte for byte; the active-list rule is core-side, never a client filter |
| 4. Field writes (P1) | The four scalar setters, field-level verification | `field-changed` on a changed field; an unrelated change does **not** cancel; refusal leaves the file untouched |
| 5. Milestone writes (P1) | add / edit / remove, the cap, `MilestoneRef` verification | Fifth refused; hand-written sixth still read; per-milestone verification units |
| 6. Completion (P2) | `completeMilestone`, `reopenMilestone`, `complete`, `reopen`, dates | Confirmation refusal carries the open names; dates set and cleared only by completion verbs; edits never touch a date |
| 7. Areas (P4) | `AreaService`, two statuses, no structure verbs | `done` cannot typecheck onto an area; hand-edited status preserved, never offered |
| 8. Unprocessed (P1) | Read items; `dismissUnprocessed` → `trash.md` then remove | Item findable in trash with text and timestamp; other items keep order; nothing converted |
| 9. Electron view (P1–P3) | Window, IPC, renderer, the list with flags and progress | Quickstart §1, §3–§9; P1–P3 demoable |
| 10. Change signal | `vault-changed.ts`, `vault:changed`, refresh on show | Quickstart §13, including the named limit |
| 11. Format doc amendment | Feature 2's `vault-format.md` points at the extended format | Both contract docs agree on what a project file is |

Slices 0–2 before any service is deliberate: the format is where the risk lives and where a mistake is
expensive to undo once files exist in vaults, and all three are pure functions testable in isolation.
Slice 1's byte-identical round-trip is the gate the rest of the feature rests on.

## Explicitly Out of Scope

The weekly review ritual (Feature 5), the top-three / WIP limit (Feature 4), the retrospective date-range
view (later — this feature guarantees only that the dates it will read are present and parseable), and the
local HTTP/JSON API (Feature 6). `ProjectService` is designed as the verb surface that API will expose, but
nothing here serves HTTP.

Any AI-assisted structuring (Feature 7), including automatic conversion of an unprocessed item into a
milestone or next action (FR-046c) — this feature shows the items and lets the user clear them, and stops
there. Nothing suggests, ranks, or pre-fills a value (FR-048).

Deleting a project or an area. Renaming a project's file when its title changes (spec Assumptions).
Filesystem watching (research R7).
