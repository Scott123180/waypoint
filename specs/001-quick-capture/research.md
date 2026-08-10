# Phase 0 Research: Quick Capture (Text & Voice)

**Feature**: 001-quick-capture | **Date**: 2026-08-09

This document resolves the open technical questions for the capture feature. Decisions already
fixed by [ROADMAP.md](../../ROADMAP.md) (whisper.cpp over faster-whisper, `small.en` model,
inbox outside the app repo, macOS builds via GitHub Actions only) are treated as given and are
restated here only where they constrain a downstream choice.

---

## R1. Getting dictated audio to whisper.cpp without writing it to disk

**Constraint**: FR-006a requires raw audio be processed in-memory only and never written to disk.
This rules out the common "record to `/tmp/clip.wav`, pass the path" pattern.

**Decision**: Capture audio in the renderer via `getUserMedia` + Web Audio API, downsample to
16 kHz mono 16-bit PCM, encode a WAV container in JavaScript (~40 lines, no dependency), transfer
the buffer over IPC to the main process, and **pipe it to `whisper-cli` on stdin** using `-f -`.

**Rationale**:
- whisper.cpp's WAV reader (`examples/common.cpp`) special-cases the filename `-`: it drains stdin
  into an in-memory buffer and initialises `dr_wav` from memory. This gives a true no-disk path.
- Whisper requires 16 kHz mono input regardless; doing the downsample in the renderer means we ship
  the smallest possible buffer over IPC and avoid a resampling dependency in the main process.
- Encoding WAV by hand is trivial (44-byte header + PCM payload) and avoids an npm dependency,
  satisfying the "minimal dependencies" constraint.
- `MediaRecorder` was rejected: it emits WebM/Opus, which whisper.cpp cannot read, and would force
  an ffmpeg dependency to transcode.

**CONFIRMED EMPIRICALLY 2026-08-10** against a locally built `v1.7.4` binary: piping the WAV in
produced `read_wav: read 48044 bytes from stdin` and exit 0, and real speech round-tripped through
our own downsampler and WAV encoder came back transcribed verbatim. The source reading below was
correct.

**VERIFIED 2026-08-09 against tag `v1.7.4` (task T040 — spike resolved, GO).** Confirmed by reading
`examples/common.cpp:642` in the pinned source: `read_wav()` special-cases `fname == "-"`, drains
stdin into a `std::vector<uint8_t>` in 1 KB chunks, and initialises `dr_wav` via
`drwav_init_memory`. There is no disk write anywhere on that path. The CLI target name is
`whisper-cli` (`examples/cli/CMakeLists.txt:1`). **The fallback below is not needed.**

Two implementation details the source makes explicit:

- The read loop runs until `fread` returns 0, so the adapter **MUST close the child's stdin** after
  writing the WAV. Leaving it open hangs the process forever.
- It logs `read N bytes from stdin` to **stderr**. Harmless — the adapter reads only stdout — but
  stderr must not be treated as an error signal on its own; only the exit code is authoritative.

**Build prerequisites**: whisper.cpp v1.7.4 builds with CMake (`sudo apt install cmake` on Ubuntu;
GitHub Actions runners already have it).

**`BUILD_SHARED_LIBS=OFF` is required, not optional.** The default build emits `libwhisper.so` and
`libggml.so`, and a `whisper-cli` that aborts at startup with `error while loading shared libraries`
unless they sit beside it. Copying just the executable — which the first version of
`fetch-whisper.sh` did — produces a bundle that looks fine and cannot run. The script now builds
static and, more importantly, **executes the binary it just installed before reporting success**;
without that check it happily printed "Binary installed" for something non-functional.

**Fallback if stdin is unsupported on the pinned version**: write the WAV to a memory-backed
filesystem rather than to durable storage — `/dev/shm` on Linux, and on macOS a per-session
`mkfifo` named pipe or a small `diskutil erasevolume` ram disk. This fallback is explicitly
second-choice: it complicates the macOS path and weakens the "never on disk" guarantee to
"never on persistent disk", so it is only taken if the spike disproves stdin support.

