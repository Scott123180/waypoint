# Feature Specification: Quick Capture (Text & Voice)

**Feature Branch**: `001-quick-capture`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "I want a quick-capture feature with both text and voice input. When I open the app, or trigger it with a global hotkey from anywhere, a small capture box appears immediately, ready for input without me clicking anything. I can either type a thought, or press to dictate and have my speech transcribed using local, offline speech-to-text. When I dictate, the transcribed text is always shown back to me before or immediately after it's saved, with a quick way to edit or undo, so a wrong transcription is never stored without my awareness. This should not slow capture down — the correction opportunity is there if I need it, but I can move straight to the next thought. When I submit, the thought is saved as a new item at the end of my inbox, timestamped with when it was captured. After submitting, the box clears and closes, ready for the next capture. Capture never asks me to categorize, tag, or organize the thought — it stores it raw and instantly. The inbox is a plain-text file I can also open and edit by hand. This feature does not include viewing, editing, sorting, or organizing captured items beyond the transcription correction described above — only creating them, by text or voice."

## Clarifications

### Session 2026-08-09

- Q: After speech is transcribed to text, should the raw audio recording be discarded immediately, or kept somewhere? → A: Discard immediately — audio is processed in-memory only and never written to disk; only the resulting text is stored.
- Q: What's the maximum acceptable time from pressing the hotkey to the capture box being ready for input? → A: Under 100ms.
- Q: If the user presses the global capture hotkey while a capture box is already open with unsaved input, what should happen? → A: Ignore the second trigger — the existing open box and its in-progress input are left untouched.
- Q: When dictation produces no usable text (e.g., silence or unintelligible audio), what should the capture box do? → A: Show empty input, let user retry or type — the box stays open with no text filled in and no item is saved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Instant Text Capture (Priority: P1)

A user has a thought they want to record before it slips away. They trigger capture — either by opening the app or pressing a global hotkey from any other application — and a small capture box appears immediately with the text input already focused. They type the thought and submit. The item is appended to their inbox with a timestamp, and the box clears and closes, ready for the next capture.

**Why this priority**: This is the core value of the feature and the simplest path to it. Every other capability (voice, correction) is additive to this flow. Without fast, frictionless text capture, the feature has no reason to exist.

**Independent Test**: Can be fully tested by triggering the hotkey from another application, typing a thought, and submitting — delivers a working end-to-end capture with no dependency on voice input.

**Acceptance Scenarios**:

1. **Given** the user is in any other application, **When** they press the global capture hotkey, **Then** a capture box appears within the capture time budget with the text input focused and ready for typing, with no click required.
2. **Given** the capture box is open with typed text, **When** the user submits, **Then** the thought is appended to the end of the inbox with a capture timestamp, and the capture box clears and closes.
3. **Given** the capture box is open, **When** the user submits empty input, **Then** no item is added to the inbox and the box remains open or closes without creating a blank entry.

---

### User Story 2 - Offline Voice Capture (Priority: P2)

A user's hands are busy, or typing is inconvenient, so they want to speak their thought instead. They trigger capture, press to dictate, and speak. Their speech is transcribed entirely offline (no network round-trip) into the capture box. They submit and the transcribed thought is appended to the inbox exactly like a typed one, with no extra step to categorize it.

**Why this priority**: Voice is the feature's second input modality and delivers value independently of text capture, but the feature is still useful (per User Story 1) without it — hence P2.

**Independent Test**: Can be fully tested by triggering capture, dictating a thought with no network connection available, and confirming the transcribed text is appended to the inbox — delivers voice-driven capture independent of the text path.

**Acceptance Scenarios**:

1. **Given** the capture box is open, **When** the user presses to dictate and speaks, **Then** their speech is transcribed to text using on-device processing only, with no data leaving the device.
2. **Given** the user dictates while offline (no network connection), **When** they finish speaking, **Then** transcription completes successfully and produces the same result as it would online.
3. **Given** a dictation produces transcribed text, **When** the user takes no corrective action, **Then** the transcribed text is submitted to the inbox as-is, identical in form to a typed entry.

---

### User Story 3 - Review and Correct a Transcription (Priority: P3)

After dictating, the user is shown the transcribed text and, before moving to the next thought, can quickly edit a misheard word or undo the capture entirely if the transcription is wrong — without that check slowing down the pace of capture.

**Why this priority**: This protects data quality for voice input specifically. It depends on User Story 2 existing, and the core capture value already exists without it — hence lowest priority, though the constitution treats "never storing an unreviewed wrong transcription" as a hard requirement of the voice path itself.

