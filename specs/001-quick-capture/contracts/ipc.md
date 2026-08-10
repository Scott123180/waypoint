# Contract: Electron IPC (renderer ↔ main)

**Feature**: 001-quick-capture

The renderer is a thin client (Principle II). Every channel below is a pass-through to
`CaptureService` — **no channel exists that lets the renderer make a domain decision.** The
renderer cannot set a timestamp, cannot write to the inbox, and cannot store a transcript.

`contextIsolation: true`, `nodeIntegration: false`. The preload script exposes exactly the surface
below on `window.waypoint` and nothing else.

---

## Renderer → Main

### `capture:submit` — `invoke`

```ts
submit(text: string, source: 'typed' | 'dictated'): Promise<
  | { ok: true; id: string }
  | { ok: false; error: 'empty' }
>
```

Calls `CaptureService.submit`. Resolves as soon as the write is enqueued, not when it is on disk.

**The renderer MUST hide the capture box on send without awaiting this promise** (FR-013). Awaiting
it before closing would reintroduce a disk-latency dependency into the user-visible path and break
Principle VI. The promise is consumed afterwards only to retain the `id` for undo.

### `capture:transcribe` — `invoke`

```ts
transcribe(wav: ArrayBuffer): Promise<
  | { status: 'ok'; text: string }
  | { status: 'no-speech' }
  | { status: 'failed'; message: string }
>
```

The renderer records audio, downsamples to 16 kHz mono 16-bit PCM, encodes WAV, and transfers the
buffer. Main pipes it to whisper.cpp and returns text.

The renderer **inserts the returned text into the capture box at the cursor** — it never submits it
automatically. This is what makes FR-007 structurally true rather than a matter of discipline.
Existing typed text is preserved, never replaced (resolved edge case, R10 table).

### `capture:undo` — `invoke`

```ts
undo(id: string): Promise<
  | { ok: true }
  | { ok: false; reason: 'expired' | 'file-changed' | 'unknown-id' }
>
```

On `file-changed`, the renderer MUST show the item's text alongside the refusal so the thought stays
recoverable (see [core-api.md](core-api.md)).

### `capture:dismiss` — `send`

Fire-and-forget. Hides the window. Used both when the user presses Escape and when a submit
completes. Any in-progress text is discarded — dismiss is an explicit user choice.

It deliberately does **not** expire the undo window: submit closes the box through this same
channel, so expiring here would destroy the undo window the instant it was created. The window
expires when the next capture begins, which `submit()` handles.

### `capture:notice-ack` — `send`

```ts
ackNotice(id: string): void
```

Marks a sticky notice as read. Notices carrying `recoverableText` replay on every open until
acknowledged, because that text is the only remaining copy of a thought whose write failed —
the box clearing itself on open must not be able to discard it.

---

## Main → Renderer

### `capture:reset` — `send`

Emitted immediately before the window is shown. The renderer clears the input, resets dictation
state, and focuses the text field. This is what makes a re-shown pre-warmed window indistinguishable
from a freshly opened one (R2, FR-003).

### `capture:notice` — `send`

```ts
{ level: 'info' | 'error'; message: string; recoverableText?: string }
```

Out-of-band notices the renderer displays without blocking input: inbox write failure (carrying
`recoverableText`), hotkey registration failure, microphone unavailable. Never a modal — a notice
must not stand between the user and the next thought.

---

## Testing seam (accepted, env-gated)

Playwright cannot deliver an OS-level global shortcut, and CI runners have no
microphone. When `WAYPOINT_E2E=1`, the main process therefore exposes a `__waypoint`
global with `showCapture`, `hideCapture`, `trayClick`, `isCaptureVisible`, `hotkeyRegistered`,
`undoableId`, `undoLatest`, and `fakeDictation`.

**Accepted on these conditions**, reviewed under T080:

- It is gated on an environment variable, so a shipped build exposes nothing.
- It exposes **no new capability** — every entry calls a function the hotkey, tray, or
  IPC handlers already call. It cannot bypass a domain rule; `fakeDictation` still runs the
  real `CaptureService.transcribe`, so the no-speech mapping and the "never write a
  transcript" guarantee are exercised, not stubbed.
- It substitutes only for the OS boundary (global shortcut delivery, microphone hardware),
  which is the part a test genuinely cannot drive.

If a future client needs the same access non-test, it belongs in a real contract rather than
this seam.

## Explicitly absent channels

These are omitted on purpose; adding any of them would move domain logic into the client:

| Not provided | Why |
|---|---|
| `inbox:write` / raw file access | Only the core writes to the inbox |
| `capture:submitTranscript` | Would let a transcript reach disk unseen, breaking FR-007 |
| Any channel accepting a caller-supplied `capturedAt` | Timestamps are core-assigned (FR-012) |
| Any list/read/sort/tag channel | Out of scope for capture (FR-018); Feature 2 owns reading |
