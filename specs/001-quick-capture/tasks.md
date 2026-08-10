---

description: "Task list for Quick Capture (Text & Voice)"
---

# Tasks: Quick Capture (Text & Voice)

**Input**: Design documents from `/specs/001-quick-capture/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Test tasks are **MANDATORY** here, not optional. Constitution Principle I makes
test-first non-negotiable: every test task must be written and **observed to fail** before the
implementation task that follows it. Skipping the failing-test step is a constitution violation.

Every implementation task below either has a paired failing-test task earlier in its phase, or
names the test that covers it. There are no unverified implementation tasks.

**Organization**: Tasks are grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task

## Path Conventions

npm workspaces monorepo per [plan.md](plan.md): `packages/core/` (all domain logic, zero Electron
imports) and `packages/desktop/` (Electron thin client + adapters).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and toolchain

- [X] T001 Pin the Node version with a `.nvmrc` containing `22` (already installed via nvm as v22.22.1; the system `node` on PATH is 18.19.1, which is EOL). No install needed — `nvm use` in the project directory. Note in `README.md` that the toolchain is nvm-managed.
- [X] T002 Initialize npm workspaces root `package.json` declaring `packages/core` and `packages/desktop`
- [X] T003 [P] Configure TypeScript: base `tsconfig.json` plus per-package configs, `tsc`-only build with no bundler
- [X] T004 [P] Create `.gitignore` excluding `resources/`, `dist/`, `node_modules/` — the whisper binary and ~500MB model must never enter git history
- [X] T005 [P] Add npm scripts in root `package.json`: `test` (node:test for core), `test:e2e` (Playwright), `test:whisper` (opt-in), `dev`
- [X] T006 [P] Write `scripts/fetch-whisper.sh` — build whisper.cpp from a pinned tag and download `ggml-small.en.bin` with a pinned SHA-256 checksum into `resources/whisper/`
- [X] T007 [P] Create `.github/workflows/ci.yml` on `ubuntu-latest` running **both** `npm test` and `npm run test:e2e` under `xvfb-run` (Playwright Electron needs a display). The SC-001 latency assertion runs here as a regression signal; the authoritative measurement stays T070/T071 on real hardware.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Type contracts and test harness every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Define port interfaces `InboxStore`, `TranscriptionPort`, `Clock` in `packages/core/src/ports/index.ts` per [contracts/core-api.md](contracts/core-api.md) (types only — no behavior, so no test precedes this)
- [X] T009 [P] Define `EmptyCaptureError`, `TranscriptionFailedError`, `InboxWriteError` in `packages/core/src/errors.ts`
- [X] T010 [P] Create the core public entry point `packages/core/src/index.ts` exporting only the documented surface
- [X] T011 Create test fakes `FakeInboxStore`, `FakeTranscriptionPort`, `FixedClock` in `packages/core/tests/fakes.ts` — these are what make domain rules testable without Electron, a filesystem, or the model
- [X] T012 [P] Write failing tests for config loading (defaults when absent, override when present, defaults + report when malformed) in `packages/desktop/tests/config.test.ts`
- [X] T013 Implement config loader (`inboxPath`, `hotkey`, `whisperModelPath`) in `packages/desktop/src/main/config.ts` — a bad config must never block startup

**Checkpoint**: Contracts and harness ready — user story work can begin

---

## Phase 3: User Story 1 - Instant Text Capture (Priority: P1) 🎯 MVP

**Goal**: Global hotkey (or the in-app entry point) summons a pre-warmed capture box in under 100ms; typed thought is appended, raw and timestamped, to the plain-text inbox; box clears and closes.

**Independent Test**: From another application, press the hotkey, type a thought, press Enter — the box vanishes and the thought appears in `~/waypoint/inbox.md` in the documented format. No voice code involved.

### Core Tests for User Story 1 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTING

- [X] T014 [P] [US1] Failing tests for `CaptureItem`: text trimmed, empty/whitespace rejected with `EmptyCaptureError`, `capturedAt` assigned by core and not accepted from callers, no tag/project fields exist — in `packages/core/tests/capture-item.test.ts`
- [X] T015 [P] [US1] Failing tests for inbox serialization: ISO 8601 with local UTC offset, single space after timestamp, two-space continuation indent for multi-line text, text preserved verbatim, trailing newline — in `packages/core/tests/serialize.test.ts`
- [X] T016 [P] [US1] Failing tests for the append queue: submit order equals write order, enqueue resolves before the underlying write completes, `flush()` drains all pending — in `packages/core/tests/append-queue.test.ts`
- [X] T017 [P] [US1] Failing tests for append **failure handling**: a failing store is retried exactly once, then raises `InboxWriteError` whose payload carries the raw text; the queue keeps processing later items and never silently drops one — in `packages/core/tests/append-queue-failure.test.ts`
- [X] T018 [P] [US1] Failing tests for `CaptureService.submit`: returns `{id, capturedAt}` **without awaiting the write**, rejects empty input before any write is enqueued, one live undo window at a time — in `packages/core/tests/capture-service.submit.test.ts`
- [X] T019 [P] [US1] Failing contract tests for `FsInboxStore.append` against a real temp directory: creates file and parent dirs when absent, appends with `O_APPEND`, inserts a newline first when the existing file lacks a trailing one, leaves all pre-existing hand-written content byte-identical — in `packages/desktop/tests/fs-inbox-store.test.ts`

### Core Implementation for User Story 1

- [X] T020 [P] [US1] Implement `CaptureItem` entity and validation in `packages/core/src/capture/capture-item.ts` (satisfies T014)
- [X] T021 [P] [US1] Implement the markdown serializer in `packages/core/src/inbox/serialize.ts` per [contracts/inbox-format.md](contracts/inbox-format.md) (satisfies T015)
- [X] T022 [US1] Implement the serialized non-blocking append queue in `packages/core/src/inbox/append-queue.ts` (satisfies T016; depends on T021)
- [X] T023 [US1] Implement append failure handling in `packages/core/src/inbox/append-queue.ts`: retry once, then raise `InboxWriteError` carrying the raw text so a failed thought stays recoverable — never silently dropped (satisfies T017)
- [X] T024 [US1] Implement `CaptureService.submit` and `flush` in `packages/core/src/capture/capture-service.ts` (satisfies T018; depends on T020, T022) — must return on enqueue, never on `fsync`
- [X] T025 [US1] Implement `FsInboxStore.append` in `packages/desktop/src/main/adapters/fs-inbox-store.ts` (satisfies T019); leave `size`/`readTail`/`truncate` unimplemented until US3 so US1 ships standalone

### Client Tests for User Story 1 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTING

- [X] T026 [P] [US1] Failing E2E: hotkey shows the pre-warmed box with input already focused, measured under 100ms — in `packages/desktop/tests/e2e/capture-window.spec.ts`
- [X] T027 [P] [US1] Failing E2E: pressing the hotkey while the box is open with unsaved text is ignored, leaving the box and its text untouched (FR-003a) — in `packages/desktop/tests/e2e/duplicate-trigger.spec.ts`
- [X] T028 [P] [US1] Failing E2E: submit clears and closes the box and appends to the inbox; empty submit creates no item — in `packages/desktop/tests/e2e/submit.spec.ts`
- [X] T029 [P] [US1] Failing E2E: the **in-app entry point** opens the capture box without the hotkey (FR-002) — in `packages/desktop/tests/e2e/in-app-trigger.spec.ts`
- [X] T030 [P] [US1] Failing unit test: when `globalShortcut.register()` returns false, a `capture:notice` is emitted naming the conflict and how to rebind — in `packages/desktop/tests/hotkey.test.ts`

### Client Implementation for User Story 1

- [X] T031 [US1] Implement the pre-warmed hidden capture window in `packages/desktop/src/main/capture-window.ts`: created once at startup with `show: false`, `backgroundThrottling: false`, visible on all workspaces and over fullscreen (satisfies T026)
- [X] T032 [US1] Implement duplicate-trigger suppression in `packages/desktop/src/main/capture-window.ts`: `showCapture()` is a no-op when the window is already visible, so in-progress text is never cleared (satisfies T027, FR-003a)
- [X] T033 [US1] Implement global hotkey registration in `packages/desktop/src/main/hotkey.ts`, emitting a visible actionable notice when `register()` returns false because the combination is taken (satisfies T030)
- [X] T034 [US1] Implement the in-app entry point in `packages/desktop/src/main/tray.ts`: a tray/menu-bar icon whose click and "Capture" menu item call `showCapture()`, plus `app.on('activate')` and `second-instance` handlers. **This is the only way in when hotkey registration fails (research.md R3), so it must not depend on the hotkey path** (satisfies T029, FR-002)
- [X] T035 [US1] Implement the preload bridge exposing exactly `window.waypoint` in `packages/desktop/src/preload/preload.ts` (`contextIsolation: true`, `nodeIntegration: false`)
- [X] T036 [US1] Implement IPC handlers `capture:submit`, `capture:dismiss`, `capture:reset`, `capture:notice` in `packages/desktop/src/main/ipc.ts` as thin pass-throughs per [contracts/ipc.md](contracts/ipc.md) — add no channel that lets the renderer set a timestamp or write the inbox (satisfies T028)
- [X] T037 [US1] Implement the capture box UI in `packages/desktop/src/renderer/index.html` and `packages/desktop/src/renderer/capture.ts` — hides on send **without awaiting** the submit promise, clears/refocuses on `capture:reset`, and renders `capture:notice` non-modally (satisfies T028)
- [X] T038 [US1] Wire app lifecycle in `packages/desktop/src/main/main.ts`: background agent (`app.dock.hide()` on macOS, with the tray icon from T034 as the visible affordance), window pre-warm at startup, `CaptureService.flush()` on `before-quit`
- [X] T039 [US1] Add hotkey→focus latency instrumentation behind `WAYPOINT_TRACE_LATENCY` in `packages/desktop/src/main/capture-window.ts` (supports T026, T070)

**Checkpoint**: Text capture fully works end-to-end via both entry points. Quickstart scenarios 1–4, 9, 10, 11 pass. This is a shippable MVP.

---

## Phase 4: User Story 2 - Offline Voice Capture (Priority: P2)

**Goal**: Dictate a thought; whisper.cpp transcribes it fully offline as a subprocess with audio never touching disk; transcript lands in the capture box at the cursor, ready to submit.

**Independent Test**: With the network physically disconnected, open the box, dictate a sentence, and confirm the transcribed text appears in the box (inserted at the cursor, preserving anything already typed) and submits identically to typed text — plus `find` proves no `.wav` was written anywhere.

- [X] T040 [US2] **SPIKE GATE**: verify whisper.cpp `-f -` stdin support on the pinned tag, and confirm the binary name (`whisper-cli` vs legacy `main`). Record the result in [research.md](research.md) R1. **If stdin is unsupported, adopt the documented memory-backed fallback — do not fall back to a regular temp file, which would violate FR-006a.** Blocks T042 and T048.

### Tests for User Story 2 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTING

- [X] T041 [P] [US2] Create the fake `whisper-cli` fixture that echoes canned output for given stdin, in `packages/desktop/tests/fixtures/fake-whisper-cli.sh`
- [X] T042 [P] [US2] Failing contract tests for `WhisperAdapter` against the fake binary: argv construction, WAV piped to stdin, stdout parsed as transcript, non-zero exit raises `TranscriptionFailedError`, empty stdout returns `''`, timeout kills the child, missing binary/model fails without taking text capture down — in `packages/desktop/tests/whisper-adapter.test.ts`
- [X] T043 [P] [US2] Failing tests for `CaptureService.transcribe`: maps to `ok`/`no-speech`/`failed`, whitespace-only output becomes `no-speech` rather than an error, and **no code path writes a transcript to the inbox** — in `packages/core/tests/capture-service.transcribe.test.ts`
- [X] T044 [P] [US2] Failing tests for audio encoding: arbitrary-rate float input downsampled to 16kHz mono, valid 44-byte WAV header, correct 16-bit PCM payload — in `packages/desktop/tests/audio.test.ts`
- [X] T045 [P] [US2] Failing E2E: a completed transcript is **inserted at the cursor** in the capture box and never replaces text the user already typed, and is never auto-submitted — in `packages/desktop/tests/e2e/transcript-insert.spec.ts`
- [X] T046 [P] [US2] Failing E2E: a no-speech result leaves the box open with empty input, ready to retry or type, and writes nothing to the inbox (FR-017a) — in `packages/desktop/tests/e2e/no-speech.spec.ts`

### Implementation for User Story 2

- [X] T047 [P] [US2] Implement `getUserMedia` capture, 16kHz mono downsample, and dependency-free WAV encoding in `packages/desktop/src/renderer/audio.ts` (satisfies T044)
- [X] T048 [US2] Implement the whisper subprocess adapter in `packages/desktop/src/main/adapters/whisper-adapter.ts` per [contracts/whisper-cli.md](contracts/whisper-cli.md) (satisfies T042; depends on T040)
- [X] T049 [US2] Implement `CaptureService.transcribe` in `packages/core/src/capture/capture-service.ts` (satisfies T043)
- [X] T050 [US2] Add the `capture:transcribe` IPC channel in `packages/desktop/src/main/ipc.ts` and expose it in `packages/desktop/src/preload/preload.ts`
- [X] T051 [US2] Implement the dictate control and recording state (press to start, press to stop) in `packages/desktop/src/renderer/capture.ts`
- [X] T052 [US2] Implement transcript insertion at the cursor in `packages/desktop/src/renderer/capture.ts` — preserves existing typed text, never auto-submits, so the user always sees the transcript before it can become an item (satisfies T045, FR-007)
- [X] T053 [US2] Implement the no-speech branch in `packages/desktop/src/renderer/capture.ts`: box stays open with empty input and a non-blocking notice; nothing is saved (satisfies T046, FR-017a)
- [X] T054 [US2] Enforce audio hygiene in `packages/desktop/src/main/adapters/whisper-adapter.ts` and `renderer/audio.ts`: release buffers on return, kill the child on cancel and on app quit, hold no reference after transcription (satisfies T042 timeout/kill cases; verified by quickstart scenario 5)
- [X] T055 [US2] Handle microphone permission and loss: `NSMicrophoneUsageDescription` in the packaged `Info.plist`, lazy prompt on first dictation, non-blocking notice when the mic becomes unavailable mid-recording (verified by quickstart scenario 5)

**Checkpoint**: Voice capture works fully offline, transcript visible in the box before saving. Quickstart scenario 5 passes, including the no-`.wav` check.

---

## Phase 5: User Story 3 - Review and Correct a Transcription (Priority: P3)

**Goal**: A dictated capture can be edited before submitting and undone just after — with undo refusing rather than deleting when the file has changed underneath it, and the whole correction path never blocking the next capture.

**Independent Test**: Dictate, edit a word before submitting, and confirm the edited text (not the original) reaches the inbox; then dictate, submit, hand-edit the file, and confirm undo refuses while preserving the hand edit.

**Note on scope**: undo is offered for **dictated captures only**, per FR-009 and the FR-018 boundary. Core undo logic is unit-testable with fakes (T056–T058) without US2; the end-to-end scenarios (T059, T060) require US2.

### Tests for User Story 3 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTING

- [X] T056 [P] [US3] Failing tests for `UndoToken`: tail matches → truncates to `offsetBefore`; tail differs → refuses and modifies nothing; only one token live at a time — in `packages/core/tests/undo-token.test.ts`
- [X] T057 [P] [US3] Failing tests for `CaptureService.undo` returning `expired`, `file-changed`, and `unknown-id` as **values rather than throws**, since refusal is an expected outcome; and that no token is issued for a typed capture — in `packages/core/tests/capture-service.undo.test.ts`
- [X] T058 [P] [US3] Failing contract tests for `FsInboxStore.size`, `readTail`, and `truncate` against a real temp directory: byte-accurate tail reads across multi-byte UTF-8, truncation restores the exact prior file bytes, and a concurrent hand-edit is detected rather than clobbered — in `packages/desktop/tests/fs-inbox-store-undo.test.ts`
- [X] T059 [P] [US3] Failing E2E: undo removes the item and leaves the file otherwise byte-identical; after a hand-edit, undo refuses and the hand-added line survives — in `packages/desktop/tests/e2e/undo.spec.ts`
- [X] T060 [P] [US3] Failing E2E: after dictating and submitting, the user can immediately trigger the next capture with no wait, block, or forced acknowledgement (FR-010, SC-005) — in `packages/desktop/tests/e2e/non-blocking-correction.spec.ts`

### Implementation for User Story 3

- [X] T061 [P] [US3] Implement `UndoToken` verified-truncation logic in `packages/core/src/capture/undo-token.ts` (satisfies T056)
- [X] T062 [US3] Implement `CaptureService.undo` and undo-window expiry (box close or next capture) in `packages/core/src/capture/capture-service.ts` (satisfies T057; depends on T061)
- [X] T063 [US3] Implement `size`, `readTail`, and `truncate` in `packages/desktop/src/main/adapters/fs-inbox-store.ts` — the methods deferred in T025 (satisfies T058)
- [X] T064 [US3] Add the `capture:undo` IPC channel in `packages/desktop/src/main/ipc.ts` and the undo affordance in `packages/desktop/src/renderer/capture.ts`, offered for dictated captures only and never blocking the next capture (satisfies T059, T060)
- [X] T065 [US3] Implement the refusal notice in `packages/desktop/src/renderer/capture.ts`: on `file-changed`, show the reason **together with the captured text** so the thought remains recoverable by copy/paste (satisfies T059)

**Checkpoint**: All three user stories independently functional. Quickstart scenarios 6, 7, 8, 12 pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T066 [P] Configure `electron-builder` in `packages/desktop/electron-builder.yml` with `extraResources` for the whisper binary and model, targeting macOS arm64 (DMG) and Linux x64 (AppImage)
- [X] T067 [P] Create `.github/workflows/release.yml` building on `macos-14` (arm64, Metal) and `ubuntu-latest` (x64, CPU) on tag, with cached pinned whisper build and checksum-verified model, publishing release artifacts
- [X] T068 [P] Write `README.md` covering setup, the nvm-managed Node 22 requirement, `fetch-whisper.sh`, and the ROADMAP build-machine rule (work MacBook downloads artifacts only, never compiles)
- [X] T069 [P] Audit that all notices are non-modal and never block the input field, across `packages/desktop/src/renderer/capture.ts`
- [~] T070 Run the full [quickstart.md](quickstart.md) validation, scenarios 1–12, on the Linux dev machine — **partially done**: scenarios 1, 3, 4, 6, 7, 8, 9, 11, 12 are covered by the automated E2E suite and pass. Scenarios 2 (hand-timed latency), 5 (real microphone, network off), and 10 (visual check for organizing prompts) need a human at the desktop.
- [ ] T071 **BLOCKED — needs a Mac and a CI run.** Download the CI-built macOS artifact on the MacBook and re-run quickstart scenarios 1, 5, 9, and 11 **with the network off** to prove the bundled model needs no download (Principle III)
- [X] T072 Verify constitution compliance: core has zero Electron imports, no domain logic in `renderer/`, no network calls on any path, inbox readable with no app running

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **US1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **US2 (Phase 4)**: Depends on Foundational. Gated internally by the T040 spike.
- **US3 (Phase 5)**: Depends on Foundational for its core logic (T056–T058, T061–T063), and on US2 for its end-to-end scenarios (T059, T060), since undo is scoped to dictated captures.
- **Polish (Phase 6)**: Depends on all desired stories

### Mapping to plan.md sequencing slices

| plan.md slice | Tasks |
|---|---|
| 0. Setup | T001–T013 |
| 1. Core capture | T014–T018, T020–T024 |
| 2. FS adapter | T019, T025 |
| 3. Electron text capture | T026–T039 |
| 4. Whisper spike | T040 |
| 5. Voice capture | T041–T055 |
| 6. Review & undo | T056–T065 |
| 7. Packaging | T066–T072 |

### Critical Path

`T001 → T002 → T008/T011 → T018 → T024 → T025 → T036 → T037` (working MVP)

### Notable Task-Level Dependencies

- T022 depends on T021 (queue serializes what the serializer produces); T023 extends T022
- T024 depends on T020 + T022
- T032 and T031 share `capture-window.ts` — sequential, not parallel
- T034 must not depend on the hotkey path; it is the sole entry point when T033 fails to register
- T040 (spike) **blocks** T042 and T048 — if stdin support is disproved, the audio path changes shape
- T052, T053 share `capture.ts` with T051 — sequential
- T062 depends on T061; T063 completes methods stubbed in T025
- T064, T065 share `capture.ts` — sequential
- Every implementation task depends on its paired test task **failing first**

### Parallel Opportunities

- Setup: T003–T007 all parallel
- Foundational: T009, T010, T012 parallel
- US1 core tests: T014–T019 parallel (distinct files); client tests T026–T030 parallel
- US1 impl: T020 and T021 parallel; T022–T025 sequential; T031–T039 mostly sequential (shared files)
- US2 tests: T041–T046 parallel
- US3 tests: T056–T060 parallel
- Polish: T066–T069 parallel

---

## Parallel Example: User Story 1

```bash
# Write all US1 core tests together, confirm every one FAILS before writing implementation:
Task: "Failing tests for CaptureItem in packages/core/tests/capture-item.test.ts"
Task: "Failing tests for serialization in packages/core/tests/serialize.test.ts"
Task: "Failing tests for append queue in packages/core/tests/append-queue.test.ts"
Task: "Failing tests for append failure handling in packages/core/tests/append-queue-failure.test.ts"
Task: "Failing tests for CaptureService.submit in packages/core/tests/capture-service.submit.test.ts"
Task: "Failing contract tests for FsInboxStore.append in packages/desktop/tests/fs-inbox-store.test.ts"

