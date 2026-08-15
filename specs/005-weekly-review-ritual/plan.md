# Implementation Plan: Weekly Review Ritual

**Branch**: `005-weekly-review-ritual` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-weekly-review-ritual/spec.md`

## Summary

A four-step guided review in core — inbox, projects, waiting-for, top three — that surfaces, prompts, and
records, and changes nothing on its own. It writes one plain-text file per ISO week at `log/YYYY-Www.md`,
which is also where an unfinished review lives, so pausing and resuming needs no second representation of
anything.

Three things ship alongside it because the ritual cannot do its job without them, each reaching into code
that already shipped:

- **A project ledger** — an append-only `## Ledger` section in the project file, written by the status verbs
  themselves, which is the only place a duration is observable.
- **Two more decision points** — the inbox gate and a staleness check shared by waiting-for items and
  waiting projects, taking the seam from three points to five.
- **A widened top-three write window** — current week plus next, on every surface, so the review can commit
  to the week ahead without owning a private write path.

Plus a **summary port**: an interface and one call site at review completion, no provider, nothing leaving
the machine.

The load-bearing technical decisions:

- **The log file is the state.** Created at `status: in progress`, flipped to `complete` at the end. No
  journal, no promotion, no dot-file (research R2).
- **Position is derived, not stored.** `step:` is a preamble field because a step can pass having decided
  nothing; position *within* the walk is "the first project with no line recorded against it", which stays
  correct when the walk set changes mid-review (research R3).
- **Ledger writes compose into the existing status write.** `writeField` already takes a content transform,
  so the entry and the `status:` line land in one atomic write, one change signal, no window where they
  disagree (research R5).
- **One staleness point, two subjects.** `waiting.stale.check` carries `subject: "item" | "project"` for the
  message only. One point is what makes "not separately configurable" structural rather than a promise
  (research R6).
- **Absent policy means default rules; absent summary provider means no summary.** The asymmetry is
  deliberate: a rule you can drop by forgetting an argument is a bypass, and a summary that appears because
  an argument was forgotten is generated text nobody asked for (research R10).
- **Acceptance is an argument, not a flag.** `complete({ note, summary? })` records only what the caller
  hands back, so "record a draft without asking" is not expressible in the API.
- **Exactly one existing test changes**: `decision-points.test.ts`, from 3 to 5. The count is what changed.
  Every other Feature 3 and Feature 4 test passes unmodified, and the parity tests exist to prove it.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 22 (`.nvmrc` pins 22; `engines.node >=22`)

**Primary Dependencies**: None added. Standard library and the existing workspace packages only. Week
arithmetic extends `weekly/iso-week.ts` rather than importing a date library (research R9).

**Storage**: Plain-text markdown in the git-tracked vault. One new directory, `log/`, holding one file per
week; one new section in project files (`## Ledger`); one new line shape inside `waiting.md`; two new keys in
the existing `policy.md`. All reached through the existing `VaultStore`, whose `list()` union widens by one
member (research R12).

**Testing**: `node --test` over compiled output, `TZ=America/New_York` (already pinned, and load-bearing:
week boundaries and staleness are local-date facts). Parity tests, read counting, and payload containment as
described in research R14.

**Target Platform**: Electron desktop on Linux and macOS. macOS builds are produced by GitHub Actions on a
macOS runner and downloaded as release artifacts; nothing is built or installed on the work machine.

**Project Type**: npm workspaces monorepo — `packages/core` (all domain logic, imports nothing from
Electron) and `packages/desktop` (thin client).

**Performance Goals**: The project step presents its first project within 1 second in a 100-project vault,
reading each project file at most once, verified by counting reads rather than by timing (SC-016). The
waiting-for step is budgeted at 200 items with one policy decision each (research R7).

**Constraints**: Fully offline, including completion — no provider ships, and the port is not on any
required path. No derived state persisted. No existing project file rewritten or migrated; a project gains
its ledger the first time an action is recorded against it. Feature 3 and Feature 4 suites pass unmodified
apart from the decision-point count.