**Alternatives considered**:
- *whisper.cpp as a native Node addon (node-gyp binding)*: removes the subprocess and the WAV
  round-trip entirely, but requires compiling a native module per platform/Electron ABI, which is
  exactly the fragility the ROADMAP's build-machine rule exists to avoid. The user also explicitly
  specified subprocess invocation.
- *Streaming partial results*: whisper.cpp supports streaming, but capture clips are short and the
  spec does not require live partial transcript display. Deferred.

---

## R2. Instant capture window (<100 ms from hotkey to ready)

**Decision**: Create the capture `BrowserWindow` once at app startup with `show: false`, fully
loaded and its input focused. The global hotkey handler calls `win.show()` + `win.focus()` only —
never `new BrowserWindow()`. The app runs as a background/tray process so this pre-warmed window
always exists.

**Rationale**: Window creation plus renderer load is 200–800 ms; showing an already-loaded hidden
window is single-digit milliseconds. This is the only approach that reliably meets SC-001.

**Supporting details**:
- `webPreferences.backgroundThrottling: false` so the hidden window is not throttled by the OS.
- On macOS, `app.dock.hide()` (LSUIElement) keeps it a background agent; set
  `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` so the hotkey works over
  fullscreen apps and does not force a Space switch.
- The renderer clears and re-focuses its input on a `capture:reset` event when shown, so the box is
  always ready without a reload.
- Latency is measured from the main-process hotkey callback to the renderer's `focus` event, logged
  behind a dev flag, and asserted in the E2E test.

**Alternatives considered**: creating the window lazily on first hotkey (fails the budget on cold
trigger, which is the common case); a persistent always-visible window (defeats the purpose of a
hotkey-summoned capture surface).

---

## R3. Global hotkey registration

**Decision**: Electron's built-in `globalShortcut.register()`. Default binding
`CommandOrControl+Shift+Space`, overridable via the config file.

**Rationale**: Built into Electron, no dependency. On macOS it uses Carbon `RegisterEventHotKey`,
which does **not** require Accessibility permission for ordinary modifier+key combinations (only
media/system keys do), so the app has no permission prompt on the hotkey path.

**Failure handling (spec edge case)**: `globalShortcut.register()` returns `false` when the OS or
another app already owns the combination. On `false`, the app MUST surface a visible, actionable
notice (the combination is taken, here is how to change it) rather than failing silently — the user
would otherwise conclude the app is broken.

**The fallback must actually exist.** Because the app runs as a background agent with the dock icon
hidden, a failed hotkey registration would otherwise leave *no* way to reach the capture box. FR-002
is therefore satisfied by a concrete **tray/menu-bar icon** (`main/tray.ts`) whose click and
"Capture" menu item call `showCapture()` directly, plus `app.on('activate')` and `second-instance`
handlers. This path MUST NOT depend on hotkey registration having succeeded.

**Microphone permission** is separate and does prompt on macOS: requires `NSMicrophoneUsageDescription`
in the packaged `Info.plist`. Requested lazily on first dictation, not at launch.

---

## R4. Non-blocking, hand-edit-safe inbox appends

**Decision**: A single serialized async append queue in the main process, using `fs.appendFile`
(POSIX `O_APPEND`). The IPC submit handler creates the item and enqueues the write, then returns
the item id **immediately without awaiting the write**. The renderer hides the capture box on send
and never awaits the disk result.

**Rationale**:
- `O_APPEND` makes each append atomic with respect to other writers at the OS level, so a concurrent
  hand-edit in a text editor cannot interleave into the middle of our write. Combined with
  never rewriting the whole file, this satisfies FR-016 (hand edits preserved, never clobbered).
- Serializing through one in-process promise chain guarantees capture order matches submit order,
  which a bare `Promise.all` of appends would not.
- Returning before the write completes is what satisfies Principle VI and FR-010/SC-005.