**Independent Test**: Can be fully tested by dictating a thought, verifying the transcribed text is visibly displayed, editing a word, and confirming the corrected version — not the original — is what lands in the inbox; separately, testing that invoking undo immediately after a dictated capture removes that item from the inbox.

**Acceptance Scenarios**:

1. **Given** the user has just dictated a thought, **When** transcription completes, **Then** the transcribed text appears in the editable capture box before anything is saved, inserted at the cursor without replacing text already typed.
2. **Given** the transcribed text is displayed, **When** the user edits it, **Then** the corrected text — not the original transcription — is what ends up in the inbox.
3. **Given** a dictated thought has just been captured, **When** the user invokes undo, **Then** that item is removed from the inbox and no longer present when the inbox file is inspected.
4. **Given** the user dictates and takes no corrective action, **When** they immediately begin the next capture, **Then** the previous capture is not blocked, delayed, or held open waiting for review.

---

### Edge Cases

- When the capture box is triggered while it is already open, the second trigger is ignored and the existing box with its in-progress input is left untouched (see FR-003a).
- When speech-to-text produces empty or unintelligible output (e.g., silence, background noise only), the capture box stays open with empty input and no item is saved (see FR-017a).
- What happens when the user starts dictating, then also types before or during transcription?
- What happens when the inbox file is missing, has been moved, or was hand-edited into an invalid state at the moment a new capture tries to append to it?
- What happens when undo is invoked after the user has already started a new capture (i.e., the correction window has passed)?
- What happens when the global hotkey is pressed but the operating system has assigned that combination to something else, or the capture service isn't running?
- What happens when dictation is interrupted (e.g., microphone becomes unavailable mid-recording)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a global hotkey that, when pressed from any application, opens the capture box.
- **FR-001a**: The system MUST provide a **second** global hotkey that opens the capture box and begins dictation in one action, so that a spoken capture requires no click after the trigger. Both hotkeys MUST be independently configurable, and failure to register either one MUST NOT prevent the other, or the in-app entry point (FR-002), from working.
- **FR-002**: The system MUST also allow capture to be opened directly from the application itself.
- **FR-003**: The capture box MUST appear with its text input already focused and ready to receive input, requiring no click or additional action from the user to begin typing, within 100ms of the trigger (hotkey press or app open). This budget covers the box appearing; acquiring the microphone for FR-001a is permitted to complete after it, provided FR-005a makes the wait visible.
- **FR-003a**: If a hotkey is pressed while a capture box is already open with in-progress input, the system MUST leave the open box and its unsaved input untouched. The dictation hotkey MAY additionally begin dictation in that already-open box, since starting to record neither clears nor replaces what the user has typed.
- **FR-004**: The system MUST allow the user to type a thought as plain text.
- **FR-005**: The system MUST allow the user to trigger dictation from within the capture box and have their speech converted to text.
- **FR-005a**: While dictation is in progress the system MUST continuously distinguish, without the user acting, between **acquiring the microphone**, **recording**, and **transcribing**. The recording indication MUST include a live signal derived from the incoming audio, so that a muted or wrongly-selected input device is apparent before the user finishes speaking rather than after. The transcribing indication MUST convey that work is ongoing without asserting a completion percentage, since the transcriber cannot report true progress for capture-length audio.
- **FR-005b**: None of the indications in FR-005a may block typing. The text input MUST remain focused and editable throughout recording and transcription, so that a user who gives up on dictation can simply type (supports FR-010, FR-017a).
- **FR-006**: Speech-to-text transcription MUST be performed entirely on-device, with no dependency on network availability or an external service.
- **FR-006a**: Raw audio captured for dictation MUST be processed in-memory only and discarded immediately after transcription completes; audio MUST NOT be written to disk or retained anywhere, including alongside the resulting inbox item.
- **FR-007**: The system MUST display the transcribed text to the user in the editable capture box **before** the associated item is saved, so that no transcription can become an inbox item without having been shown. The transcript is never submitted automatically.
- **FR-008**: The system MUST allow the user to edit the transcribed text, and if edited, the edited version (not the original transcription) MUST be what is stored.
- **FR-009**: The system MUST allow the user to undo a just-completed dictated capture, removing it from the inbox, for at least as long as the capture box remains open or until the next capture begins.
- **FR-010**: The review/correction opportunity for a dictated capture MUST NOT block, delay, or require action before the user can begin the next capture.
- **FR-011**: On submit, the system MUST append the captured thought as a new item at the end of the inbox.
- **FR-012**: Each captured item MUST be stored with a timestamp reflecting when it was captured.
- **FR-013**: After a successful submit, the capture box MUST clear its contents and close, ready to be reopened for the next capture.
- **FR-014**: The system MUST NOT prompt the user to categorize, tag, title, or otherwise organize a thought at capture time.
- **FR-015**: The inbox MUST be stored as a plain-text file that a user can open and edit directly with an ordinary text editor, independent of the application.
- **FR-016**: Manual edits made directly to the inbox file MUST be preserved and respected the next time the application reads or appends to it (a hand-edit must not be silently discarded or corrupted by the next capture).
- **FR-017**: Submitting empty input (no typed text and no successful transcription) MUST NOT create a new inbox item.
- **FR-017a**: If dictation produces no usable text (e.g., silence or unintelligible audio), the capture box MUST remain open with empty input, allowing the user to retry dictation or switch to typing, without saving any item.
- **FR-018**: The system MUST NOT provide viewing, editing, reordering, or organizing of previously captured items as part of this feature, beyond the immediate correction of a just-dictated item described in FR-008 and FR-009.

