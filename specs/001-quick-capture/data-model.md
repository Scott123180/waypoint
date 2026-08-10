# Phase 1 Data Model: Quick Capture (Text & Voice)

**Feature**: 001-quick-capture | **Date**: 2026-08-09

All entities below live in `packages/core`. The Electron client never constructs them directly —
it passes raw user input in and renders what comes back (Principle II).

---

## CaptureItem

One captured thought. Created by the core, appended to the inbox, never mutated after it is written.

| Field | Type | Persisted | Rules |
|---|---|---|---|
| `id` | `string` (UUID v4) | **No** — in-memory only | Correlates submit → undo within a session. Deliberately not serialized: capture stores raw (FR-014) and an id in the file would be metadata the user did not ask for and would have to hand-maintain. |
| `text` | `string` | Yes | Required. Trimmed. MUST be non-empty after trimming (FR-017). Preserved verbatim otherwise — no capitalization, punctuation, or reflow fixes. |
| `capturedAt` | `Date` | Yes | Set by the core at creation, never supplied by a client. Serialized as ISO 8601 with local UTC offset (R6, FR-012). |
| `source` | `'typed' \| 'dictated'` | **No** — in-memory only | Drives whether the post-submit undo affordance is offered (FR-009 scopes undo to dictated captures). Not persisted; the inbox makes no distinction between a typed and a spoken thought. |

**Validation rules**
- `text` empty or whitespace-only → rejected with `EmptyCaptureError`; no item is created, nothing is
  written (FR-017, FR-017a).
- No maximum length. A long dictated stream is still one raw item; splitting it is Feature 7's job,
  explicitly not capture's (ROADMAP key decision).
- No tags, project, area, status, or priority fields exist on this entity **by design**. Capture
  never asks the user to organize (FR-014), so it has nothing to store.

**Lifecycle**

```text
                submit (text non-empty)          undo (tail verified)
draft in box ──────────────────────────► appended ──────────────────────► removed
     │                                       │
     │ submit (empty) → rejected             │ undo window expires
     ▼                                       ▼
  stays open                              permanent
```

The undo window opens at append and closes when the capture box closes or the next capture begins,
whichever comes first (R5).

---

## Inbox

The append-only plain-text file of all captured items. There is exactly one per user.

| Property | Value |
|---|---|
| Location | `~/waypoint/inbox.md` by default; `inboxPath` in config overrides |
| Format | Markdown list, one item per list entry (see [contracts/inbox-format.md](contracts/inbox-format.md)) |
| Ordering | Chronological by append. New items always go at the end (FR-011). |
| Access mode | Append-only (`O_APPEND`) during capture; full-file rewrite is **never** performed |
| Concurrency | Safe against a concurrent hand-edit in a text editor; appends never clobber user edits (FR-016) |

**Invariants**
- The core never rewrites or reformats existing lines. Anything already in the file — including text
  a human typed by hand that does not match our format — is left byte-for-byte alone.
- The file is valid and useful with no application running (Principle IV, SC-006).
- A missing file or missing parent directory is created on demand and never fails a capture.

**Not modeled**: parsing the inbox back into `CaptureItem`s. Capture only appends. Reading and
walking items is Feature 2 (inbox view + sort) and is out of scope here (FR-018).

---

## UndoToken

In-memory record that makes a safe undo possible. Held by the core, never persisted, never crosses
to the client as anything but an opaque id.

| Field | Type | Purpose |
|---|---|---|
| `itemId` | `string` | The `CaptureItem.id` this token undoes |
| `serializedBlock` | `string` | The exact bytes appended, used to verify the file tail still matches |
| `offsetBefore` | `number` | File length in bytes before the append; the truncation target |
| `expiresOn` | `'box-close' \| 'next-capture'` | Window scope per R5 |

**Rules**
- Exactly one token is live at a time — the most recent capture only.
- Undo verifies `serializedBlock` is still the file's exact tail before truncating to `offsetBefore`.
  On any mismatch it **refuses** and reports why, rather than deleting content it cannot account
  for (R5). Refusal is a safe outcome; a wrong deletion is not.

---

## TranscriptionRequest / TranscriptionResult

Crosses the core's `TranscriptionPort` boundary. Neither is persisted.

| Entity | Field | Type | Rules |
|---|---|---|---|
| `TranscriptionRequest` | `wav` | `Uint8Array` | 16 kHz mono 16-bit PCM in a WAV container. Held in memory only; MUST NOT be written to disk at any point (FR-006a). Released as soon as transcription returns. |
| `TranscriptionResult` | `text` | `string` | Empty or whitespace-only result is a valid outcome meaning "nothing intelligible" — the core surfaces it as `NoSpeechDetected`, and no item is created (FR-017a). |

**Rule enforced in core, not in the client**: a `TranscriptionResult` is never appended to the inbox
directly. It only ever populates the editable capture box, so the user always sees transcribed text
before it becomes an item (FR-007, FR-008). The client has no code path that can write a transcript
straight to disk.

---

## Configuration

| Key | Type | Default |
|---|---|---|
| `inboxPath` | `string` | `~/waypoint/inbox.md` |
| `hotkey` | `string` | `CommandOrControl+Shift+Space` |
| `whisperModelPath` | `string` | bundled `resources/whisper/ggml-small.en.bin` |

Stored as JSON at the platform config directory (R7). Absent file or absent key falls back to the
default; a malformed file is reported and defaults are used rather than blocking startup — capture
must survive a bad config.
