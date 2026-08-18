---
description: "Task list for 008-llm-assisted-inbox-organization"
---

# Tasks: LLM-Assisted Inbox Organization

**Input**: Design documents from `/specs/008-llm-assisted-inbox-organization/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Required, not optional.** Constitution Principle I is non-negotiable — every test below is
written first and observed to fail for the right reason before its implementation exists. A test that passes
vacuously is the failure mode this feature is most exposed to (a payload boundary test that never ran, a
degrade-to-nothing suite that silently skipped), so several tasks say explicitly what the Red must look like.

**Organization**: Grouped by user story. Each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to the spec's user stories
- File paths are exact

## Path Conventions

npm workspaces monorepo. `packages/core/src/`, `packages/core/tests/`, `packages/desktop/src/`,
`packages/desktop/tests/`. Core imports nothing from Electron; transports are desktop adapters.

---

## Phase 1: Setup

**Purpose**: Directories, fakes, and fixtures. No dependencies are added — both transports use platform
capabilities (research R13).

- [X] T001 Create `packages/core/src/suggest/` and `packages/core/src/intelligence/`, and confirm `npm run build:core` and `npm run typecheck` still pass with no new entry in any `package.json`
- [X] T002 [P] Add `packages/core/tests/suggest-fakes.ts` with `RecordingTransport` (records every `send` argument by reference, for identity assertions), `StubSplitProvider`, `StubDestinationProvider`, `FakeDestinationCatalog`, and a `seedIntelligence(files)` helper — following the shape of `packages/core/tests/sort-fakes.ts` and `review-fakes.ts`
- [X] T003 [P] Add `packages/desktop/tests/fixtures/fake-llm-cli.sh` driven by env vars (`FAKE_LLM_OUTPUT`, `FAKE_LLM_EXIT`, `FAKE_LLM_HANG`, `FAKE_LLM_ARGV_OUT`, `FAKE_LLM_STDIN_OUT`), modelled on `fake-whisper-cli.sh` including its `exec sleep` note, and confirm it is copied and chmod'd by the existing `build:fixtures` script in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Both seams, the config, the shared machinery, and the first transport. Everything here is needed
by two or more stories.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### The configuration file

- [X] T004 [P] Write failing test `packages/core/tests/intelligence-config.test.ts`: absent file and a file naming no transport both yield the layer off with **no problem reported**; `transport: command` with `command:` and a `## Arguments` list parses with arguments in order; `transport: certificate` with `endpoint`/`certificate`/`key` parses, `ca` optional; an unrecognised transport yields one problem naming the value read and both values that work; a required parameter missing yields one problem naming the key and the transport; `http://` endpoint is refused; key casing and spacing tolerant per `vault/preamble.ts`
- [X] T005 Implement `packages/core/src/suggest/intelligence-config.ts` — `INTELLIGENCE_PATH`, `parseIntelligenceConfig`, using `readField` and `readListSection` from `packages/core/src/vault/preamble.ts` per [contracts/intelligence-config.md](./contracts/intelligence-config.md)
- [X] T006 [P] Write failing test `packages/core/tests/intelligence-config-no-secrets.test.ts`: the parsed config's field set is exactly the allowed keys, `certificate`/`key`/`ca` are carried as paths, and parsing performs **zero filesystem reads** (counting fake) — credentials are read by the transport at call time, never at parse time (FR-051b, FR-051c)

### Segmentation — the basis of the verbatim guarantee

- [X] T007 [P] Write failing property test `packages/core/tests/segments.test.ts`: for every fixture — single sentence, run-on dictation, multi-line, embedded blank lines, non-ASCII, no terminal punctuation, trailing whitespace — `segments.map(s => text.slice(s.start, s.end)).join("") === text` byte for byte; boundaries fall after `.`/`!`/`?` followed by whitespace and at every newline
- [X] T008 Implement `packages/core/src/intelligence/segments.ts` (research R3)

### The read source that cannot name a file

- [X] T009 [P] Write failing test `packages/core/tests/suggest-catalog.test.ts`: `DestinationCatalog` exposes only `list(dir)` and `read(dir, slug)` with `dir` constrained to `"projects" | "areas"`; the `VaultStore` adapter reads fresh on every call so a destination created in another window appears; no path string is accepted anywhere
- [X] T010 Implement `packages/core/src/suggest/catalog.ts` — the interface and the three-line `VaultStore` adapter (research R6)

### The ports and the shared types

- [X] T011 Declare `SplitProvider`, `DestinationProvider`, `SplitRequest`, `SplitResponse`, `DestinationRequest`, `DestinationResponse`, and `Transport` in `packages/core/src/ports/index.ts` per [contracts/intelligence-ports.md](./contracts/intelligence-ports.md), with the doc comments explaining why `DestinationRequest` has no field for a milestone, DRI, status, or ledger entry
- [X] T012 Add `packages/core/src/suggest/types.ts` — `SuggestionFailure` (seven members), `SplitProposal`, `ProposedPiece`, `DestinationProposal`, `PreparedRequest<T>`, `SplitOutcome`, `DestinationOutcome` per [data-model.md](./data-model.md)

