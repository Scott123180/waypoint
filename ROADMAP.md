# Waypoint Roadmap

This file is context for future spec/plan steps — not part of the constitution
(which stays principle-level) and not a feature spec itself. Paste relevant
sections into `/speckit.plan` or `/speckit.specify` prompts when a feature
needs awareness of the larger architecture or what comes before/after it.

## Architecture

Waypoint is built as **one shared core library** with **multiple thin clients**
on top. The core holds all domain logic (capture, sort, projects, milestones,
review ritual, staleness rules); clients contain no domain logic of their own.

Clients, in order of arrival:
1. **Electron GUI** — the primary interface (macOS + Linux)
2. **Local HTTP/JSON API** — added once core logic is stable; lets other
   tools (including an AI agent) call the same verbs the GUI uses
3. **AI agent integration** — consumes the local API; not a separate
   implementation, just another API client

All clients share the same vocabulary: projects, areas, waiting-for, top-three,
capture, sort, review. No client invents its own concepts (constitution
principle 7).

## Data model

Plain-text, git-tracked, stored **outside** the application repo:
- `inbox.md` — raw, unsorted capture
- `projects/<slug>.md` — one file per project (outcome, milestones, next
  action, DRI, status), plus an `## Unprocessed` section holding items
  dropped in by sort that have not been shaped into structure yet
- `areas/<slug>.md` — one file per area (no end state), same
  `## Unprocessed` section
- `waiting.md` — delegated items, owner, date, staleness flag at 7+ days
- `calendar.md` — items flagged as needing a calendar entry; text, capture
  timestamp, and the date flagged. A staging list only — nothing here syncs
  with a real calendar until a later feature does the integration
- `trash.md` — soft-deleted items, append-only. Sorting is fast and has no
  undo, so discarding is recoverable by hand rather than destructive
- `log/YYYY-WW.md` — weekly review notes, auto-created

## Feature sequence

- [ ] **Feature 1 — Quick capture** (text + voice, offline whisper.cpp,
      transcript shown back with edit/undo, raw items appended to inbox.md)
- [x] **Feature 2 — Inbox view + sort** (walk inbox items one at a time,
      route to project / area / waiting-for / trash / calendar, empties
      inbox to zero)
- [ ] **Feature 3 — Projects with milestones** (outcome, 2–4 milestones,
      next action, DRI, status; definition of done includes who verifies).
      Also owns draining `## Unprocessed` — turning the raw items Feature 2
      dropped into a project into actual structure
- [ ] **Feature 4 — Top-three / WIP limit** (1–3 outcomes per week; refuses
      a 4th active project until one is done or explicitly dropped)
- [ ] **Feature 5 — Weekly review ritual** (scripted: inbox must be zero,
      per-project status update, stale waiting-for check, set next week's
      top three, writes to log/YYYY-WW.md)
- [ ] **Feature 6 — Achievement / retrospective view** (every milestone and
      project completed within a given date range, across all projects, so
      the user can see what they actually got done — year-end reviews,
      performance conversations, 1:1s. Reads the completion dates Feature 3
      records when a milestone or project is marked done; captures nothing
      new of its own)
- [ ] **Feature 7 — Local HTTP/JSON API** (exposes core verbs so non-GUI
      clients, including an AI agent, can call capture/sort/review/etc.)
- [ ] **Feature 8 — LLM-assisted inbox organization** (splits messy
      dictated streams into distinct items, suggests project/area/
      waiting-for placement; suggest-don't-decide, human confirms during
      sort; built as a client of the API, not baked into the core)
- [ ] **Feature 9 — Daily shutdown** (2-minute end-of-day: view top-three +
      due waiting-for follow-ups, capture loose threads). Calendar-flagged
      items carry a flag date so this feature can surface the ones left
      unscheduled too long, the same way waiting-for goes stale

## Known gaps

Real defects found in shipped behaviour, kept here rather than in a feature
spec because each one is a fix to something that already exists.

- [ ] **Dictation does not survive losing focus** — the capture box hides on
      blur (clicking any other window), but hiding does not stop the
      recording. Verified against the running app: after the window hides the
      renderer stays in `recording`, the level meter keeps moving, and the
      microphone stays live on a window nobody can see. Reopening with either
      hotkey then sends `capture:reset`, which tears the recording down and
      clears the box — so everything said before clicking away is silently
      discarded, and there is no way back to the in-progress dictation.
      Three things are tangled here and a fix should say which it is doing:
      (a) hide-on-blur while recording, (b) what happens to audio already
      captured when the box goes away — discarding it is the current answer
      and the wrong one, transcribing it into the reopened box is probably
      the right one, (c) Enter/Esc only reach the box while it has focus, so
      a recording that has lost focus cannot be stopped from the keyboard at
      all. A global accelerator registered only while recording would fix
      (c), at the cost of taking a key combination system-wide for the
      duration. The privacy angle makes this more than an annoyance: a live
      microphone with no visible indicator is exactly what the Escape path
      already refuses to leave behind.

## Key decisions log

- **Public repo** — portfolio piece, not monetized. If ever productized,
  fork private and harden separately.
- **Build machine rule** — all development happens on personal Ubuntu
  machine only. Work MacBook M4 never runs npm/pip installs or compiles
  anything (some corporate libraries are blocked). macOS builds are
  produced by GitHub Actions on a macOS runner and shipped as release
  artifacts; the work machine only downloads finished builds. This is
  free for public repos (no private-repo minute multiplier applies).
- **whisper.cpp over faster-whisper** — faster-whisper's Python/CTranslate2
  dependencies are exactly what gets blocked at work; its throughput
  advantage only matters for batch transcription, not short dictation
  captures. whisper.cpp is C++, dependency-light, and compiles to a
  self-contained binary.
- **Model size: `small.en`** — better accuracy than `base.en`/`tiny.en`,
  still fast enough on M4 for short capture clips; the trade-off is a
  larger bundle (~500MB), accepted deliberately.
- **Capture vs. organize kept separate** — capture is always raw and
  dumb (GTD principle); any LLM-assisted organizing is a distinct later
  feature (Feature 8), not part of capture itself.
- **Trash is a soft delete** — sort has no undo and runs fast, so the one
  irreversible choice in the flow would be the one you make by mis-clicking.
  Items go to `trash.md` instead. It grows without bound; pruning is
  deliberately nobody's job yet.
- **Hand-written inbox lines are first-class items** — the inbox is a file
  the user is expected to edit, so a line typed by hand sorts exactly like a
  captured one (no timestamp, and none invented). Inbox zero means the file
  is genuinely clear, not just clear of app-written lines — which matters
  because Feature 5 gates on it.
- **Sort verifies before it writes** — the inbox may be open in an editor at
  the same time, so a decision re-checks the item still matches disk and
  refuses on mismatch, mirroring capture's undo tail verification. Refusing
  is recoverable; writing stale text into a project is not.
- **Completed milestones stay on the project** — finishing a milestone does
  not hide it, and the completion date is written down permanently rather
  than discarded once the work is done. The history sitting on disk is what
  makes the retrospective view (Feature 6) possible with no extra capture
  step asked of the user.
- **Views react to an inbox-changed signal** — an open view must reflect
  changes to its underlying data that happen while it is open. Any client
  that writes to the inbox raises a generic inbox-changed signal, and views
  react to that rather than requiring a close and reopen. This is what lets
  the local API (Feature 7) and the LLM organization layer (Feature 8) write
  to the inbox from outside the GUI without leaving a stale view on screen.