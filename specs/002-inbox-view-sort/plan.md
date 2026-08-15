# Implementation Plan: Inbox View & Sort

**Branch**: `002-inbox-view-sort` | **Date**: 2026-08-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-inbox-view-sort/spec.md`

## Summary

Read `inbox.md` back into items — the parser Feature 1 deliberately did not write — present them one at a
time in file order, and route each to one of five destinations: a project, an area, `waiting.md`,
`calendar.md`, or `trash.md`. Projects and areas can be created mid-sort from a title alone, producing a
stub file that Feature 3 later fills in without restructuring.

Every rule lives in `@waypoint/core` behind a single `SortService`, the verb Feature 6's HTTP API and
Feature 7's LLM layer will call rather than reimplement. The Electron client renders an item and sends a
decision; it holds no notion of what a destination is.

The hard part is not the routing, it is the commit. Each decision touches two files — append to a
destination, remove from the inbox — and POSIX offers no atomic way to do both. A write-ahead journal makes
the pair effectively-once: crash anywhere in the sequence and the next launch finishes it. Sort also has to
rewrite `inbox.md` in place to remove an item from the middle, which is the first time anything in this
codebase modifies bytes capture already wrote.

No new runtime or dev dependencies.

## Technical Context

**Language/Version**: TypeScript 5.7, `tsc` only, no bundler. Node 22 LTS pinned via `.nvmrc`
(v22.22.1). The system `node` on PATH is 18.19.1 and EOL — `nvm use` before working here.

**Primary Dependencies**: None added. Existing `electron` runtime; `typescript`, `@types/node`,
`electron-builder`, `@playwright/test` as dev. Parsing, slugging, atomic replace, and the journal are all
`node:fs/promises` and string work — every candidate library would be more code to audit than to write.

**Storage**: Plain-text markdown in the vault beside `inbox.md`. `vaultRoot` is derived from the directory
containing Feature 1's existing `inboxPath` (R8a), so relocating the inbox moves the whole vault with it
rather than splitting it in two; an explicit `vaultRoot` overrides. Holds `projects/<slug>.md`,
`areas/<slug>.md`, `waiting.md`, `calendar.md`, `trash.md`. One JSON-lines journal at the platform
**state** dir — app recovery bookkeeping, deliberately not in the user's vault.

**Testing**: `node:test` + `node:assert` for core with fake ports; real-filesystem contract tests for the
adapters in `packages/desktop/tests`; Playwright `_electron` for the sort flow E2E. Crash recovery is
tested by invoking the journal replay directly, not by killing processes.

**Target Platform**: macOS 14+ Apple Silicon and Linux x64. Dev on Linux x64; macOS artifacts built only
by GitHub Actions per the ROADMAP build-machine rule.

**Project Type**: Desktop app (Electron thin client) over a shared core library.

**Performance Goals**: Next item presented within **100 ms** of a decision being committed (SC-002a),
matching capture's budget so the sort loop keeps the same rhythm. Parsing a 1,000-item inbox in **<50 ms**.
The clarify pass deferred these to planning; they are now recorded as spec success criteria so they are
traceable from the requirement side. As with Feature 1's latency budget, CI timings are a regression
signal and the authoritative measurement is on real hardware.

**Constraints**: Fully offline (Principle III). A decision must be durable before the next item appears —
sort awaits the disk where capture deliberately does not. Unsorted bytes never altered (FR-023, FR-027d).
No new dependencies.

**Scale/Scope**: Single local user, one vault. Realistically tens to low hundreds of inbox items; the
parser reads the whole file into memory, which stays comfortable well past any plausible inbox.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this design satisfies it |
|---|---|---|---|
| I | Test-First (NON-NEGOTIABLE) | **PASS** | Core suite runs in <1s with fake ports, so red-green-refactor stays real. Parser, slug, section-insertion, and journal replay are all pure functions over strings — the highest-risk logic is the easiest to test first. Every task pairs a failing test written before implementation. |
| II | Library-First | **PASS** | `SortService` holds every rule. The core imports nothing from Electron. Ports expose raw file primitives only — `read`, `write`, `removeRange` — so an adapter has no way to express "route to a project" and the client has no way to invent one. |
| III | Local-First & Offline | **PASS** | No network on any code path. Nothing in sort has an external dependency to lose. |
| IV | Durable Plain-Text Data | **PASS** | Five markdown destinations, all hand-editable, all valid with no app running. Formats specified as user-facing contracts. The journal is JSON-lines and holds no user content that is not already in a vault file. |
| V | Core Enforces Process | **PASS** | Inbox zero — the state Feature 5's review gates on — is computed by the core from the file, not tracked by a client (FR-028). One-at-a-time ordering, decision-before-advance, non-empty title and owner, and no-suggestions are all core rules; a client that skipped them would simply get errors back. |
| VI | Instant, Non-Blocking Capture | **PASS** (scoped) | This principle governs *the capture surface*, which this feature does not touch. Sort inverts the trade deliberately: it awaits the disk so a decision is durable before the next item appears (FR-019, FR-024). Capture optimizes for never hesitating; sort optimizes for never losing a decision. Both are honored where they apply. |
| VII | One Consistent Interaction Model | **PASS** | `sort` is defined once, as one verb with one decision type. Feature 6 exposes it over HTTP and Feature 7 calls it with a human-confirmed choice; neither gets a second path to a destination. Vocabulary — project, area, waiting-for, trash, calendar — comes straight from the ROADMAP. |

**Post-Phase 1 re-check**: All seven still PASS. The design added no client-side domain logic, no network
dependency, and no non-plain-text user data. **No violations — Complexity Tracking omitted as unused.**

Three deliberate trade-offs, none a principle violation, all documented in [research.md](research.md):

- **The journal is real added machinery** (R2) for a failure window measured in milliseconds. Accepted
  because the alternative is choosing permanently between a duplicated item and a lost one, and the spec's
  own SC-005 asks for zero losses across forced-quit tests.
- **Sort rewrites `inbox.md`** (R3), which retires a guarantee Feature 1's contract states plainly. Called
  out below rather than quietly reinterpreted.
- **Atomic replace changes the file's inode** (R4), so an editor holding `inbox.md` open may save over a
  sort that happened underneath it. Mitigated by verification, not eliminated. The same mechanism would
  have silently destroyed **captures** made during a sort; that one is eliminated rather than mitigated,
  by a shared in-process write mutex (R4a).

### A Feature 1 guarantee changes here

[contracts/core-api.md](../001-quick-capture/contracts/core-api.md) guarantee #4 reads "Existing inbox
bytes are never rewritten or reformatted," and [inbox-format.md](../001-quick-capture/contracts/inbox-format.md)
says "Appends only; existing bytes never rewritten."

Sort cannot honor that literally — removing the third of ten items means rewriting the file. The guarantee
was written when capture was the only writer, and it was really two promises: *capture* never rewrites, and
*nothing reformats what the user typed*. The first is now scoped to capture; the second holds absolutely and
is tested (FR-023, FR-027d, SC-003a). Feature 1's contract docs need a one-line amendment saying so, which is
a task in this feature, not a silent reinterpretation.

## Project Structure

### Documentation (this feature)

```text
specs/002-inbox-view-sort/
├── plan.md                  # This file
├── spec.md                  # Feature specification
├── research.md              # Phase 0 output
├── data-model.md            # Phase 1 output
├── quickstart.md            # Phase 1 output
├── contracts/               # Phase 1 output
│   ├── sort-api.md          # @waypoint/core sort surface + new ports
│   ├── inbox-parse.md       # Reading inbox.md back into items (user-facing)
│   ├── vault-format.md      # projects/areas/waiting/calendar/trash on disk (user-facing)
│   └── ipc-sort.md          # renderer ↔ main channels for the sort view
├── checklists/
│   └── requirements.md      # Spec quality checklist
└── tasks.md                 # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/                                  # @waypoint/core — zero Electron imports
│   ├── src/
│   │   ├── capture/                       # unchanged (Feature 1)
│   │   ├── inbox/
│   │   │   ├── serialize.ts               # existing; formatTimestamp reused by sort
│   │   │   ├── append-queue.ts            # unchanged
│   │   │   └── parse.ts                   # NEW — inbox.md → ParsedItem[] with byte ranges
│   │   ├── sort/
│   │   │   ├── sort-service.ts            # NEW — the sort verb; next/destinations/sort/recover
│   │   │   ├── decision.ts                # NEW — SortDecision union + validation
│   │   │   ├── commit.ts                  # NEW — journal → destination → inbox removal sequence
│   │   │   └── journal.ts                 # NEW — entry shape, replay logic (pure)
│   │   ├── vault/
│   │   │   ├── slug.ts                    # NEW — title → filename slug, case/space-insensitive match
│   │   │   ├── stub.ts                    # NEW — minimal project/area file (title + status)
│   │   │   ├── unprocessed.ts             # NEW — insert under ## Unprocessed, touch nothing else
│   │   │   └── lists.ts                   # NEW — waiting.md / calendar.md / trash.md line format
│   │   ├── ports/index.ts                 # EXTENDED — InboxDocument, VaultStore, SortJournal
│   │   ├── errors.ts                      # EXTENDED — sort refusal types
│   │   └── index.ts                       # EXTENDED — export the sort surface
│   └── tests/                             # node:test, fake ports, no fs
│
└── desktop/                               # Electron thin client
    ├── src/
    │   ├── main/
    │   │   ├── inbox-mutex.ts             # NEW — one write lock shared by both inbox adapters (R4a)
    │   │   ├── adapters/
    │   │   │   ├── fs-inbox-store.ts      # MODIFIED — acquires the shared mutex around its append
    │   │   │   ├── fs-inbox-document.ts   # NEW — read + verified removeRange via temp+rename
    │   │   │   ├── fs-vault-store.ts      # NEW — read/write/list/exists over the vault
    │   │   │   └── fs-sort-journal.ts     # NEW — JSON-lines append/clear/pending
    │   │   ├── sort-window.ts             # NEW — the sort view window
    │   │   ├── ipc.ts                     # EXTENDED — sort channels, pass-through only
    │   │   ├── config.ts                  # EXTENDED — vault paths
    │   │   └── main.ts                    # EXTENDED — run journal recovery on startup
    │   ├── preload/preload.ts             # EXTENDED — expose sort channels
    │   └── renderer/
    │       ├── sort.html                  # NEW — one item, five choices
    │       └── sort.ts                    # NEW — input and rendering only
    └── tests/                             # real-fs adapter tests + Playwright E2E
