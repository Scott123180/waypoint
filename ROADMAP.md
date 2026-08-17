# Waypoint Roadmap

This file is context for future spec/plan steps — not part of the constitution
(which stays principle-level) and not a feature spec itself. Paste relevant
sections into `/speckit.plan` or `/speckit.specify` prompts when a feature
needs awareness of the larger architecture or what comes before/after it.

## Architecture

Waypoint is built as **one shared core library** with **multiple thin clients**
on top, plus **a separate policy module**. The core holds all domain logic
(capture, sort, projects, milestones, review ritual); clients contain no domain
logic of their own.

**Core and policy are separate modules.** Core defines what things are and what
may be done to them. Policy defines what should be allowed, discouraged, or
blocked. Core declares a set of **named decision points** — before a project's
status changes, before a milestone is marked done, before a review is closed —
and consults whatever policy module is registered at each one. A policy decision
returns **allow**, **warn**, or **block**, together with a reason the client can
display. Core does not know what the rules are; it knows only where rules are
consulted, and it contains no opinions about how the user should work.

Because policy plugs into core's decision points rather than wrapping core, no
client can reach underneath and bypass a rule another client enforces. All
clients get the same decision for the same action.

**Policy configuration lives with the data, not with the application** — stored
in the git-tracked data directory alongside projects, areas, and the inbox. Any
client opening that data directory therefore loads identical rules from the data
itself, so clients cannot disagree about policy, and rules travel with the data
across machines.

**Identity is core, not policy.** Core owns the answer to "is this DRI the
user?": it stores a canonical `me` value plus a list of aliases covering the ways
the user's own name may already have been written across existing projects, and
exposes a way to ask whether a given DRI refers to the user. Both forms are
supported — there is deliberately **no reserved `dri: me` convention**, because
that would require migrating existing projects, and because typing an actual name
while hand-editing a file in a text editor has to keep working. Identity
configuration also lives in the git-tracked data directory, for the same reason
policy configuration does, but in a **separate file**: they are separate
concerns, and identity outlives any given policy module.

Policy *consumes* core's identity answer rather than owning it. The WIP limit is
policy; resolving which DRI is the user is core. The weekly review, the
retrospective view, and the future LLM-assisted layer all need identity
resolution, and none of them should have to depend on the policy module or
duplicate the resolution.

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
- **policy configuration** — the rules the policy module enforces (WIP limit,
  milestone cap, staleness thresholds), living here rather than in application
  config so every client loads the same rules from the data itself. Filename
  and format are Feature 4's to decide
- **identity configuration** — the canonical `me` value and its aliases, in a
  **separate file** from policy configuration. Read by core, not by policy; a
  fact about this data directory rather than an opinion about how to work

## Feature sequence

- [ ] **Feature 1 — Quick capture** (text + voice, offline whisper.cpp,
      transcript shown back with edit/undo, raw items appended to inbox.md)
- [x] **Feature 2 — Inbox view + sort** (walk inbox items one at a time,
      route to project / area / waiting-for / trash / calendar, empties
      inbox to zero)
- [x] **Feature 3 — Projects with milestones** (outcome, 2–4 milestones,
      next action, DRI, status; definition of done includes who verifies).
      Drains `## Unprocessed` by showing the items beside the fields and
      letting each be dismissed once handled — automatic conversion into a
      milestone or next action stays with Feature 7
- [x] **Feature 4 — Top-three / WIP limit + the policy seam** (1–3 outcomes per
      week; refuses a 4th active project until one is done or explicitly
      dropped). **This feature introduces the policy seam**, because it is the
      first feature that needs it: core gains its named decision points and the
      single default policy module registers against them. The two rules already
      shipped in Feature 3 — the milestone cap (block) and the open-milestone
      confirmation (warn) — migrate behind decision points here rather than as
      separate remediation, since the seam has to exist anyway.
      **The WIP limit counts only projects where the user is the DRI.** Projects
      with someone else as DRI are *overseen* rather than *driven*: uncapped, and
      tracked separately. The user is an engineering manager overseeing many
      projects owned by other people, and a limit counting all of them would fire
      constantly and be ignored — a rule nobody heeds is worse than no rule,
      because it trains the user to dismiss the system's refusals.
      Identity resolution (canonical `me` + aliases) is built in **core** as part
      of this feature; policy calls it. **A project with no DRI does not count
      toward the limit** — an unresolved DRI is unknown, not the user's — and is
      surfaced as needing a DRI using the same informational, non-blocking
      pattern as Feature 3's incomplete flag, as a **distinct signal, not a
      fourth structure gap** (why: see Open questions, below).
      **Shipped 2026-08-14.** `identity.md` (canonical `me` + `## Aliases`) and
      `policy.md` (`wip limit`, `milestone cap`, `weekly outcome cap`) sit in the
      vault root; the top three is one `top-three.md` holding every week as a
      `## YYYY-Www` section, newest first. Core declares exactly three decision
      points, and the milestone cap and open-milestone confirmation moved behind
      them with Feature 3's suites passing unmodified. ISO-8601 weeks are
      computed in-repo — **Feature 5's `log/` filenames must use the same
      computation** (`packages/core/src/weekly/iso-week.ts`)