### Payload identity — the guarantee that must exist before anything can send

- [X] T013 [P] Write failing test `packages/core/tests/suggest-payload-identity.test.ts`: with `RecordingTransport`, assert `transport.received[0] === prepared.payload` using `===` (not `deepEqual`) for both `prepareSplit` and `prepareDestination`. **Red must be "there is no single value to compare"** — if this test can be made to pass by comparing two constructions, the design in research R4 has not been followed. Also assert independence: one `prepare` produces exactly one `send`, and a split payload contains no destination catalogue while a destination payload contains no segment numbering, so asking for one kind provably does not send the other's content (FR-003, FR-045)
- [X] T014 Implement `packages/core/src/intelligence/request.ts` — the single construction of the payload text for both request kinds. One function per kind, called once each
- [X] T015 Implement `packages/core/src/suggest/suggestion-service.ts` — `SuggestionServiceDeps { catalog, intelligence?, timeoutMs? }`, `prepareSplit`, `prepareDestination`, returning a `PreparedRequest` whose `run()` takes no argument and closes over the same `payload` binding it exposes

### Write-unreachability, made structural

- [X] T016 [P] Write failing test `packages/core/tests/suggest-no-write-surface.test.ts`: `SuggestionServiceDeps` has no `vault`, `inbox`, `journal`, `sort`, `policy`, or `clock` field; `SuggestionService.prototype` exposes only `prepareSplit` and `prepareDestination`; `DECISION_POINTS` is still five; no method name contains `write`, `commit`, `apply`, or `accept` (FR-035, research R11)

### The one bound, in core

- [X] T017 [P] Write failing test `packages/core/tests/suggest-timeout.test.ts`: the bound is 120 000 ms and is a module constant; the injected `timeoutMs` seam is honoured by tests only; exceeding it aborts the signal and yields `timed-out`; `abandon()` aborts the same controller and also yields `timed-out` with a different message; no `intelligence.md` key can change it
- [X] T018 Implement the `AbortController` and the 120-second bound in `packages/core/src/suggest/suggestion-service.ts` (research R15)

### Absent means off

- [X] T019 [P] Write failing test `packages/core/tests/suggest-not-configured.test.ts`: with no `intelligence` dependency, both prepare verbs return `not-configured`, **carry no message**, and contact no transport
- [X] T020 Implement the absent-provider path in `packages/core/src/suggest/suggestion-service.ts`
- [X] T021 Export the new public surface from `packages/core/src/index.ts` — the three port types, `SuggestionService`, `createDefaultIntelligence`, `parseIntelligenceConfig`, `INTELLIGENCE_PATH`, and the proposal and failure types
- [X] T022 [P] Add `packages/core/tests/suggest-offline.test.ts` asserting `dist/src/suggest` and `dist/src/intelligence` import no networking module — a **new file** mirroring `sort-offline.test.ts` so that file stays unmodified (Principle III)
- [X] T022a [P] Add `packages/core/tests/intelligence-scope-boundaries.test.ts` — the standing tripwire, in the shape of `project-scope-boundaries.test.ts`. Assert: core exports nothing matching `/register|discover|loadTransport|plugin|extension/i`; `createDefaultIntelligence` is the only factory exported for the seam; the transport set is a closed union of exactly two values with no runtime lookup; the `Transport` interface's members mention nothing about projects, areas, inbox items, destinations, or sorting; and no provider method is named for a project, milestone, outcome, next action, DRI, or review. **Red condition**: this test fails the moment a loader, a discovery mechanism, a registration API, or a task-management concept appears in either seam — it is written to fail later, not now, and its first run is expected green (FR-057, FR-058, FR-072, Constitution Principle V)

### The first transport

- [X] T023 [P] Write failing test `packages/desktop/tests/command-transport.test.ts` against `fake-llm-cli.sh`: the request arrives on the child's stdin and the response is read from stdout; arguments are passed in list order; a missing binary raises `unreachable`; a non-zero exit raises `failed` carrying the last stderr line; stderr on a successful run is **not** treated as failure; an aborted signal kills the child and leaves no orphan
- [X] T024 Implement `packages/desktop/src/main/adapters/command-transport.ts` using `node:child_process.spawn`, following `whisper-adapter.ts`'s settle-once, kill-on-abort, and `stdin.end()` handling (research R13)
- [X] T024a [P] Write failing test `packages/core/tests/default-intelligence-shape.test.ts`: `createDefaultIntelligence(transport)` returns one object satisfying **both** provider interfaces; it carries a `name`; it accepts a `Transport` and nothing else — no vault, no catalog, no policy, no clock; and calling either `propose` before its response path exists throws rather than returning a proposal
- [X] T025 Implement `packages/core/src/intelligence/default-intelligence.ts` — `createDefaultIntelligence(transport)` returning the **skeleton only**: both provider methods present, both throwing. Neither path can be implemented here, because both depend on `response.ts` (T033, Phase 3); the split path arrives in T034 and the destination path in T047