# Then the two independent entities in parallel:
Task: "Implement CaptureItem in packages/core/src/capture/capture-item.ts"
Task: "Implement serializer in packages/core/src/inbox/serialize.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1
2. **STOP and VALIDATE**: quickstart scenarios 1–4, 9, 10, 11
3. At this point text capture is genuinely usable daily — voice is additive

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate → **MVP, usable**
3. US2 → validate offline → voice capture works
4. US3 → validate including the refusal case → review/undo complete
5. Polish → packaged, CI-built, validated on the MacBook

### Notes

- **Verify every test fails before implementing it.** This is the one rule the constitution marks non-negotiable; a test that passes on first write proves nothing.
- T040 is a real go/no-go gate, not a formality — resolve it before building the audio path
- Commit after each task or logical group
- [P] tasks touch different files with no incomplete dependencies
- Out of scope throughout (FR-018): viewing, sorting, tagging, projects, the HTTP API — those are ROADMAP Features 2–6

---

## Phase 7: Convergence

Appended by `/speckit-converge` on 2026-08-09 after the first `/speckit-implement` pass.
Each task traces to the spec, plan, or contract obligation it closes.

- [X] T073 **CRITICAL** — Make user notices survive being emitted while the capture box is hidden, per contracts/core-api.md `InboxWriteError`, research R3, and FR-001 (contradicts). `capture-window.ts` sends `capture:reset` on every show and the renderer's `reset()` calls `clearNotice()`, so a failed write's recoverable text, a hotkey-registration failure, and config problems are all discarded before the user can see them — the contract requires the raw text be shown and never discarded. Queue unacknowledged notices in `packages/desktop/src/main/capture-window.ts`, replay them on show, and stop `reset()` clearing them in `packages/desktop/src/renderer/capture.ts`. Add an E2E test that a write failure surfaces its recoverable text on the next open.
- [X] T074 Resolve `whisperModelPath` to where the model is actually installed, per plan.md bundling and data-model.md Config (partial). `packages/desktop/src/main/config.ts` defaults it under `~/.local/share/waypoint/whisper/`, but `scripts/fetch-whisper.sh` installs to `<repo>/resources/whisper/` and packaged builds use `process.resourcesPath/whisper`, so dictation cannot find the model out of the box. Derive the default the same way `whisperBinaryPath()` does in `packages/desktop/src/main/main.ts`, keeping the config key as an override, and cover it with a config test.
- [X] T075 Add the opt-in whisper integration test and its audio fixture, per contracts/whisper-cli.md and SC-003 (missing). `npm run test:whisper` points at `packages/desktop/dist/tests/whisper-integration.test.js`, which has never existed, so the script fails and no test has exercised the real binary. Write `packages/desktop/tests/whisper-integration.test.ts` with a short WAV fixture, skipped unless `WAYPOINT_WHISPER_INTEGRATION=1` and the model is present.
- [X] T076 Pin the model checksum and make verification fail closed, per research R10 (partial). `scripts/fetch-whisper.sh` defaults `MODEL_SHA256` to empty and only warns, and `.github/workflows/release.yml` passes an unset repository variable, so a release can bundle an unverified model. Pin the SHA-256 in the script and make the release path abort when it is missing.
- [~] T077 **Scenarios 2, 5, and 10 exercised; §5 not yet re-run with the network down.** On 2026-08-10 the user ran `npm run dev`, pressed the real `Ctrl+Shift+Space`, got the box, pressed Dictate, and dictation worked — closing the microphone half of §5 on real hardware. They did **not** report disconnecting the network, so the offline half of §5 is still unconfirmed; it is a one-command re-check (`nmcli networking off`, dictate, `nmcli networking on`) rather than open work. The session also produced the finding that drives Phase 8: no visible difference between recording and transcribing. Earlier, verified by launching the real app (no test seam) and driving the actual X11 global hotkey with xdotool: the box appeared, real keystrokes typed, Enter saved `- 2026-08-10T18:39:59-04:00 captured through the real global hotkey`, and the instrumented trace read **1ms** against the 100ms budget (§2). A screenshot of the running box confirms no categorization, tag, or project prompt (§10). **§5 (dictate into a real microphone with the network off) remains outstanding — this environment has no audio input.** Original text: Run quickstart scenarios 2, 5, and 10 on the Linux dev machine and record the results (partial, completes T070). These are the three that cannot be automated: hand-timed hotkey latency, real-microphone dictation with the network disconnected, and the visual confirmation that no categorization prompt ever appears. Requires `cmake` and a completed `scripts/fetch-whisper.sh` run.
- [ ] T078 Build and validate the macOS artifact, per quickstart "Packaged build validation" (missing, completes T071). Tag a release so `.github/workflows/release.yml` produces the arm64 DMG, then on the MacBook re-run quickstart scenarios 1, 5, 9, and 11 with the network off to prove the bundled model needs no download.
- [X] T079 Add application and tray icons in `packages/desktop/build/`, per plan.md packaging (missing). The directory electron-builder expects does not exist, so the packaged app ships a default Electron icon, and `tray.ts` uses `nativeImage.createEmpty()` which renders as a blank menu-bar item.
- [X] T080 Review the `WAYPOINT_E2E` test seam in `packages/desktop/src/main/main.ts` (unrequested). The env-gated `__waypoint` global exposing `showCapture`, `fakeDictation`, and `undoLatest` is production-code surface that no spec, plan, or contract asked for. Either document it in contracts/ipc.md as an accepted testing seam or replace it with an approach that leaves no hook in shipped code.