- [x] **Feature 5 — Weekly review ritual** (scripted: inbox must be zero,
      per-project status update, stale waiting-for check, set next week's
      top three, writes to log/YYYY-WW.md).
      **Inherits the WIP limit's pressure valve.** Feature 4 counts only `active`
      projects toward the limit, so `waiting` is the escape hatch: a project moved
      to waiting that is not genuinely blocked frees a slot and quietly drains the
      limit of meaning. Feature 4 deliberately does not solve this — the system
      cannot judge whether a block is real. The stale waiting-for check is where it
      surfaces, so that check should be understood as load-bearing for the WIP
      limit, not only for delegation follow-up.
      **Shipped 2026-08-15.** One file per week at `log/YYYY-Www.md`, holding the
      review **while it is in progress and after it is finished** — there is no
      separate state file, so a review that is interrupted resumes by being
      re-read and one that is abandoned stays on disk saying `status: in
      progress`. The filename uses Feature 4's `isoWeek()`, settling the
      `YYYY-WW` sketch above in favour of the identifier.
      **Projects gained a ledger**: an append-only `## Ledger` section written by
      `setStatus`/`complete`/`reopen` in the same write as the `status:` line, so
      the same change from any surface produces an identical entry. `status:`
      stays the source of truth for what a project *is*; the ledger says how it
      got there. No file on disk is migrated — a project gains its ledger the
      first time an action is recorded against it. Only status changes are
      recorded; the entry shape generalises so a later record type can carry one.
      **Five decision points** now: the three Feature 4 declared plus
      `review.inbox.advance` (the inbox gate, shipping as `warn` and configurable
      to `block`) and `waiting.stale.check`. That second one is asked about
      **both** a delegated item and a project sitting in `waiting`, through one
      point with one `staleness days` threshold — not separately configurable, by
      construction rather than by promise.
      **The top-three writable window widened** from the current week to the
      current week *and the next*, on every surface rather than only inside the
      review: the ordinary top-three window can now set next week too. Past weeks
      still refuse with `past-week`; two or more weeks out refuse with
      `future-week` naming the weeks that work.
      **A summary port ships with no provider.** `SummaryProvider` is a named
      interface with exactly one call site at completion, supplied by injection —
      the shape `TranscriptionPort` established. With none supplied the review
      completes normally with no broken or disabled affordance, nothing leaves
      the machine, and the view still shows exactly what a provider *would* be
      sent. There is no loader, no discovery, and no registration API.
      **Feature 6 reads these logs** as its raw material, and **Feature 8 is the
      feature that supplies a summary provider** — the port exists so that
      arrives as an injected argument rather than as a change to the review