**Checkpoint**: Both seams exist, the config parses, one transport works, and the payload guarantee is held by
the type. User story work can begin.

---

## Phase 3: User Story 1 — Untangle One Rambling Capture (Priority: P1) 🎯 MVP

**Goal**: A user sorting a rambling dictated item can ask for it to be divided, edit the proposed pieces, and
accept — replacing one inbox item with several ordinary ones in the original's place.

**Independent Test**: With a stub transport returning a fixed split, ask for a split on a multi-thought item.
Confirm each piece is shown in full and consists only of verbatim spans, the inbox is unchanged while the
proposal is on screen, accepting replaces the item with exactly the accepted pieces in the original's position
carrying its capture timestamp, the resulting file is indistinguishable from one typed by hand, and rejecting
leaves the file byte-for-byte as it was.

### Tests for User Story 1 ⚠️ Write first, observe failing

- [X] T026 [P] [US1] Write failing test `packages/core/tests/split-verbatim.test.ts`: piece text is built by slicing the original at the named segments and **never** taken from the response; a segment index out of range, an index appearing in two pieces, and a piece naming no segments each make the response `unusable`; nothing is repaired, trimmed, or partially accepted. Table-driven over a corpus of **at least 20 split proposals**, asserting 100% of proposed piece text is present verbatim in its original and **0** reworded pieces are ever presented. **Red must be "a proposal was shown"**, not "the module crashed" (FR-010a, FR-010b, SC-013)
- [X] T027 [P] [US1] Write failing test `packages/core/tests/split-coverage.test.ts`: `uncovered` is the set difference over segment indices, in file order, and is empty when the pieces account for everything — exact arithmetic, never a similarity score (FR-013)
- [X] T028 [P] [US1] Write failing test `packages/core/tests/split-nothing-to-split.test.ts`: a single-thought item yields `nothingToSplit: true` rather than a one-piece proposal (FR-011)
- [X] T029 [P] [US1] Write failing test `packages/core/tests/split-payload.test.ts`: the split payload carries the item's text and its segments and nothing else — markers planted in `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, `log/`, a sibling inbox item, and a project's milestones, next action, DRI, status, ledger, and `## Unprocessed` must none of them appear. Extends `summary-payload.test.ts`'s absence technique (FR-042)
- [X] T030 [P] [US1] Write failing test `packages/desktop/tests/fs-inbox-document-replace.test.ts`: `replaceRange` is atomic to a reader, writes nothing on `expected` mismatch, does not discard a concurrent append (using the existing `beforeRename` seam), and `removeRange`'s signature and behaviour are unchanged
- [X] T031 [P] [US1] Write failing test `packages/core/tests/sort-split.test.ts`: `split(ref, pieces)` refuses `item-changed` when the bytes moved and `empty-pieces` when every piece is blank; pieces carry **the original's** `capturedAt`; an item with no timestamp yields pieces with none; pieces occupy the original's byte range; exactly one `replaceRange` call is made and **no journal entry is written** (research R9)
- [X] T032 [P] [US1] Write failing property test `packages/core/tests/split-roundtrip.test.ts`: `parseInbox` after a split returns exactly the piece texts given, including multi-line pieces and pieces containing a blank line, which must round-trip as **one** item each (research R10)
- [X] T032a [P] [US1] Write failing test `packages/core/tests/suggest-no-files-created.test.ts`, in the shape of Feature 4's `policy-no-files-created.test.ts`: across a prepare → run → **reject** cycle and a prepare → run → **accept** cycle, the only paths created or modified in the vault are the ones sorting already writes. No cache, index, history, proposal store, or scratch file appears anywhere — asserted by diffing the full path set before and after, not by checking known names (FR-070, SC-010)

### Implementation for User Story 1