**Scale/Scope**: Single user, single vault. Hundreds of projects, ~52 log files a year, tens to low hundreds
of waiting-for items. Ledgers grow without bound and are never compacted.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Assessed against Constitution v2.0.0, all seven principles.

| Principle | Assessment | How this plan satisfies it |
|---|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS | Every task is a failing test first. Two places deserve naming: the **parity tests** are written before the review can run a status change at all, so the Red is "the review has no path to this rule yet"; and the **ledger** starts from a test asserting that a hand-edited `waiting` project reports an unknown duration, which fails before any parsing exists. Feature 3 and Feature 4 suites are the regression net and are not edited (one exception, below). |
| **II. Library-First** | PASS | The sequence, the walk set, the staleness question, the log format, the note, and every refusal message are produced by `packages/core`. The review window renders a step and routes input. Nothing about "which projects are walked" or "how long has this waited" is computable in the renderer, because core hands it the finished answer. |
| **III. Local-First / Offline** | PASS | Every step, including completion, works with the network down — the summary port has no provider by default and is not on any required path (FR-103, FR-104). An offline test mirrors the existing `project-offline.test.ts` for `ReviewService`. A configured provider that is unreachable surfaces the failure and completes the review anyway (FR-111). |
| **IV. Durable Plain-Text** | PASS | The review's own state *is* its record: `log/YYYY-Www.md`, readable and legible while incomplete. The ledger is a `## Ledger` section in the project's own file, in the same `- ` line grammar as milestones. Waiting-for actions are nested bullets in `waiting.md`. Nothing is deleted: a received item stays, a ledger entry is never rewritten, a past log is never regenerated. `log/` is created when the first review starts, not speculatively. |
| **V. Enforced Process, Separable Policy** | PASS | Two decision points added, both with a rule registered against them, none declared speculatively (FR-080). Both new rules live in `DefaultPolicy`; core never learns the threshold or the gate's severity, and `ReviewService` cannot compute either. Configuration joins the existing `policy.md` in the vault. The summary port is explicitly **not** a decision point (FR-113) — it returns text, and the closed `allow`/`warn`/`block` set is untouched. Still exactly one policy module; no loader, no discovery, no exported extension API. |
| **VI. Instant, Non-Blocking Capture** | PASS — not touched | Nothing in the capture path changes. The inbox is read, never written, by this feature (FR-077). |
| **VII. One Consistent Interaction Model** | PASS | New vocabulary is added to core and inherited by every client: *review*, *step*, *walk*, *stale*, *followed up*, *received*, *ledger*, *note*. The review reuses the verbs a user already knows — a status change inside the walk is the same verb, with the same refusal, as one from the projects window. Refusals keep the established `{ ok: false, reason, message }` shape. |

**Blocking-principle review (I, III, IV, V)**: no violations. Three concessions are recorded in Complexity
Tracking; none of them relaxes a blocking guarantee.

### Post-design re-check (after Phase 1)

Re-run against the completed contracts. Still PASS on all seven. Four things the design surfaced that the
pre-design check had not:

- **Principle II gained a guard in the signature.** `SummaryProvider.draft` takes a `ReviewRecord`, not a
  `VaultStore`. The privacy boundary in FR-108 is therefore a type rather than a rule someone has to
  remember, and a provider that wanted more would have to change core to get it.
- **Principle V's "not separately configurable" is structural.** One decision point with a `subject`
  discriminator means a future contributor who wanted separate thresholds would have to split the point,
  which is a visible change to `DECISION_POINTS`, not a quiet extra config key.
- **Principle IV's "never repaired" needed an explicit contract line.** A project whose `status:` disagrees
  with its ledger is a state the format permits, so [project-ledger.md](./contracts/project-ledger.md) says
  in as many words that both are shown as they read and neither is corrected — otherwise the first
  implementer to notice would "fix" it.
