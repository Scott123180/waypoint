# Contract: Core Module Public API

**Package**: `@waypoint/core` | **Feature**: 001-quick-capture

This is the complete surface the core exposes for capture. Every rule in the feature spec is
enforced behind this boundary. Any client — the Electron GUI now, the local HTTP API in Feature 6,
an AI agent in Feature 7 — calls exactly these verbs and gets identical behaviour (Principles II
and VII).

The core imports nothing from Electron and touches no platform globals. It is plain Node.

---

## Ports (implemented by the client/adapter layer, injected into the core)

```ts
/** Appends bytes to the inbox and reports where they landed. Adapter owns the filesystem. */
interface InboxStore {
  /** Atomically appends. Resolves with the file length BEFORE this append. Creates the file
   *  and parent directories if absent. Never rewrites existing content. */
  append(block: string): Promise<{ offsetBefore: number }>;

  /** Reads the current byte length, for undo tail verification. */
  size(): Promise<number>;

  /** Reads the trailing `byteCount` bytes, for undo tail verification. */
  readTail(byteCount: number): Promise<string>;

  /** Truncates the file to `length`. Used only by a verified undo. */
  truncate(length: number): Promise<void>;
}

/** Turns spoken audio into text. Adapter owns the whisper.cpp subprocess. */
interface TranscriptionPort {
  /** @param wav 16 kHz mono 16-bit PCM in a WAV container, in memory only.
   *  @throws TranscriptionFailedError on subprocess failure. */
  transcribe(wav: Uint8Array): Promise<string>;
}

/** Injected so tests control time and items get deterministic timestamps. */
interface Clock {
  now(): Date;
}
```

---

## CaptureService

```ts
class CaptureService {
  constructor(deps: {
    inbox: InboxStore;
    transcription: TranscriptionPort;
    clock?: Clock;          // defaults to system clock
  });
```

### `submit(text: string, source: 'typed' | 'dictated'): Promise<SubmitResult>`

Creates a `CaptureItem` and enqueues its append.

```ts
type SubmitResult = { id: string; capturedAt: Date };
```

- **Returns as soon as the item is created and the write is enqueued — does NOT await the disk
  write.** This is the contract that makes Principle VI and FR-010 achievable; a client cannot
  restore non-blocking behaviour if the core blocks here.
- Trims `text`. Throws `EmptyCaptureError` if empty after trimming — no item, no write (FR-017).
- Sets `capturedAt` from the clock. Clients cannot supply a timestamp (FR-012).
- Appends are serialized internally: submit order is inbox order, always (FR-011).
- Opens the undo window for this item, closing any previous one.

### `undo(id: string): Promise<UndoResult>`

```ts
type UndoResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'file-changed' | 'unknown-id' };
```

- Verifies the file's tail still exactly matches what was appended, then truncates (R5).
- `file-changed` when the tail no longer matches — the user hand-edited the file, or another
  capture landed after. **Refuses rather than deleting content it cannot account for.** Callers
  MUST surface the refusal with the item's text so the thought stays recoverable.
- `expired` once the window closed (box closed or next capture began).
- Never throws for a normal refusal; failure is a value, because refusing is an expected outcome.

### `transcribe(wav: Uint8Array): Promise<TranscribeResult>`

```ts
type TranscribeResult =
  | { status: 'ok'; text: string }
  | { status: 'no-speech' }
  | { status: 'failed'; message: string };
```

- Delegates to `TranscriptionPort`, then applies the domain rules.
- Empty/whitespace-only output becomes `no-speech` — not an error, and **not** an item (FR-017a).
- **Never writes to the inbox.** A transcript can only reach storage by being placed in the capture
  box and then submitted, guaranteeing the user saw it (FR-007, FR-008). There is no API on this
  service that appends a transcript directly, so no client can bypass the review step.
- Does not persist `wav` and holds no reference to it after returning (FR-006a).

### `flush(): Promise<void>`

Drains the pending append queue. Called on app quit so a normal shutdown never loses a queued
item (R4). Not called on the capture hot path.

---

## Errors

| Error | Thrown when | Client must |
|---|---|---|
| `EmptyCaptureError` | `submit` receives empty/whitespace text | Keep the box open; show nothing alarming |
| `TranscriptionFailedError` | whisper subprocess fails or exits non-zero | Show a notice; keep box open and typed text intact |
| `InboxWriteError` | Append fails after one retry | Show a **persistent** notice including the raw text so it is recoverable by copy/paste. Never discard it. |

---

## Guarantees the core owns (and clients therefore cannot get wrong)

1. Timestamps are core-assigned; no client invents a capture time.
2. Empty input never produces an item.
3. Inbox order matches submit order.
4. **Capture** never rewrites or reformats existing inbox bytes; it only appends.
   *Amended by Feature 2.* This originally read "existing inbox bytes are never rewritten" full stop,
   which was accurate while capture was the only writer. Sorting removes an item from the middle of the
   file, which no append can express, so `FsInboxDocument` rebuilds the file and renames it into place.
   The half of the promise that still holds absolutely is the one that matters to the user: **nothing
   reformats what they wrote.** An unsorted line comes through a sort byte-for-byte identical, asserted in
   `sort-preservation.test.ts`. Both writers share one in-process mutex, so a capture can never be lost to
   a concurrent rewrite (see 002's research R4a).
5. Undo never deletes unverified content.
6. A transcript is never stored without passing through the user-visible box.
7. Audio is never persisted.
