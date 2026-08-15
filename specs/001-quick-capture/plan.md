# Implementation Plan: Quick Capture (Text & Voice)

**Branch**: `001-quick-capture` | **Date**: 2026-08-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-quick-capture/spec.md`

## Summary

Build the capture surface: a pre-warmed Electron window summoned by a global hotkey that accepts a
typed or dictated thought and appends it, raw and timestamped, to a plain-text markdown inbox
outside the app repo. Dictation runs through a bundled whisper.cpp binary as a subprocess, fully
offline, with audio held in memory and piped over stdin so it never touches disk.

All domain logic lives in `@waypoint/core`; the Electron app is a thin client with no capture rules
of its own. The core returns from `submit()` as soon as the write is enqueued — never awaiting the
disk — which is what lets the box close instantly. Development is test-first throughout.

## Technical Context

**Language/Version**: TypeScript 5.x, compiled with `tsc` only (no bundler). Node 22 LTS, pinned via
`.nvmrc` and selected with nvm (already installed as v22.22.1). Note the system `node` on PATH is
18.19.1 and is EOL — always `nvm use` before working in this repo.

**Primary Dependencies**: `electron` (runtime); `typescript`, `@types/node`, `electron-builder`,
`@playwright/test` (dev). whisper.cpp is a bundled compiled binary, not an npm package. No UI
framework — the capture surface is one text box and one button, and a framework would invite domain
logic into the client.

**Storage**: Plain-text markdown at `~/waypoint/inbox.md` (configurable, outside the app repo,
git-trackable by the user). JSON config at the platform config dir. No database.

**Testing**: `node:test` + `node:assert` for core (zero dependencies, sub-second loop);
Playwright `_electron` for desktop E2E; a fake `whisper-cli` script for adapter contract tests, with
one opt-in test against the real binary.

**Target Platform**: macOS 14+ Apple Silicon (arm64) and Linux x64. Dev on Linux x64;
macOS artifacts built exclusively by GitHub Actions per the ROADMAP build-machine rule.

**Project Type**: Desktop app (Electron thin client) over a shared core library.

**Performance Goals**: Hotkey → capture box focused and ready in **<100 ms** (SC-001). Submit path
returns without awaiting `fsync`. Dictation of a short clip transcribes in a few seconds on M4.

**Constraints**: Fully offline — no network on any code path (Principle III). Audio never written to
disk (FR-006a). Inbox appends must never clobber concurrent hand-edits (FR-016). ~500 MB bundled
model accepted per ROADMAP.

**Scale/Scope**: Single local user, one inbox file. Capture only — no viewing, sorting, projects, or
API (FR-018; those are ROADMAP Features 2–6).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this design satisfies it |
|---|---|---|---|
| I | Test-First (NON-NEGOTIABLE) | **PASS** | `node:test` core suite runs in <1s, making a real red-green-refactor loop practical. Every task in `tasks.md` will pair a failing test written first. Ports are injectable specifically so domain rules are testable without Electron, a filesystem, or the model. |
| II | Library-First | **PASS** | All rules live in `@waypoint/core`, which imports nothing from Electron. The IPC contract deliberately omits any channel that would let the renderer set a timestamp, write the inbox, or store a transcript — the client is structurally incapable of holding domain logic. |
| III | Local-First & Offline | **PASS** | No network on any code path. The whisper model is **bundled**, not downloaded on first run, precisely because voice is core functionality and Principle III forbids it depending on the network. Validated with the network off (quickstart §5). |
| IV | Durable Plain-Text Data | **PASS** | Inbox is markdown, hand-editable, append-only, valid with no app running. Config is JSON. Format is specified as a user-facing contract. |
| V | Core Enforces Process | **PASS** (scoped) | Capture's rituals — raw-only capture, no organizing prompt, core-assigned timestamps, empty-input rejection, transcript-must-be-seen — are enforced in core logic and structurally unreachable from clients. Inbox-zero, WIP limits, and the review sequence belong to Features 2–5 and are correctly absent here. |
| VI | Instant, Non-Blocking Capture | **PASS** | Pre-warmed hidden window makes <100 ms achievable; `submit()` returns on enqueue, not on write; the renderer hides the box without awaiting IPC. Latency is asserted in E2E so it cannot silently regress. |
| VII | One Consistent Interaction Model | **PASS** | `CaptureService` defines the verb `capture` once. Feature 6's HTTP API and Feature 7's agent will call this same service, not reimplement it. The renderer introduces no vocabulary of its own. |

**Post-Phase 1 re-check**: All seven still PASS. The design added no client-side domain logic and no
network dependency. **No violations — Complexity Tracking section omitted as unused.**

Two deliberate, documented trade-offs (neither a principle violation):

- **Durability at submit** (R4): returning before `fsync` means a crash in that window loses the
  item. Principle VI explicitly ranks instant response above blocking on disk here. Mitigated by
  draining the queue on quit, retrying once on failure, and surfacing unrecoverable failures with
  the raw text so a thought is never silently lost.
- **Unsigned macOS artifacts** (R10): notarization deferred; first launch needs a Gatekeeper bypass.
  Flagged as a conscious deferral, not an oversight.

## Project Structure

### Documentation (this feature)

```text
specs/001-quick-capture/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── core-api.md      # @waypoint/core public API + ports
│   ├── inbox-format.md  # On-disk markdown contract (user-facing)
│   ├── ipc.md           # renderer ↔ main channels
│   └── whisper-cli.md   # whisper.cpp subprocess adapter
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/                          # @waypoint/core — all domain logic, zero Electron imports
│   ├── src/
│   │   ├── capture/
│   │   │   ├── capture-service.ts # submit / undo / transcribe / flush
│   │   │   ├── capture-item.ts    # entity + validation
│   │   │   └── undo-token.ts      # verified-truncation undo
│   │   ├── inbox/
│   │   │   ├── serialize.ts       # CaptureItem → markdown block
│   │   │   └── append-queue.ts    # serialized, non-blocking write queue
│   │   ├── ports/                 # InboxStore, TranscriptionPort, Clock (interfaces)
│   │   ├── errors.ts
│   │   └── index.ts               # the only public entry point
│   └── tests/                     # node:test — unit + contract, no Electron, no fs
│
└── desktop/                       # Electron thin client
    ├── src/
    │   ├── main/
    │   │   ├── main.ts            # lifecycle, background agent
    │   │   ├── capture-window.ts  # pre-warmed hidden window + duplicate-trigger suppression (R2)
    │   │   ├── hotkey.ts          # globalShortcut + registration-failure notice
    │   │   ├── tray.ts            # in-app entry point (FR-002); sole way in if the hotkey fails
    │   │   ├── ipc.ts             # thin pass-through to CaptureService
    │   │   ├── config.ts          # JSON config load/defaults
    │   │   └── adapters/
    │   │       ├── fs-inbox-store.ts    # O_APPEND, truncate, tail read
    │   │       └── whisper-adapter.ts   # subprocess, WAV on stdin
    │   ├── preload/preload.ts     # exposes window.waypoint, nothing else
    │   └── renderer/
    │       ├── index.html         # the capture box
    │       ├── capture.ts         # input handling only — no domain logic
    │       └── audio.ts           # getUserMedia → 16 kHz mono PCM → WAV bytes
    └── tests/                     # Playwright _electron + fake whisper-cli script