**Durability trade-off (accepted, explicit)**: because we return before `fsync`, a crash in the
window between submit and flush loses that item. This is the correct trade for a capture surface —
the constitution ranks instant response above durability at this boundary — but the queue MUST be
drained on `before-quit` so a normal quit never loses queued items.

**Write failure handling**: a failed append is a user-visible error, not a silent drop. The queue
retries once, then surfaces a persistent notice with the raw text so the thought is recoverable by
copy/paste. Never discard the text on I/O failure.

---

## R5. Undo semantics for a just-captured item

**Decision**: Undo is a **verified tail truncation**. Core records the exact serialized block and the
file length before the append. To undo, it re-reads the file, confirms the tail still matches
byte-for-byte what was appended, and if so truncates back to the prior length. If the tail does not
match — the user hand-edited the file, or another capture landed after it — undo is **refused**, not
forced.

**Rationale**: Refusing is the only safe behaviour. A "remove the last item" implementation that
does not verify would silently delete a thought the user typed in their editor between capture and
undo. Refusal is recoverable (the text is still visible to the user); a wrong deletion is not.

**Scope**: undo stays available for the most recent item only, while the capture box remains open or
until the next capture begins (per spec Assumptions), then expires. This is deliberately not a
general edit history — that would be organizing, which is out of scope (FR-018).

---

## R6. Inbox file format

**Decision**: One markdown list item per captured thought, ISO 8601 local timestamp first:

```markdown
- 2026-08-09T14:23:05-04:00 Call the roofer back about the estimate
- 2026-08-09T14:31:12-04:00 Multi-line dictated thought keeps going
  on a continuation line indented by two spaces.
```

**Rationale**:
- Renders correctly as a markdown list, greps cleanly, sorts chronologically as plain text, and is
  obvious to hand-edit — satisfying Principle IV and FR-015.
- ISO 8601 **with local UTC offset** preserves the wall-clock time the user actually experienced
  while staying unambiguous. Bare local time would be ambiguous across DST; bare UTC would display
  a confusing time to a human reader of the file.
- Two-space continuation indent is standard markdown list continuation, so multi-paragraph dictation
  stays inside its list item.

**Deliberately excluded**: no id, no tags, no front-matter, no status field. Capture stores raw
(FR-014), and Feature 2 (sort) will read these items without needing metadata capture did not
collect. The item id used for undo is in-memory only and never serialized.

**Default location**: `~/waypoint/inbox.md`, created with parent directories on first capture,
overridable via config. Outside the app repo per ROADMAP; a plain directory the user can `git init`
themselves.

---

## R7. Configuration storage

**Decision**: A single JSON file at the platform config dir — `~/.config/waypoint/config.json` on
Linux (XDG), `~/Library/Application Support/waypoint/config.json` on macOS — holding `inboxPath`,
`hotkey`, and `whisperModelPath`. Missing file means defaults; the app writes it on first run.

**Rationale**: JSON is an accepted structured plain-text format under Principle IV, needs no
dependency to parse, and is hand-editable. Rejected `electron-store` (unnecessary dependency for
one flat object) and TOML (would require a parser dependency).

---

## R8. Language, toolchain, and dependency budget

**Decision**: TypeScript compiled with `tsc` only — no bundler. npm workspaces monorepo
(`packages/core`, `packages/desktop`). Renderer is plain HTML + CSS + one compiled ES module script.

**Total dependency budget**:

| Dependency | Kind | Justification |
|---|---|---|
| `electron` | dev + runtime | The specified client platform |
| `typescript` | dev | Type contracts across the core/client boundary |
| `@types/node` | dev | Types only |
| `electron-builder` | dev | Packaging DMG/AppImage in CI |
| `@playwright/test` | dev | The only viable Electron E2E driver |
| whisper.cpp binary | bundled asset | Not an npm dep; compiled in CI |

**Rationale**: No React/Vue/webpack. The capture surface is one text box and one button — a
framework would be pure overhead and would tempt domain logic into the client, against Principle II.
npm workspaces are built into npm, so the monorepo costs no dependency.