- [X] T033 [US1] Implement `packages/core/src/intelligence/response.ts` — strict JSON parse with code-fence stripping as the only tolerance, verbatim slicing from segment indices, coverage arithmetic, and the `unusable` mapping (research R12)
- [X] T034 [US1] Complete the `SplitProvider` half of `packages/core/src/intelligence/default-intelligence.ts`
- [X] T035 [US1] Add `replaceRange` to `InboxDocument` in `packages/core/src/ports/index.ts` and implement it in `packages/desktop/src/main/adapters/fs-inbox-document.ts`, sharing the existing private splice so `removeRange` is untouched (research R8)
- [X] T036 [US1] Implement `packages/core/src/sort/split.ts` (verification and replacement-block construction) and add `split(ref, pieces)` to `packages/core/src/sort/sort-service.ts`
- [X] T037 [US1] Amend `packages/core/tests/sort-scope-boundaries.test.ts`: add `"split"` to the expected-surface array with a dated comment in the style of the Feature 6 amendment in `project-scope-boundaries.test.ts`. **The forbidden-substring list — including `suggest` — must be left unchanged and must still pass**, because suggesting lives on a different service
- [X] T037a [P] [US1] Write failing test `packages/desktop/tests/suggest-ipc-contract.test.ts` **before the channels exist**: `suggest:run` accepts an opaque id and not payload text, so the bridge cannot influence what is sent; `sort:split` carries `(ItemRef, string[])` and is registered unconditionally because it is a `SortService` verb; the `suggest` bridge object is attached only when a transport is configured; ids are per-window and dropped when the window closes (contracts/ipc-suggest.md)
- [X] T038 [US1] Add `suggest:prepare-split`, `suggest:run`, `suggest:abandon`, and `sort:split` to `packages/desktop/src/main/ipc.ts`, holding each `PreparedRequest` against an opaque per-window id so the renderer can never influence what is sent (see [contracts/ipc-suggest.md](./contracts/ipc-suggest.md))
- [X] T039 [US1] Add the `suggest` bridge object (attached only when a transport is configured) and `sort.split` (attached always) to `packages/desktop/src/preload/preload.ts`
- [X] T040 [P] [US1] Write failing e2e `packages/desktop/tests/e2e/suggest-split.spec.ts` covering quickstart scenarios 4 and 5 — **written before the renderer exists**, so its Red is "no proposal panel appeared"
- [X] T041 [US1] Add the proposal panel markup to `packages/desktop/src/renderer/sort.html` and the split flow to `packages/desktop/src/renderer/sort.ts` — pieces shown in full, each editable, each deletable, the uncovered text surfaced before an accept can complete, plus accept and reject

**Checkpoint**: A rambling capture can be untangled end to end. US1 is independently demonstrable.

---

## Phase 4: User Story 2 — Ask Where This Belongs (Priority: P2)

**Goal**: A user can ask where an item — or a piece of a split one — belongs, see one destination with a brief
reason, and accept it through the same sort action a manual choice uses.

**Independent Test**: With a fixture vault holding several projects and areas, ask for a destination. Confirm
exactly one of the five destinations is proposed; any project or area named exists; a create proposal is
visibly distinct; a waiting-for proposal carries an editable owner; accepting produces files identical to
sorting by hand; rejecting writes nothing.

### Tests for User Story 2 ⚠️ Write first, observe failing

- [X] T042 [P] [US2] Write failing test `packages/core/tests/destination-payload.test.ts`: the payload carries each project's title and stated outcome and each area's title, and nothing else — the same planted-marker sweep as T029, extended to assert that a project's milestones, next action, DRI, status, ledger, and `## Unprocessed` are absent while its outcome **is** present (FR-043)
- [X] T043 [P] [US2] Write failing test `packages/core/tests/destination-existing-only.test.ts`: a response naming a slug not in the catalogue read for this request makes the response `unusable` and is never shown as an existing destination; a `createTitle` decision sets `isNew`; the catalogue is re-read on every request so a project created in another window is proposable without a restart. Table-driven over a corpus of **at least 20 destination proposals** against a fixture vault, asserting 100% of projects and areas named as existing exist in it and **0** invented names are presented as existing (FR-022, FR-024, SC-004)
- [X] T044 [P] [US2] Write failing test `packages/core/tests/destination-decision-shape.test.ts`: `proposal.decision` is a Feature 2 `SortDecision`; a sixth destination is not expressible; a waiting-for proposal carries an owner drawn from the item text, left empty when the text names nobody, and editable before acceptance; and every proposal carries a non-empty `reason`, with a response omitting one treated as `unusable` rather than shown without it (FR-020, FR-021, FR-025)
- [X] T045 [P] [US2] Write failing test `packages/core/tests/destination-accept-parity.test.ts`: for all five destinations plus create-a-project and create-an-area, the files produced by accepting a proposal are **byte-identical** to those produced by the same decision made by hand, and nothing anywhere records that a suggestion occurred. Include the refusal path: delete the proposed project between the proposal and the accept, then assert Feature 2's `destination-missing` refusal reaches the caller **verbatim**, is not retried, is not worked around, and does not trigger a fresh proposal (FR-030, FR-032, FR-033, SC-005)
- [X] T045a [P] [US2] Write failing test `packages/core/tests/destination-per-piece.test.ts`: after an accepted split, a destination can be requested for **each resulting piece individually**, the payload for each carries that piece's text alone and no sibling piece's, and each piece is routed by its own `sort()` call (FR-026, spec US2 acceptance scenario 7)
- [X] T045b [P] [US2] Write failing test `packages/core/tests/suggest-reject-immutable.test.ts`: across **at least 10 rejections** spanning both proposal kinds, every file in the data directory is byte-identical to its state before the request — asserted by a whole-vault checksum set, so a file created and deleted again would still fail (FR-017, FR-027, SC-012)

### Implementation for User Story 2