---

## Phase 8: Dictation Feedback and Dual Hotkeys

Added 2026-08-10 from live use of the built app. Two findings, one from the user and
one measured while designing the fix:

1. Recording and transcribing are visually identical — a dimmed button is the only
   difference — so a multi-second transcription reads as a hang. Closes FR-005a/FR-005b, SC-008.
2. Voice is the mode reached for most, but it costs a hotkey **and** a click. Closes FR-001a.

Measured while scoping, and recorded here because both constrain the design:
whisper's `--print-progress` reports **185%** on a 16s clip and **1090%** on a 2.8s one
(padded 30s window), so a percentage is impossible; and transcription takes **~3–5s** for
typical captures (263ms model load, the rest encode), which is why the gap is so noticeable.

### Tests for Phase 8 ⚠️ WRITE FIRST — MUST FAIL BEFORE IMPLEMENTING

- [X] T081 [P] Failing tests for `dictateHotkey` in `packages/desktop/tests/config.test.ts`: it defaults to `CommandOrControl+Shift+Space` while `hotkey` defaults to `CommandOrControl+Shift+Enter`, each is independently overridable, and an invalid value falls back without blocking startup
- [X] T082 [P] Failing tests for `registerHotkeys` in `packages/desktop/tests/hotkey.test.ts`: both accelerators register and route to different handlers; **either one failing leaves the other working** and names the failed one in the notice (FR-001a); two identical accelerators are reported rather than silently registering one
- [X] T083 [P] Failing E2E in `packages/desktop/tests/e2e/dictate-hotkey.spec.ts`: the dictate trigger opens the box already recording; firing it while the box is open with typed text starts recording **without clearing the text** (FR-003a)
- [X] T084 [P] Failing E2E in `packages/desktop/tests/e2e/dictation-indicator.spec.ts` using Chromium's fake capture device: the status region reads acquiring → recording → transcribing → idle, the level meter responds to real audio, and the textarea stays focused and editable in every state (FR-005a, FR-005b, SC-008)