```

**Structure Decision**: Same two-package workspace, extended rather than reshaped. Sort gets its own
`src/sort/` and `src/vault/` directories in core rather than being folded into `capture/`, because the two
have opposite durability contracts — capture returns before the disk, sort returns after it — and mixing
them would make it easy to reach for the wrong one. `inbox/parse.ts` sits beside `inbox/serialize.ts`
deliberately: they are inverse operations on the same user-facing format and must be changed together.

## Implementation Sequencing

Ordered so each slice is independently testable and delivers the priority above it (P1/P2/P3 from the spec).
Detailed tasks come from `/speckit-tasks`.

| Slice | Delivers | Gate |
|---|---|---|
| 0. Parser | `inbox/parse.ts` — items with byte ranges, hand-written lines, continuations | Round-trips every fixture; parse(serialize(x)) === x |
| 1. Vault primitives | slug, stub, `## Unprocessed` insertion, list-line formats | Pure-function tests; byte-preservation assertions |
| 2. Ports + fakes | `InboxDocument`, `VaultStore`, `SortJournal` + in-memory fakes | Core testable end-to-end with zero filesystem |
| 3. Commit sequence (P1) | `commit.ts` + journal replay; the five destinations | Replay tests for a crash at each of the four steps |
| 4. `SortService` (P1) | `next`, `count`, `isEmpty`, `destinations`, `sort`, `recover` | Full P1 story against fakes |
| 5. FS adapters | shared write mutex, temp+rename replace, vault IO, journal file | Real-filesystem contract tests, incl. hand-edit races **and capture-during-sort** |
| 6. Electron sort view (P1) | window, IPC, renderer, empty state | Quickstart §1–4; P1 demoable |
| 7. Create-on-the-spot (P2) | stub creation folded into the decision | Quickstart §5; duplicate-title and empty-title paths |
| 8. Resume & inbox zero (P3) | recovery on startup, zero state exposed for Feature 5 | Quickstart §6–8; kill-and-resume |
| 9. Contract amendment | Feature 1 guarantee #4 scoped to capture | Both contract docs updated |