### Key Entities

- **Inbox**: The single, ordered, plain-text store of all captured thoughts, appended to over time. Human-readable and hand-editable at rest; the application must remain able to append to it correctly even after manual edits.
- **Captured Item**: One entry in the inbox, consisting of the raw thought (as typed or as transcribed/edited) and the timestamp of when it was captured. Carries no category, tag, or organizational metadata, and no reference to the source audio (which is never persisted).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From pressing the global hotkey to the capture box being ready for typed input, less than 100ms elapses (capture feels instant, not loaded).
- **SC-002**: A user can capture a typed thought, from trigger to the box closing again, in a single unbroken motion with no required intermediate clicks (trigger → type → submit).
- **SC-003**: Voice capture produces correctly usable transcribed text without any network connection present, in 100% of tested offline sessions.
- **SC-004**: Zero instances of a transcription being stored without the user having had a visible opportunity to review and correct it — every dictated transcript is displayed in the editable capture box before it can be saved.
- **SC-005**: The correction opportunity adds no required waiting step for users who don't need it — a user who dictates and immediately starts a new capture is never blocked from doing so.
- **SC-006**: 100% of captured items, whether typed or dictated, are recoverable by opening the inbox file in a plain-text editor with no application running.
- **SC-007**: Capture never presents a categorization, tagging, or organizing prompt — verified across all capture sessions in testing.
- **SC-008**: At no point between triggering dictation and the transcript appearing is the user left with an unchanging screen — recording shows an audio-derived signal that responds to speech, and transcription shows continuous activity.

## Assumptions

- The "global hotkey" is configurable but ships with a sensible default; the operating system and capture service are assumed to support system-wide hotkey registration while the application (or a lightweight background listener) is running.
- **Two** hotkeys ship (FR-001a). The more prominent combination is assigned to **dictation**, on the observed grounds that voice is the mode this user reaches for most; typing gets the second. Both are configurable, so the assignment is a default rather than a constraint.
- Acquiring a microphone is not instantaneous, so a dictation hotkey can clip the first word if the user speaks immediately. This is accepted rather than designed away: holding the input device open continuously would make the recording indicator permanent and is a poor trade for a local-first tool. FR-005a's "acquiring" state exists to give the user a cue to speak after, not before.
- "Press to dictate" is treated as a simple start/stop toggle for recording (press once to start, press again — or a clear equivalent action — to stop), rather than requiring the key to be held down.
- FR-005a forbids a completion percentage on empirical grounds, not stylistic ones: whisper.cpp's `--print-progress` is computed against a padded 30-second window and reports nonsense below that length — measured at **185%** for a 16-second clip and **1090%** for a 2.8-second one. Transcription itself was measured at roughly 3–5 seconds for typical capture lengths, which is long enough that the absence of feedback reads as a hang.
- The correction/undo window for a dictated item remains open only for that specific item, only while the capture box is still open or until the next capture is started — it is not a general-purpose edit history for the inbox.
- The spec originally allowed showing the transcript either before or immediately after saving. Planning resolved this to **show-then-save**: the transcript only ever populates the editable capture box, and reaches the inbox solely via an explicit submit (FR-007). This is the stricter of the two options and makes "never stored unseen" structural rather than a matter of timing. Undo (FR-009) remains for the case where the user submits and only then notices the error.
- Speech-to-text language/accuracy tuning, supported languages, and model selection are implementation concerns outside the scope of this specification.
- This feature covers creation of inbox items only; any future viewing, searching, editing, or triaging of existing inbox items is explicitly out of scope and will be specified separately.
- The inbox file format (e.g., one line per item, a structured plain-text record per item) is an implementation detail deferred to planning, constrained only by the constitution's requirement that it remain human-readable and hand-editable markdown/plain-text.