- [x] **Feature 6 — Achievement / retrospective view** (every milestone and
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
- **Project structure extends the stub, never migrates it** — Feature 2 had
  already shipped title-and-status files into vaults, so Feature 3 adds
  preamble fields beside `status:` and `## Outcome` / `## Milestones` above
  `## Unprocessed`. YAML frontmatter was rejected for exactly this reason: it
  would have meant rewriting every file already on disk.
- **The incomplete flag is computed, never stored** — a stored flag would be a
  second copy of what the fields already say, and would go stale the first time
  the user edited the file in vim, which is the scenario the plain-text format
  exists to support.
- **Marking a project done with open milestones asks rather than refuses** — a
  hard refusal would be routed around by deleting the milestone, destroying its
  record. The confirmation is the honest version of the same guardrail.
- **The milestone cap is enforced, the floor is not** — a fifth milestone is
  refused (four is the scope-creep guard); a single milestone is just a project
  mid-typing and is never flagged for it.
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
- **Policy is separated from core** — the WIP rule turned out to be personal
  rather than domain-inherent. That gives the test: a rule that could reasonably
  differ between two users while both still use Waypoint correctly is policy, not
  core. "A project has milestones" is core. "At most four of them" is policy.
- **Policy plugs into core's decision points, it does not wrap core** — a policy
  layer sitting *above* core would be bypassable by anything that called core
  directly, which is precisely what the local API (Feature 7) and the LLM layer
  (Feature 8) do. Enforcement at the decision points inside core means no client
  can reach underneath it.
- **The seam is built now; the plugin system is deliberately deferred** — ship
  exactly one default policy module. No loader, no discovery, no public extension
  API. The interface stays internal until it has been used internally long enough
  to know what it should look like; publishing an extension API is a promise that
  is expensive to take back.
- **Identity is core, not policy configuration** — apply the test above: two
  users cannot reasonably configure who they are differently and both be correct.
  There is one right answer per data directory, so identity is a *fact about the
  data*, not an opinion about how the user works. Core stores a canonical `me`
  plus aliases and answers "is this DRI the user?"; policy consumes that answer.
  Kept in a separate file from policy configuration because identity outlives any
  given policy module, and because the review, the retrospective view, and the
  LLM layer all need identity without needing policy.
- **No reserved `dri: me` convention** — a sentinel value would mean migrating
  every existing project, and would break the case the plain-text format exists
  to support: typing an actual human name into a file in vim. The canonical value
  and the alias list together cover the several spellings already on disk.
- **A null DRI does not count toward the WIP limit** — an unresolved DRI is
  *unknown*, not *the user's*. Every stub created during sort starts with no DRI,
  so counting unknowns would make the limit fire on untriaged stubs — precisely
  the false-alarm failure mode that scoping the limit to the user's own projects
  exists to avoid. Null DRIs are surfaced informationally instead, never blocking.
- **Open-core is left open, so the license is a deliberate choice** — this
  architecture makes a free core plus default module, with third-party or
  commercial modules on top, possible later without rework. That option is worth
  preserving, so the repository license should be chosen on purpose rather than
  inherited by default. ⚠ Currently unresolved: see below.

## Open questions raised by the policy layer

Not decisions yet — things the policy layer surfaced that need answering before
or during Feature 4.

- **The license has already been chosen by default, which is the thing the
  decision above says not to do.** `license: "MIT"` is declared in the root,
  `packages/core`, and `packages/desktop` `package.json` files, and there is **no
  `LICENSE` file in the repo at all**. So the current state is both accidental
  and internally inconsistent: npm metadata claims MIT, the repository grants
  nothing explicitly. MIT permits third parties to build commercial modules on
  top — which open-core wants — but equally permits anyone to fork the core
  itself commercially, which is the part worth deciding on purpose. Resolve the
  declared license and add a real `LICENSE` file as one deliberate act.
- **This partially supersedes the "Public repo" decision above**, which says
  "portfolio piece, not monetized… if ever productized, fork private and harden
  separately." The open-core entry contemplates commercial modules *without* a
  private fork. Both entries are kept: the older one is the original intent, and
  it should be rewritten rather than silently outgrown if open-core is pursued.
- ~~**The data model has no notion of "me".**~~ **Resolved, and now shipped
  (2026-08-14).** `identity.md` in the vault root: a `me:` preamble field and an
  optional `## Aliases` list. Matching normalizes case, surrounding whitespace,
  repeated internal spaces and one trailing period, and **never** treats a
  shorter name as a longer one — no prefix, initial, substring or fuzzy
  matching. A name matching an alias that is also a strict leading-word prefix
  of another distinct person in the vault resolves as `ambiguous` rather than
  being claimed. See `packages/core/src/identity/`.
- ~~**Surfacing "needs a DRI" must not reuse Feature 3's structure gap.**~~
  **Resolved** — built as a separate derived signal. `ProjectSummary` gained
  `needsDri` alongside `gaps`; `packages/core/src/projects/gaps.ts` was not
  edited, so FR-009 stands exactly as Feature 3 wrote it. Guarded by
  `packages/core/tests/needs-dri.test.ts`, which asserts a project missing only
  a DRI has `gaps: []`.
- **The license is still unresolved.** Feature 4 did not touch it. `license:
  "MIT"` remains declared in three `package.json` files with no `LICENSE` file
  in the repo — the accidental default the open-core decision says not to make.
  Now more pressing, not less: the policy seam exists, so a free core plus
  default module with third-party modules on top is a real option rather than a
  hypothetical.