- [X] T046 [US2] Add destination request construction to `packages/core/src/intelligence/request.ts` and destination response parsing plus catalogue validation to `packages/core/src/intelligence/response.ts`
- [X] T047 [US2] Complete the `DestinationProvider` half of `packages/core/src/intelligence/default-intelligence.ts`
- [X] T048 [US2] Implement `prepareDestination`'s catalogue read in `packages/core/src/suggest/suggestion-service.ts` — title and outcome for projects, title alone for areas, parsed with the existing `parseProject`/`parseArea`
- [X] T049 [US2] Add `suggest:prepare-destination` to `packages/desktop/src/main/ipc.ts`. **Add no accept channel** — acceptance is the existing `sort:decide` carrying `proposal.decision`
- [X] T050 [P] [US2] Write failing e2e `packages/desktop/tests/e2e/suggest-destination.spec.ts` covering quickstart scenario 6, plus the split → per-piece destination sequence from T045a — written before the renderer, so its Red is "no destination proposal appeared"
- [X] T051 [US2] Add the destination proposal UI to `packages/desktop/src/renderer/sort.ts` — the reason, new-versus-existing marking, an editable waiting-for owner, choosing a different destination, and reject

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — See Exactly What Would Leave the Machine (Priority: P3)

**Goal**: Before anything is sent, the user reads the exact content of the request, in the same view where
they ask.

**Independent Test**: With a recording transport, ask for a split and a destination. Confirm the content
displayed before sending is byte-identical to what the transport received, and contains nothing else from the
data directory.

### Tests for User Story 3 ⚠️ Write first, observe failing