Slice 3 before slice 4 is deliberate: the commit sequence is where correctness actually lives, and it is
fully testable before any service wraps it.

## Explicitly Out of Scope

Project outcomes, milestones, next action, DRI, and status semantics (Feature 3 — this feature writes
`status: active` into a stub and never reads it back). WIP limits (Feature 4). The weekly review ritual
that consumes inbox zero (Feature 5). The local HTTP API (Feature 6). Any AI-assisted splitting or
destination suggestion (Feature 7) — `SortService` is designed as the verb that layer will call, but
nothing in this feature suggests, ranks, or pre-selects anything (FR-030).

Undo of a completed sort decision is out of scope (FR-032). Soft-delete to `trash.md` is what makes that
acceptable.

## Constitution Amendment Note — 2026-08-13

**Principle V** changed from *The Core Enforces Process* to *Enforced Process, Separable Policy*
(constitution 1.0.0 → 2.0.0). Process rules are still enforced by the system and still unbypassable
by any client, but they are no longer core domain logic: core declares named decision points and
consults a registered policy module, which returns `allow` / `warn` / `block` plus a reason.

**Did the implementation need to change? No.** This feature contains no policy. Its refusals —
`item-changed` (optimistic concurrency), `destination-missing` (referential integrity), and
`empty-title` / `empty-owner` (validation) — are all domain invariants. Inbox zero, which this
feature computes from the file for Feature 5 to consume, is a *derived fact* about the inbox's
contents, not a rule about it; deriving it in core stays correct under 2.0.0. The rule that will
gate on that fact belongs to Feature 5 and will live in the policy module.

The Constitution Check row for V above, and the FR-028 reference in
`checklists/requirements.md`, are retained as the record of what was assessed at the time. Both
verdicts still stand under the amended principle; only the phrase "core enforces" now reads as
"core consults" for anything rule-shaped.
