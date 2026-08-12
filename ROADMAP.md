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
- [ ] **Feature 6 — Local HTTP/JSON API** (exposes core verbs so non-GUI
      clients, including an AI agent, can call capture/sort/review/etc.)
- [ ] **Feature 7 — LLM-assisted inbox organization** (splits messy
      dictated streams into distinct items, suggests project/area/
      waiting-for placement; suggest-don't-decide, human confirms during
      sort; built as a client of the API, not baked into the core)
- [ ] **Feature 8 — Daily shutdown** (2-minute end-of-day: view top-three +
      due waiting-for follow-ups, capture loose threads). Calendar-flagged
      items carry a flag date so this feature can surface the ones left
      unscheduled too long, the same way waiting-for goes stale

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
  feature (Feature 7), not part of capture itself.
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