- [X] T052 [P] [US3] Write failing test `packages/core/tests/suggest-preview-boundary.test.ts`: the full marker sweep across `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, `log/`, and sibling inbox items, run against **both** request kinds through the preview value rather than through the provider, so the thing the user reads is the thing that is asserted (FR-041, FR-044, SC-007)
- [X] T053 [P] [US3] Write failing test `packages/desktop/tests/suggest-preview-identity.test.ts`: the **end-to-end** identity, which T037a's channel-shape test does not cover — the string `suggest:prepare-*` returned across the bridge, the string the renderer displays, and the string the transport received are the same bytes, for both request kinds, through the real IPC path (FR-041, FR-045, SC-007)

### Implementation for User Story 3

- [X] T054 [P] [US3] Write failing e2e `packages/desktop/tests/e2e/suggest-preview.spec.ts` covering quickstart scenario 3, including the planted markers — written before the preview panel exists, so its Red is "the request was sendable without its content being shown"
- [X] T055 [US3] Add the preview panel to `packages/desktop/src/renderer/sort.html` and `sort.ts` — the exact payload rendered in full, in the same view as the ask, with the send as the user's explicit act taken with that content readable

**Checkpoint**: What is sent is visible before it is sent, and provably the same bytes.

---

## Phase 6: User Story 4 — Nothing Configured, or Something Broke (Priority: P4)

**Goal**: With no transport, sorting is Feature 2 with no sign this feature exists. With a broken one, one
plain message and immediate manual sorting.

**Independent Test**: Run Feature 2's entire sort suite against a build with no transport configured and
confirm it passes unmodified with byte-identical output. Then, for each of the seven failure modes, confirm
one plain message, no write, and no retry.

### Tests for User Story 4 ⚠️ Write first, observe failing

- [X] T056 [P] [US4] Write failing test `packages/core/tests/suggest-failures.test.ts`: all seven failure modes — `not-configured`, `misconfigured`, `credential`, `unreachable`, `timed-out`, `failed`, `unusable` — each leave the data directory byte-identical, produce exactly one message, and attempt **no** automatic retry (FR-062–FR-065, SC-008)
- [X] T057 [P] [US4] Write failing test `packages/core/tests/suggest-unusable-response.test.ts`: not JSON, valid JSON of the wrong shape, a field of the wrong type, and a truncated response each yield `unusable` with **no partial or repaired proposal shown**; a code-fenced valid payload parses, which is the only tolerance. **Red must be "a partial proposal was returned"** — a green that comes from the parser throwing before it can repair anything is the same outcome by accident, so assert the returned value, not the absence of a crash (FR-064, research R12)
- [X] T058 [P] [US4] Write failing test `packages/desktop/tests/suggest-absent-surface.test.ts`: with no transport configured, **no** `suggest:*` handler is registered and `window.waypoint.suggest` is `undefined` — absence from the API surface, not a disabled control (FR-060, SC-002)
- [X] T059 [P] [US4] Write failing test `packages/core/tests/suggest-no-probing.test.ts`: with a command-line tool resolvable on `PATH`, a listening local port, and relevant environment variables set, an absent `intelligence.md` leaves the layer **off**; nothing is probed and no environment variable is consulted (FR-052)
- [X] T060 [P] [US4] Write failing test `packages/desktop/tests/suggest-no-outbound.test.ts`: with `globalThis.fetch`, `spawn`, and `https.request` replaced by recorders that throw, a full unconfigured sort walk attempts none of them — proved against doubles, following `review-no-outbound.test.ts` (FR-040, SC-002)
- [X] T060a [P] [US4] Write failing test `packages/desktop/tests/suggest-never-unprompted.test.ts`: with a transport **configured** and a recording stub behind it, capture an item, open the inbox, advance through several items with `sort:next`, leave the window idle past the 120-second bound, and trigger a vault change — and assert the transport recorded **zero** calls. Nothing subscribes, nothing polls, nothing fires on capture, on open, on advance, or on a timer; the only thing that produces a request is an explicit per-item ask (FR-002, FR-004)

### Implementation for User Story 4

- [X] T061 [US4] Implement the failure mapping in `packages/core/src/suggest/suggestion-service.ts` and `packages/core/src/intelligence/default-intelligence.ts` — every transport error onto exactly one `SuggestionFailure`, each with a message written for display
- [X] T062 [US4] Implement conditional wiring in `packages/desktop/src/main/main.ts` and `ipc.ts`: read `intelligence.md` at startup and after a vault change, register `suggest:*` handlers and attach the preload bridge object **only** when a transport is configured, and surface a config problem through the existing notice queue
- [X] T063 [US4] Run **every existing feature suite** — Features 1 through 6, not Feature 2 alone — against an unconfigured build and confirm byte-identical output. Feature 1's suite is what proves capture is untouched (FR-071) and Features 3–6 are what prove nothing else came to depend on this layer (FR-061). **Assert the executed test count** so a suite that silently did not run cannot pass this task (SC-001)
- [X] T064 [P] [US4] Add e2e `packages/desktop/tests/e2e/suggest-absent.spec.ts` covering quickstart scenario 1 — no control in any state

**Checkpoint**: The feature is invisible when off and harmless when broken.

---

## Phase 7: User Story 5 — Move Between Home and Work by Changing One Line (Priority: P5)

**Goal**: The second transport, and the proof that changing one setting changes nothing but how the request
travels.

**Independent Test**: Run one suggestion suite twice, changing only the configured value, and confirm
identical proposals from identical stubbed responses.

### Tests for User Story 5 ⚠️ Write first, observe failing

- [X] T065 [P] [US5] Write failing test `packages/desktop/tests/certificate-transport.test.ts` against a local HTTPS server with client and server key material **generated at run time in a temp directory**, so the platform's own OpenSSL produces what the test uses: `cert`/`key`/`ca` are honoured; a missing or unreadable credential raises `credential`; a handshake failure raises `credential`; a non-2xx status raises `failed`; a socket closed mid-response raises `failed`; an aborted signal destroys the request (research R13, R19)
- [X] T066 [P] [US5] Write failing test `packages/desktop/tests/transport-parity.test.ts`: one suggestion suite run twice against the two transports, changing only the `intelligence.md` value, producing identical proposals from identical stubbed responses and exercising the same acceptance path (FR-050, SC-009)
- [X] T067 [P] [US5] Write failing test `packages/desktop/tests/credential-messages.test.ts`: a `credential` failure message names the **path** and the problem and never the material; no message, notice, or preview anywhere contains key material (FR-051d)

### Implementation for User Story 5

- [X] T068 [US5] Implement `packages/desktop/src/main/adapters/certificate-transport.ts` using `node:https.request` with `cert`/`key`/`ca`, reading credentials from their configured paths at call time and honouring the injected `AbortSignal` with no timeout of its own
- [X] T069 [US5] Wire transport selection in `packages/desktop/src/main/main.ts` from `parseIntelligenceConfig` — a `switch` over the two known values with no fallback and no probing
- [X] T070 [P] [US5] Add e2e `packages/desktop/tests/e2e/suggest-transport-switch.spec.ts` covering quickstart scenario 7

**Checkpoint**: The seam is proven against two genuinely different real environments.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T071 [P] Add `packages/desktop/tests/vault-no-secrets.test.ts` — after exercising both transports, scan the whole vault and assert zero secret material is present or required to be (SC-009a)
- [X] T072 Verify the plan's stated predictions: exactly one existing test file was modified (`sort-scope-boundaries.test.ts`, one line plus a dated comment), and `decision-points.test.ts`, `sort-no-suggestion.test.ts`, `sort-offline.test.ts`, `summary-payload.test.ts`, and `project-scope-boundaries.test.ts` are untouched and still pass for the reasons they were written. **If any other file needed editing, record it in plan.md's Complexity Tracking rather than in silence** — Feature 6 set this precedent
- [X] T073 [P] Confirm `DECISION_POINTS` is still five and no `DecisionContext` member was added (FR-034, SC-011)
- [X] T074 [P] Update `ROADMAP.md`: tick Feature 8, record what shipped — `intelligence.md` in the vault root, the two transports, the segment-number technique that makes verbatim structural, the split verb on `SortService`, five decision points unchanged, and that Feature 5's summary port is still unimplemented and why
- [X] T075 [P] Run every quickstart scenario 1–12 by hand on Linux and record any divergence in [quickstart.md](./quickstart.md). Scenario 4 carries SC-006: time the untangling of a four-thought dictation into four correctly separated items and confirm it lands under 60 seconds of user time. This is a manual smoke measurement, not a unit test — the same treatment Feature 6 gave its ten-second first-entry budget
- [X] T076 Confirm the full suite, both transports included, passes on the macOS runner in GitHub Actions — the command transport touches subprocess handling and the certificate transport touches platform TLS, and neither is assumed portable (research R19)

  **Prepared, not confirmed (2026-08-17).** CI had no macOS job at all: `ci.yml`
  ran only on `ubuntu-latest`, and `release.yml`'s `macos-14` entry builds
  artifacts without running tests. A `test-macos` job now exists and runs
  `npm run typecheck` and `npm test` on `macos-14`, which is where both
  transport suites live.

  Two things were needed to make that job mean something:

  - macOS ships **LibreSSL** as `openssl`, and the certificate suite generates
    its key material with whatever `openssl` is on the machine. That is exactly
    the difference worth catching, and it is also the most likely way the job
    could go green while testing nothing — the TLS suites skip themselves when
    no usable `openssl` is found. `WAYPOINT_REQUIRE_TLS_FIXTURES=1` is set on
    that job, which turns the skip into a failure.
  - The job prints `openssl version` before running, so the record says which
    implementation the fixtures were built with.

  **Confirmed 2026-08-18**, run 32131322096 on commit `54d0d90`: `test-macos`
  green on `macos-14` with `WAYPOINT_REQUIRE_TLS_FIXTURES=1`, so the TLS
  fixtures were built and exercised rather than skipped, and `test` green on
  `ubuntu-latest` (2229 unit, 230 e2e). Both transports run on both platforms.

  **One caveat, recorded rather than smoothed over.** The macOS job failed on
  the preceding run (32130624063) with a single assertion inside the nested
  pre-existing suite, and that failure was never diagnosed: `execFileSync`
  threw with the command as its message and discarded the child's output, so
  the log did not say which test failed. The next run passed. The failure was
  therefore **not fixed — it did not recur**, and something intermittent on
  macOS remains unaccounted for. `spawnSync` now preserves the child's output
  and the assertion names every failing subtest, so the next occurrence will
  say what it was. A hard wall-clock budget under nested-run contention is the
  suspicion; it is not evidence.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. No dependency on any other story
- **US2 (Phase 4)**: depends on Foundational. Independent of US1 — the destination path needs no split
- **US3 (Phase 5)**: depends on Foundational; its tests are richer with US1 and US2 present, but the preview
  value exists from T015
- **US4 (Phase 6)**: depends on Foundational. T063 is most meaningful after US1 and US2 have added their IPC
  channels, since that is when a regression could appear
- **US5 (Phase 7)**: depends on Foundational. The parity suite (T066) needs at least one story's behaviour to
  compare, so run it after US1
- **Polish (Phase 8)**: depends on all desired stories

### Within Phase 2

`T004→T005`, `T007→T008`, `T009→T010` are three independent test-then-implement pairs and can run in
parallel with each other. `T011` and `T012` gate `T013`. `T013→T014→T015` is strictly sequential — the
identity test must be Red before the single-construction design exists. `T023→T024` is independent of all of
it. `T024a→T025` is the fourth pair, and `T025` also needs `T011` and `T015`. `T022` and `T022a` are standing
guards over the compiled and exported surface, so both need `T021`.

**T025 is a skeleton only.** Both provider paths depend on `response.ts` (T033), which is Phase 3 work, so
neither can be implemented in Phase 2. The split path arrives in T034 and the destination path in T047. An
earlier draft of this list said T025 implemented the split path; that was impossible as scheduled and is
corrected here.

### Within Each User Story

Tests are written and observed failing before implementation, without exception (Principle I). Then: pure
functions → service → adapter → IPC → preload → renderer → e2e.

### Parallel Opportunities

- All of T002, T003 in Setup
- In Phase 2: the three test-then-implement pairs (T004/T005, T007/T008, T009/T010) plus the transport pair
  (T023/T024) are four independent tracks
- Within each story, every task marked [P] writes a different file
- Once Phase 2 is complete, US1 and US2 can be built by different people with no shared file except
  `default-intelligence.ts` (T034 and T047) and `sort.ts` (T041 and T051) — coordinate on those two

---

## Parallel Example: User Story 1

```bash
# All nine US1 tests, written together, all expected to fail:
Task: "split-verbatim.test.ts — piece text is sliced, never taken from the response"
Task: "split-coverage.test.ts — uncovered is exact set difference"
Task: "split-nothing-to-split.test.ts — a single thought is not a one-piece proposal"
Task: "split-payload.test.ts — planted markers must not appear"
Task: "fs-inbox-document-replace.test.ts — replaceRange is atomic, removeRange unchanged"
Task: "sort-split.test.ts — timestamps inherited, one write, no journal entry"
Task: "split-roundtrip.test.ts — pieces round-trip through parseInbox"
Task: "suggest-no-files-created.test.ts — no cache, index, or proposal store appears"
Task: "suggest-ipc-contract.test.ts — suggest:run takes an id, never payload text"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — **critical, blocks everything**
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart scenarios 1, 3, 4, 5. Scenario 1 first and last — if a user with no
   `intelligence.md` can tell this feature shipped, stop and fix that before anything else
