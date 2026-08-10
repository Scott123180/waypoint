# Quickstart: Validating Quick Capture

**Feature**: 001-quick-capture | **Date**: 2026-08-09

How to run the feature and prove it actually works. Scenario numbers map to the acceptance
scenarios in [spec.md](spec.md).

---

## Prerequisites

| Requirement | Note |
|---|---|
| **Node 22 LTS via nvm** | Already installed (v22.22.1). Run `nvm use` in the repo — `.nvmrc` pins it. The system `node` on PATH is 18.19.1 (EOL), so a shell that hasn't sourced nvm will pick up the wrong version. |
| Linux x64 dev machine | Per ROADMAP, all development happens here. The work MacBook never compiles or installs. |
| A working microphone | Voice scenarios only |
| ~500 MB free space | whisper `small.en` model |

```bash
npm install
./scripts/fetch-whisper.sh    # pinned whisper.cpp build + checksum-verified model → resources/
```

`resources/` is gitignored. Nothing here is committed.

---

## Run the test suite (this is the primary gate)

TDD is mandatory (Principle I), so the suite is the real acceptance check — the manual scenarios
below only confirm the pieces are wired together on a real desktop.

```bash
npm test                  # core unit + contract tests (node:test, no deps, fast)
npm run test:e2e          # Playwright _electron desktop tests
npm run test:whisper      # opt-in; needs the real model, skipped by default
```

Expected: core tests run in well under a second — that speed is what makes the red-green-refactor
loop survivable.

CI runs both `npm test` and `npm run test:e2e` (the latter under `xvfb-run`), so the latency
assertion catches regressions automatically. Treat CI timings as a regression signal only — the
authoritative <100ms measurement is scenario 2 on real hardware.

---

## Run the app

```bash
npm run dev               # Electron with the capture window pre-warmed and hidden
```

The app starts as a background process with no visible window. That is correct — the capture box
appears on the hotkey.

---

## Manual validation scenarios

### 1. Instant text capture (US1 · FR-001, FR-003, FR-011, FR-013)

1. Focus a completely different application (browser, terminal).
2. Press `Ctrl+Shift+Space`.
3. **Expect**: the capture box appears immediately with the cursor already in the text field. No
   click needed, no visible loading.
4. Type `test thought one` and press Enter.
5. **Expect**: the box clears and disappears at once.
6. `cat ~/waypoint/inbox.md`

**Expect** a line matching [contracts/inbox-format.md](contracts/inbox-format.md):

```markdown
- 2026-08-09T14:23:05-04:00 test thought one
```

### 2. Latency budget (SC-001 · <100 ms)

```bash
WAYPOINT_TRACE_LATENCY=1 npm run dev
```

Trigger the hotkey several times and read the logged hotkey→focus duration. **Expect** every sample
under 100 ms. Also asserted in the E2E suite so it does not silently regress.

### 3. Empty submit is rejected (FR-017)

Open the box, press Enter with nothing typed. **Expect**: no new line in `inbox.md`, and the box
does not create a blank entry.

### 4. Duplicate trigger is ignored (FR-003a)

Open the box, type `half a thought`, then press the hotkey again **without** submitting.
**Expect**: the same box, still showing `half a thought`. No second window, no cleared input.

### 4a. Dictate hotkey and state feedback (FR-001a, FR-005a, FR-005b)

1. Press `Ctrl/Cmd+Shift+Space` from another app. **Expect**: the box opens **already listening** —
   a red dot, the word `Listening`, a level meter, and a running timer, with no click needed.
2. Speak. **Expect**: the meter moves with your voice. Now mute the microphone at the OS level and
   speak again — **expect** the meter to sit still. That contrast is the whole point of the meter:
   a silent mic is visible before you finish talking, not after.
3. Press Stop. **Expect**: the footer changes to `Transcribing…` with a moving indeterminate bar,
   visibly different from the recording state, and showing **no percentage**.
4. While each of those states is showing, type something. **Expect**: the text field accepts it
   throughout (FR-005b).
5. Press `Ctrl/Cmd+Shift+Enter` instead. **Expect**: the box opens for typing with the microphone
   untouched — `data-state` idle, no meter.