- **Principle VII is at risk in one place, now pinned.** The review's status-change path must return the
  *same* `ProjectOutcome` shape the projects renderer already branches on, including `open` for the
  open-milestone confirmation. Feature 4 recorded that trap; the review is the second surface to fall into
  it. The parity tests assert message and subjects, not just verdict, for exactly this reason.

No new violations. The Complexity Tracking table below is the post-design version: one entry was added
during design (the third copy of section handling).

## Project Structure

### Documentation (this feature)

```text
specs/005-weekly-review-ritual/
├── plan.md                  # This file
├── research.md              # Phase 0 output
├── data-model.md            # Phase 1 output
├── quickstart.md            # Phase 1 output
├── contracts/               # Phase 1 output
│   ├── review-api.md        # ReviewService verbs, refusals, IPC channels
│   ├── review-log-format.md # log/YYYY-Www.md on disk, in progress and complete
│   ├── project-ledger.md    # ## Ledger section + waiting.md action lines
│   ├── policy-seam.md       # The two new decision points and their config
│   └── summary-port.md      # SummaryProvider, acceptance, payload boundary
├── checklists/
│   └── requirements.md      # Written by /speckit-specify, updated by /speckit-clarify
└── tasks.md                 # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── ports/
│   └── index.ts                  # MODIFIED: + 2 decision points, + SummaryProvider, list("log")
├── review/                       # NEW
│   ├── types.ts                  # Review, ReviewStep, records, refusals
│   ├── review-document.ts        # parse/render log/YYYY-Www.md, surgical writes
│   └── review-service.ts         # the verbs: start, resume, step transitions, complete
├── waiting/                      # NEW
│   ├── types.ts                  # WaitingItem, WaitingAction, WaitingRef
│   ├── waiting-document.ts       # parse/render waiting.md incl. nested action lines
│   └── waiting-service.ts        # list, recordFollowUp, recordReceived
├── weekly/
│   ├── iso-week.ts               # MODIFIED: + weekStart(id), + nextWeek(id)
│   ├── types.ts                  # MODIFIED: + "future-week" refusal
│   └── top-three-service.ts      # MODIFIED: writable window = current + next
├── projects/
│   ├── ledger.ts                 # NEW: entry shape, parse, render, append
│   ├── document.ts               # MODIFIED: + LEDGER_HEADING, appendLedgerLine
│   ├── project-service.ts        # MODIFIED: status verbs append entries; statusSince
│   └── types.ts                  # MODIFIED: + LedgerEntry, ProjectSummary.statusSince
├── policy/
│   ├── policy-config.ts          # MODIFIED: + inbox gate, staleness days
│   └── default-policy.ts         # MODIFIED: + the two new rules
└── index.ts                      # MODIFIED: export the new public surface

packages/core/tests/               # ~22 new test files
                                   # MODIFIED: decision-points.test.ts only (3 → 5)

packages/desktop/src/
├── main/
│   ├── main.ts                   # MODIFIED: wire review window + services
│   ├── ipc.ts                    # MODIFIED: + registerReviewIpc
│   ├── review-window.ts          # NEW
│   └── adapters/fs-vault-store.ts # MODIFIED: list() accepts "log"
├── preload/preload.ts            # MODIFIED: + reviewApi
└── renderer/
    ├── review.html               # NEW
    ├── review.ts                 # NEW
    └── top-three.ts              # MODIFIED: next week is editable
```