resources/whisper/                 # binary + ggml-small.en.bin — GITIGNORED, never committed
scripts/fetch-whisper.sh           # pinned local build + checksum-verified model download
.github/workflows/
├── ci.yml                         # tests on every push (ubuntu)
└── release.yml                    # macos-14 arm64 + ubuntu x64 artifacts on tag
```

**Structure Decision**: npm workspaces monorepo with two packages. `packages/core` holds every
domain rule and has no Electron dependency, which is what makes Principle II enforceable rather than
aspirational — and what lets Feature 6's HTTP API consume the identical service later. `packages/desktop`
is the thin client: adapters implement the core's ports, the renderer only handles input and
rendering. npm workspaces are built into npm, so the monorepo adds no dependency.

## Implementation Sequencing

Ordered so each slice is independently testable and delivers the priority above it (per the spec's
P1/P2/P3 user stories). Detailed tasks come from `/speckit-tasks`.

| Slice | Tasks | Delivers | Gate |
|---|---|---|---|
| 0. Setup | T001–T013 | `.nvmrc` pin, workspaces, tsc, test runners, CI | `npm test` runs green on an empty suite |
| 1. Core capture (P1) | T014–T018, T020–T024 | `CaptureItem`, serialization, append queue, `submit` | Core tests pass with a fake `InboxStore` |
| 2. FS adapter | T019, T025 | `O_APPEND` store, hand-edit safety, missing-file creation | Real-filesystem contract tests |
| 3. Electron text capture (P1) | T026–T039 | Pre-warmed window, hotkey, tray entry point, IPC, renderer | Quickstart §1–4, §11; **latency assertion** |
| 4. Whisper spike | T040 | **Verify `-f -` stdin support** on the pinned tag (R1) | Go/no-go before slice 5; fallback if disproved |
| 5. Voice capture (P2) | T041–T055 | Audio→WAV in renderer, whisper adapter, `transcribe`, transcript into box | Fake-binary contract tests; quickstart §5 |
| 6. Review & undo (P3) | T056–T065 | Verified-truncation undo, refusal path | Quickstart §6–8, §12, **including the refusal case** |
| 7. Packaging | T066–T072 | electron-builder, `extraResources`, release workflow | macOS artifact validated offline on the MacBook |

Slice 4 is a genuine gate, not a formality: if stdin piping is unavailable on the pinned version, the
audio path changes shape (R1 fallback) and slice 5's design shifts with it.

**Undo scope**: undo is offered for **dictated captures only** (FR-009, bounded by FR-018). A typed
capture never gets an undo affordance, so slice 6's end-to-end scenarios depend on slice 5 — though
its core logic is unit-testable with fakes before then.

## Explicitly Out of Scope

Inbox viewing, sorting, projects, milestones, WIP limits, the review ritual, and the local HTTP API
are ROADMAP Features 2–6 and are **not** built here (FR-018). The inbox format is designed so
Feature 2 can parse it, but **no parser is written now** — that would be speculative work against a
consumer that does not yet exist.

## Constitution Amendment Note — 2026-08-13

**Principle V** changed from *The Core Enforces Process* to *Enforced Process, Separable Policy*
(constitution 1.0.0 → 2.0.0). Process rules are still enforced by the system and still unbypassable
by any client, but they are no longer core domain logic: core declares named decision points and
consults a registered policy module, which returns `allow` / `warn` / `block` plus a reason.

**Did the implementation need to change? No.** This feature contains no policy. Every refusal it
makes — empty-input rejection, and the `expired` / `unknown-id` / `file-changed` undo outcomes — is a
domain invariant or a concurrency check: a statement about what a capture *is* and what may validly
be done to it, not an opinion about how the user should work. Those correctly remain in core under
2.0.0.

The Constitution Check row for V above is retained as the record of what was assessed at the time,
and its verdict still stands under the amended principle.