5. This is a demonstrable product: a rambling dictation becomes clean inbox items

### Incremental Delivery

1. Setup + Foundational → both seams exist, one transport works
2. US1 → untangling works → **MVP**
3. US2 → destinations proposed → the second half of the untangling
4. US3 → the preview is explicit and asserted end to end
5. US4 → every absence and failure is proven harmless
6. US5 → the second transport, and the seam is proven rather than assumed

### The order that matters most

US4 is last in priority and its guarantee must hold from T026 onward. Do not defer it to Phase 6 in practice:
every story's tests run against an unconfigured build as well as a configured one, and T063 is the formal
check rather than the first time anyone looks.

---

## Notes

- **[P] = different files, no dependency on incomplete work.**
- **Every test is written first and observed failing for the right reason.** Seven tasks name what the Red
  must look like — T013, T026, T040, T050, T054, T057, T063 — because those are the ones that can pass
  vacuously (a boundary never exercised, a suite silently skipped, a panel never rendered). T022a
  is the exception that proves the habit: it is a standing tripwire whose first run is expected **green**, and
  it says so, so nobody mistakes it for a test that was never wired up.
- **The client tasks are test-first too.** T037a precedes the IPC channels, and each phase's e2e task precedes
  the renderer work it exercises (T040 before T041, T050 before T051, T054 before T055). Principle I does not
  stop at the core boundary.