**Structure Decision**: The existing two-package monorepo is kept. `review/` and `waiting/` are new sibling
modules inside `packages/core/src`, matching how `capture/`, `inbox/`, `sort/`, `projects/`, `identity/`,
`policy/`, and `weekly/` are already organised. The ledger lives in `projects/` rather than its own module,
because it is part of what a project file *is* and is written by the project verbs; when a second record type
gains one (FR-098), the shared shape moves out then and not before.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A shipped module's behavior widens: `TopThreeService` accepts writes to the next week, not just the current one. | FR-049/FR-049a. A review run at the end of week W commits to W+1, and the widening has to apply to every surface or the review holds behavior no other client has — which Principle II forbids and Feature 7 would have to reimplement. | **A review-only write path** — behavior existing in exactly one client, the thing the architecture is built to prevent. **Setting the current week instead** (Option A at clarification) — the log for week W would then record the *previous* week's slippage, making the permanent record harder to read than the thing it describes. **Making the window configurable** — that is a rule, so it would need a sixth decision point, for a flexibility nobody asked for. Past weeks stay read-only and `top-three-preservation.test.ts` passes unmodified, so the widening is strictly additive. |
| Nine existing test files are edited: eight because a *shape* grew, one because a *behaviour* did. Shape: `decision-points.test.ts` (3 points → 5), `default-policy.test.ts` (five points), `policy-config.test.ts` (two new keys), `project-service.list.test.ts` (`ProjectSummary` gained `statusSince`), and four `Project` fixtures that now need `ledger: []`. Behaviour: `project-service.status.test.ts`, whose "changes only the status line" assertion had to widen. | The feature adds two decision points, two config keys, a field to `Project` and to `ProjectSummary`, and one line to what a status change writes. Each of these tests asserts an exact shape, so none can be left alone without asserting something false — and the last one asserted a behaviour the ledger deliberately changes. | **Leaving the count at 3** — impossible; the points exist. **Deleting the assertions** — they are the guard against speculative decision points and against a new field arriving unnoticed, which is exactly what makes them worth keeping. **Making `Project.ledger` optional** to spare four fixtures — weakening a type to avoid touching four lines, and every reader would then have to write `?? []`. **Relaxing the status-line assertion** to stop comparing the rest of the file — it was widened to name the ledger entry and strengthened to check the entry's content, so it still fails if anything else moves. **Corrected twice during implementation**: this row claimed *one* file when written, was corrected to *three* during US1, and to *nine* here. Each correction is recorded rather than absorbed, because the number of old tests a feature disturbs is the honest measure of how much it reached into shipped work. Every behavioural assertion in Features 2–4 other than the one named above passes unmodified, and the three parity tests exist to prove behaviour did not drift. |
| **Added during convergence (2026-08-15).** Two shipped files were reached into that the Source Code map above does not name: `packages/core/src/vault/lists.ts` gained `daysBetween`, and `packages/core/src/weekly/top-three-document.ts` gained the exported `ParsedWeek`. | `daysBetween` is the one definition of calendar-day arithmetic, shared by the ledger's ` — after Nd` tail and the staleness rule; `lists.ts` is where `localDate` already lives, so it is the file that already owns "what day is it". `ParsedWeek` is `Omit<Week, "current" \| "writable">` — the widened window means the document parser can no longer know whether a week is writable, because that is now a question about *two* weeks rather than a property of the file. | **A second copy of day arithmetic** inside `policy/` or `projects/` — two implementations of "how many days between these dates" is exactly the drift the ledger and the staleness rule must not have between them, since one produces the tail the other reads. **Leaving `parseTopThree` returning `Week`** — it would have had to invent a `writable` value it cannot compute, and inventing one is how a parser starts holding a rule. Recorded here rather than absorbed silently: this table is the honest count of what a feature disturbed, and an unlisted reach is the one nobody reviews. |
| A third local copy of markdown section handling, in `review/review-document.ts`, beside `projects/document.ts` and `weekly/top-three-document.ts`. | The log file's semantics differ from both — an in-progress marker, per-step sections, append-within-section writes. The established habit in this repo is a document module per document type, with a comment explaining why sharing would be wrong. | **Extracting `vault/markdown.ts` now** — refactors two shipped, heavily tested files to serve a third that does not exist yet, during a feature that already reaches into `ProjectService` and `TopThreeService`. Recorded in research R11 with an explicit trigger: when a **fourth** document type needs section handling, extract from all four at once. Written down so "extract it later" is something a future task can act on rather than a sentence in a review comment. |