6. With the box open and text typed, press `Ctrl/Cmd+Shift+Space`. **Expect**: recording starts and
   the typed text is still there (FR-003a).

### 5. Offline voice capture (US2 · FR-005, FR-006)

1. **Disconnect the network entirely** — this is the point of the test. On this machine:
   `nmcli networking off`, and `nmcli networking on` afterwards.
2. Open the box, press the dictate control, speak a sentence, stop.
3. **Expect**: transcribed text appears **in the box**, not in the file. Nothing has been saved yet.
4. Press Enter. **Expect**: it lands in `inbox.md`, formatted identically to a typed item.

Confirm no audio was written anywhere:

```bash
find ~ /tmp -name '*.wav' -newermt '-5 minutes' 2>/dev/null   # expect: no results (FR-006a)
```

### 6. Transcript is reviewable before storage (US3 · FR-007, FR-008)

Dictate, then edit a word in the box before submitting. **Expect**: the **edited** text is what
appears in `inbox.md` — the original transcription never reaches the file.

### 7. Undo a dictated capture (FR-009)

Dictate, submit, then invoke undo while the box/undo affordance is still available. **Expect**: the
item is gone from `inbox.md` and the file is otherwise byte-identical to before.

### 8. Undo refuses after a hand-edit (R5 — the safety case)

1. Dictate and submit.
2. **Before** undoing, open `inbox.md` in a text editor, add a line by hand, and save.
3. Invoke undo.

**Expect**: undo is **refused** with a clear reason, the hand-added line is untouched, and the
captured text is shown so it is still recoverable. Undo must never delete content it cannot verify.

### 9. Hand edits survive capture (FR-016 · SC-006)

1. Hand-edit `inbox.md`: reorder items, reword one, add a heading and a blank line.
2. Capture a new thought.
3. **Expect**: the new item is appended at the end and **every hand edit is preserved exactly**.
   Nothing is reformatted or "corrected".

### 10. No organizing prompt (FR-014 · SC-007)

Across every capture above: **expect** at no point any prompt for a tag, project, category, or
title. Capture asks for nothing but the thought.

### 11. In-app entry point works without the hotkey (FR-002)

The app runs as a background agent with no dock icon, so the tray/menu-bar icon is the only other
way in — and the **only** way in at all if the hotkey is unavailable.

1. Click the tray/menu-bar icon (or choose "Capture" from its menu).
2. **Expect**: the same capture box appears, focused and ready, exactly as via the hotkey.
3. Now simulate a hotkey conflict — set `hotkey` in the config to a combination another app already
   owns, and restart.
4. **Expect**: a visible notice that the combination is taken, **and** the tray icon still opens the
   capture box. The app must never become unreachable because a hotkey failed to register.

### 12. Correction never blocks the next capture (FR-010 · SC-005)

1. Dictate a thought and submit it.
2. **Immediately** trigger the next capture, without acknowledging, dismissing, or waiting on any
   undo affordance.

**Expect**: the new capture box opens at once, empty and focused. Nothing about the correction
opportunity — the undo affordance, a transcript notice, a confirmation — may stand between the user
and the next thought.

---

## Packaged build validation (CI artifacts only)

Per the ROADMAP build-machine rule, macOS builds come from GitHub Actions and the work machine only
downloads finished artifacts — it never compiles or installs.

1. Push a tag; the release workflow builds `macos-14` (arm64) and `ubuntu-latest` (x64).
2. Download the macOS artifact on the MacBook.
3. First launch: unsigned build requires a Gatekeeper bypass (right-click → Open). Signing and
   notarization are deliberately deferred (R10).
4. Grant the microphone prompt on first dictation.
5. Re-run scenarios 1, 5, 9, and 11 against the packaged app **with the network off** to confirm the
   bundled model works with no download and no cloud call (Principle III).

---

## What is deliberately not here

No viewing, searching, sorting, tagging, or project routing (FR-018). If you find yourself wanting
to validate those, that is Feature 2 in the [ROADMAP](../../ROADMAP.md), not this feature.