- Commit after each task or logical pair.
- One existing test file is expected to change, and only one: `sort-scope-boundaries.test.ts` (T037). If a
  second needs editing, that is a signal to re-read research R7 and R9 before proceeding.
- Nothing in this feature stores a proposal. If a task seems to need a cache, an index, or a history, it has
  drifted out of scope (FR-046, FR-070).

---

## Phase 9: Convergence

**Appended 2026-08-17 by `/speckit-converge`.** Each task names the requirement, plan decision, or
contract it traces to and the kind of gap found. T076 above is a real remaining gap and is deliberately
**not** duplicated here — it is already open and already says what it needs.

- [X] T077 Assert that a malformed `intelligence.md` is actually reported to the user, not merely made harmless, per FR-055 / US4-AC5 / SC-008 (partial). `packages/desktop/tests/e2e/suggest-absent.spec.ts` line 161 is named "a broken intelligence.md **reports one problem** and blocks nothing" and asserts only the second half; nothing anywhere asserts the notice `packages/desktop/src/main/main.ts` emits for a `problem` config reaches a surface a user can read. Extend that test — or add one beside it — to open the capture box and assert exactly one notice, carrying the parser's message, naming both the value read and the two transports that work. **The Red must be a missing notice**, so run it first against a build with the `emitNotice` call commented out and confirm it fails
- [X] T078 Reconcile `main.ts`'s single startup read of `intelligence.md` with T062's "at startup **and** after a vault change" per tasks T062 (partial). The shipped behaviour reads once inside `start()`; no `vaultChanged` subscriber re-reads it, and the sort window's `--waypoint-suggest` argument is fixed at window creation, so a live re-read cannot change the bridge without rebuilding the window. If that is the right answer — it appears to be — record it as a deviation in plan.md's Complexity Tracking in the style of the `propose` → `prepare*` entry, stating that switching transports takes a restart and why. If it is not, implement the re-read and the window rebuild it implies
- [X] T079 Remove the unused `suggest:available` channel, or record why it stayed, per contracts/ipc-suggest.md and research R17 (unrequested). `packages/desktop/src/main/ipc.ts` registers it and `packages/desktop/src/preload/preload.ts` exposes `available()`; no renderer code and no test calls either, because R17 decided availability by the `--waypoint-suggest` window argument instead. A channel nothing consumes is surface this feature promised not to grow. If it is removed, `packages/desktop/tests/suggest-ipc-contract.test.ts` should gain an assertion that the `suggest` bridge exposes exactly the four verbs that remain
- [X] T080 [P] Bring contracts/ipc-suggest.md's channel table in line with the channels that shipped, or record the divergence, per contracts/ipc-suggest.md (partial). The contract gives `suggest:prepare-split` an `ItemRef`, `suggest:prepare-destination` an `ItemRef | { text: string }`, and `suggest:run` / `suggest:abandon` an `{ id: string }`; the implementation passes a serialized item, a bare string, and bare string ids. None of this weakens FR-045 — the payload is still built in the main process and returned — but the divergence is unrecorded, unlike the `propose` → `prepare*` one, which plan.md documents. Follow that precedent: amend with a dated note rather than rewriting history