### Implementation for Phase 8

- [X] T085 Add `dictateHotkey` to `WaypointConfig` and `defaultConfig` in `packages/desktop/src/main/config.ts`, moving `hotkey` to `CommandOrControl+Shift+Enter` (satisfies T081)
- [X] T086 Add `registerHotkeys` to `packages/desktop/src/main/hotkey.ts`, registering each accelerator independently so one failure cannot take the other down (satisfies T082). The single-binding `registerHotkey` is kept as the primitive and stays covered by its own tests.
- [X] T087 Thread a capture mode through `CaptureWindow.show()`, `capture:reset`, and the preload bridge so the renderer knows to begin dictation on open, leaving existing input untouched when the box is already visible (satisfies T083)
- [X] T088 Add the status region — acquiring / recording with live level meter and elapsed timer / transcribing — to `packages/desktop/src/renderer/index.html` and `capture.ts`, honouring `prefers-reduced-motion` and announcing state changes via `aria-live` (satisfies T084)
- [X] T089 Give each E2E instance its own `--user-data-dir` in `packages/desktop/tests/e2e/harness.ts`. Found while spiking T084: a running `npm run dev` holds Electron's single-instance lock, so the whole suite fails with an unexplained "browser has been closed" whenever the app is open
- [X] T090 Update `README.md` and `quickstart.md` for the two hotkeys and the new default binding

**Checkpoint**: Dictation is reachable in one keystroke and never leaves the user
guessing whether the app is listening, working, or wedged.

**Phase 8 result** (2026-08-10): 160 unit tests and 50 E2E tests pass, up from 149 and 36.
Verified beyond the suite by driving the real X11 `Ctrl+Shift+Space` against the running app and
reading the live DOM: `state=recording, level=0.328, label="Listening"`. Screenshots of both states
confirm they are unmistakable. Two findings worth keeping:

- The first attempt at that manual check appeared to fail — the box opened idle. Cause was not the
  code: a stale `npm run dev` from an earlier session still owned the `Ctrl+Shift+Space` global
  shortcut, so the new instance's registration lost the race and the *old* app's box was what
  appeared. Global accelerators are first-come-first-served per combination, which makes leftover
  instances actively misleading during manual validation. Kill any running instance first.
- Stopping a recording the instant it starts captures zero samples and correctly reports no speech,
  so it never reaches the transcribing state. The indicator tests therefore wait for the level meter
  to register real audio before stopping — which also makes them assert the meter works.