**Node version**: the dev machine manages Node with **nvm**, and v22.22.1 (LTS) is already installed —
no install step is needed, just `nvm use`. Pin it with a `.nvmrc` so CI and the local shell agree.

Worth knowing: the `node` on the default PATH is **18.19.1**, which is EOL, because non-interactive
shells do not source nvm. Any tooling invoked outside an nvm-activated shell will silently get 18.
Node 20 is **not** a valid target either — it reached end-of-life in April 2026. Node 22 (maintenance
LTS) or Node 24 (active LTS) are the supported choices; 22 is picked because it is already present.

---

## R9. Test strategy under mandatory TDD

**Decision**: Two layers, tests written first at both.

1. **Core unit + contract tests** — `node:test` with `node:assert`, zero dependencies. Covers every
   domain rule: item construction, timestamp, serialization format, empty-input rejection, undo
   verification and refusal, append ordering. The core has no Electron import, so these run as plain
   Node and are fast enough to drive a red-green-refactor loop.
2. **Desktop E2E** — Playwright's `_electron` driver. Covers window-ready latency, focus-on-show,
   duplicate-trigger handling, and the submit-then-clear-and-close flow.

**whisper.cpp in tests**: the transcription port is faked. Core tests inject a stub implementing
`TranscriptionPort`. The adapter's own contract test runs against a **fake `whisper-cli` shell
script** that echoes canned output on given stdin, so subprocess wiring (argv, stdin piping, exit
codes, stderr on failure) is tested without the 500 MB model or CI transcription time. One
opt-in integration test exercises the real binary and is skipped unless the model is present.

**Rationale**: This keeps the TDD loop fast, which is what makes mandatory test-first survivable.
A suite that needs a half-gigabyte model to run would be abandoned in practice.

---

## R10. whisper.cpp acquisition and bundling in CI

**Decision**: Neither the binary nor the model is committed to git. A GitHub Actions job compiles
whisper.cpp from a **pinned tag** on each target runner (`macos-14` for arm64, `ubuntu-latest` for
x64) and downloads `ggml-small.en.bin` from Hugging Face with a **checksum verified against a
pinned SHA-256**. Both are cached by key and injected via electron-builder `extraResources`.

**Rationale**:
- The ROADMAP forbids builds on the work machine and requires macOS release artifacts from CI.
- A public repo must not carry a ~500 MB binary blob in git history — it would be permanent and
  would make cloning miserable.
- Pinning the tag and verifying the model checksum makes builds reproducible and prevents a silently
  changed upstream artifact from entering the bundle.
- macOS build enables Metal for speed on Apple Silicon; Linux builds plain CPU.

**Bundling, not first-run download**: Principle III forbids core functionality depending on network
availability. Voice capture is core here, so the model ships inside the artifact. The ~500 MB
package size is the accepted cost, already decided in the ROADMAP.

**Local development on Linux**: a `scripts/fetch-whisper.sh` performs the same pinned build+download
locally into a gitignored `resources/` directory, so the dev machine matches CI.

**Deferred to a later feature**: macOS code signing and notarization. Unsigned artifacts require a
Gatekeeper bypass on first launch, which is acceptable for a personal tool at this stage and avoids
needing an Apple Developer certificate now. Flagged so it is a conscious deferral, not an oversight.

---

## Resolved spec edge cases

| Spec edge case | Resolution |
|---|---|
| Hotkey pressed while box already open | Ignored; box and in-progress input untouched (FR-003a) |
| Empty/unintelligible transcription | Box stays open, empty input, nothing saved (FR-017a) |
| Dictating then also typing | Transcript is **inserted at the cursor** into existing text, never replaces it |
| Inbox file missing or moved | Recreated with parent dirs on next append; never fails the capture |
| Undo after next capture began | Refused — window expired (R5) |
| Hotkey combination unavailable | Visible actionable notice; in-app trigger still works (R3) |
| Microphone lost mid-dictation | Recording ends, partial audio discarded, box stays open with a notice |
