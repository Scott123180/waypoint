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

**The intelligence layer has two distinct seams.** Anywhere a model helps with a
task, two independent questions are being answered: *what is being asked for* and
*how the model is reached*. They change for different reasons and at different
rates, so they are separate interfaces with a module between them.

> **"Port" here means an interface with a single call site, supplied by
> injection.** It is the `TranscriptionPort` / `SummaryProvider` shape: a named
> type core declares, one place core calls it, and an implementation passed in as
> an argument. It does **not** mean a network binding. Feature 7 (the local
> HTTP/JSON API, deferred below) does involve a real network port, in the TCP
> sense; nothing in this section does. The two meanings are unrelated and this
> document uses the word only in the interface sense outside that feature.

**Seam one — what intelligence does.** Core declares a port per job, expressed in
Waypoint's own vocabulary: splitting a messy dictated capture into distinct
items, suggesting a destination for an inbox item, drafting a review summary.
These ports say what is wanted in domain terms and are stable regardless of what
answers them. `SummaryProvider`, shipped with Feature 5, is the first of them and
sets the shape — a named interface, one call site, injected, no loader.

**Seam two — how a model is reached.** A transport carries prompt text out and
brings response text back. The known cases are: shelling out to a command-line
tool such as the Claude CLI; HTTP to a locally running model such as Ollama;
HTTPS with client-certificate authentication to a corporate endpoint; and
reaching a model through an editor integration such as Copilot in VS Code, where
a command line is blocked. These are transport concerns and contain nothing about
task management — a transport has never heard of a project, an inbox item, or a
review.

**Between them sits the intelligence module.** It implements seam one's ports and
is configured with a seam-two transport. Prompt construction, response parsing,
and the suggest-don't-decide semantics live in the module. Authentication, wire
format, and process invocation live in the transport. Moving between a home
machine and a restricted work machine changes only the transport — the same
portability motivation that led to building Waypoint in the first place.

**Transport selection is configured, never auto-detected.** The choice lives in
the git-tracked data directory alongside the policy and identity configuration,
as an explicit value. Auto-detection — probing for a CLI on `PATH`, for a
listening Ollama, for an editor host — would make the application behave
differently on two machines for reasons the user cannot see, which is exactly
what plain-text configuration stored with the data exists to prevent.

**The entire layer degrades to nothing.** A transport that is unconfigured, one
that is unavailable, and one that fails mid-call all land in the same place: the
feature still works and the user does the thinking themselves. There is no broken
affordance, no disabled-looking control, and no error the user has to clear. This
is already the summary port's shipped behavior — a review with no provider
completes normally — and it becomes the module-wide contract rather than one
feature's local decision.

**The plugin system is deliberately deferred, as it is for policy.** Ship one
default intelligence module and a small known set of transports, wired by an
explicit configuration value. No loader, no discovery mechanism, no public
extension API. Adding a transport without a code change would require discovery,
which Principle V defers. The transport interface should be exercised across at
least two genuinely different real environments before it is considered for
publication, because a contract designed against real environments is far more
likely to survive a third than one designed against a hypothetical.

**Two extension points, deliberately asymmetric.** Adding a transport is the
cheap, common case: one adapter that takes prompt text and returns response text,
inheriting all of the default module's prompt construction and parsing. Writing a
separate intelligence module is the expensive, rare case — for someone who
disagrees with how the default module *thinks*, rather than only with where it
connects. The transport seam is the front door, and most contributors should
never need the other one.

Clients, in order of arrival:
1. **Electron GUI** — the primary interface (macOS + Linux)
2. **Local HTTP/JSON API** — **deferred and unscheduled** (see Feature 7). Its
   original job was giving an AI agent a way in; the port pattern above serves
   that for anything running in-process, leaving only out-of-process consumers
3. **AI agent integration** — in-process consumers use the intelligence ports;
   an out-of-process agent would consume the local API if and when it is built

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
- **intelligence configuration** — which transport the intelligence module is
  wired to, as an explicit value; never auto-detected. Lives here for the same
  reason policy configuration does, and absent means the layer is simply off.
  Filename and format are Feature 8's to decide

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
- [x] **Feature 8 — LLM-assisted inbox organization** — **shipped** (splits messy
      dictated streams into distinct items, suggests project/area/
      waiting-for placement; suggest-don't-decide, human confirms during
      sort). Built on the intelligence layer described in Architecture, not on
      the API, and it kept the degrade-to-nothing contract: with no transport
      configured, sort is byte-for-byte what Feature 2 shipped. Numbered 8
      before it was resequenced ahead of Feature 7; the number is kept because
      specs and code already cite it.

      What shipped:

      - **`intelligence.md` at the vault root**, absent by default and absent
        in every vault that exists today — which is what made shipping this a
        no-op for data already on disk. It names a transport and its non-secret
        parameters, and the *path* to a credential, never the material: there
        is no field a private key could be written into, so "the data directory
        stays safe to commit" is a property of the format rather than a warning
      - **Two transports**, chosen because their failure modes are unalike —
        `command` (spawn, request on stdin) and `certificate` (`node:https`
        with client-certificate authentication). Exit codes and stderr tails
        against TLS handshakes and HTTP statuses. That is what shows the
        seven-member failure taxonomy is a real abstraction rather than one
        implementation's error type renamed. **Neither adds a dependency.**
        Never probed: no PATH check, no scan for a listening local model, no
        environment variable, no editor-host detection
      - **The segment-number technique**, which is the load-bearing idea. The
        model is shown the item partitioned into numbered segments and answers
        with *numbers*; core slices the original to build each piece. A piece
        containing words the user did not say is not something a validator
        catches — it is something the data path cannot produce, because text
        from the response is never handled. "Nothing dictated was dropped"
        becomes set arithmetic over indices rather than a similarity score
      - **`SortService.split(ref, pieces)`** — one atomic `replaceRange`, no
        journal entry (one file, so the rename already gives all-or-nothing).
        It takes *strings*, so it cannot tell whether they came from a
        proposal, an edit of one, or a user with nothing configured typing
        three pieces by hand. That is what makes "no behaviour exists only on
        the assisted path" a fact about the signature
      - **The payload is one value.** A request is *prepared* into a
        `PreparedRequest` holding the exact content and a `run()` closed over
        it, so "what you were shown is what was sent" is asserted with `===`
        rather than deep equality. `contracts/intelligence-ports.md` originally
        gave providers a single `propose()` that rendered and sent in one call;
        that shape cannot satisfy the preview and identity requirements
        together, and the deviation is recorded in the plan
      - **Five decision points, unchanged.** A proposal the user is free to
        reject holds no opinion the system enforces, so there was nothing for a
        sixth point to decide. `SuggestionServiceDeps` has no `policy` field —
        absent rather than injected-and-unused, so consulting a rule from here
        would take a visible constructor change
      - **Feature 5's `SummaryProvider` is still unimplemented**, and this
        entry previously implied Feature 8 would supply one. It does not: the
        weekly-review summary was explicitly excluded from scope. The port is
        left as it is rather than quietly filled, and the review still
        completes normally with no provider, offline, showing no summary
        affordance at all
- [ ] **Feature 7 — Local HTTP/JSON API** — **deferred, unscheduled** (exposes
      core verbs so non-GUI clients can call capture/sort/review/etc.). Its
      original justification was giving an AI agent a way in without fragile UI
      automation, and the port pattern now serves that for anything running
      in-process. What remains is out-of-process consumers only — a
      command-line client, an agent on another machine, a script. Nothing
      currently being built requires one, and core's verbs are already exactly
      what an API would expose, so deferring it blocks nothing and costs no
      rework when it arrives. The existing guards that keep HTTP out of core
      (`packages/core/tests/project-scope-boundaries.test.ts`) stay as they are
- [ ] **Feature 9 — Daily shutdown** (2-minute end-of-day: view top-three +
      due waiting-for follow-ups, capture loose threads). Calendar-flagged
      items carry a flag date so this feature can surface the ones left
      unscheduled too long, the same way waiting-for goes stale

## Known gaps

Real defects found in shipped behaviour, kept here rather than in a feature
spec because each one is a fix to something that already exists.

- [x] **Dictation does not survive losing focus** — the capture box hides on
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
      **Fixed 2026-08-17 by answering (a): dictation pins the box open.** Blur
      does not hide while dictation is in flight, so (b) never arises — no audio
      is discarded because the box is never taken away to reset. (c) is answered
      without a global accelerator: either hotkey now focuses an already-visible
      box instead of returning without touching it, so the pinned box is one
      keystroke from Enter and Escape again. **No new system-wide key is taken.**
      "In flight" is every non-idle dictation state, not only `recording`:
      `acquiring` can already hold an open microphone, and a box hidden while
      `transcribing` would lose the arriving transcript to the next reset — the
      same defect one state along. Main learns the fact from the renderer over
      `capture:dictating` and keeps one boolean; it does not get a second copy
      of the state machine, and it asks only one question of it — may this
      window be taken away right now? Escape and submit still close a dictating
      box, because both stop the recording first.
      The blur decision moved into `CaptureWindow.blurred()` so the E2E suite
      can drive it: window focus is the window manager's to give and a test
      runner grants none, so `BrowserWindow.blur()` is silently a no-op there —
      the same reason the suite calls `show()` rather than pressing the global
      hotkey. Guarded by `packages/desktop/tests/e2e/dictation-blur.spec.ts`,
      whose five defect tests were each confirmed to fail without the fix.

## Key decisions log

- **Public repo** — portfolio piece, not monetized. Productizing later would
  not require a private fork: as sole copyright holder the owner can dual-license
  or relicense at will (see the MIT entry below). Forking private and hardening
  separately remains a reasonable path for a production hardening effort — it is
  a decision about scope and support, not about the license.
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
- **Intelligence is split into two seams: what is asked for, and how the model is
  reached** — a port per job in Waypoint's vocabulary, a transport that only moves
  prompt text and response text, and a module in between holding prompt
  construction, parsing, and suggest-don't-decide. Changing machines then changes
  the transport and nothing else. Transport selection is configured in the data
  directory rather than auto-detected, because a probe would make the app behave
  differently on two machines for invisible reasons. The whole layer degrades to
  nothing: unconfigured, unavailable, and failing all land on "the feature works
  and the user thinks for themselves," which is already what the summary port
  ships.
- **Many ports for many intelligence jobs is the signal that a general
  integration surface was actually wanted** — one or two ports is a seam; five is
  a plugin system built by accident, one call site at a time. Declaring that many
  means the real requirement was a way for outside things to call core's verbs,
  not a way for core to call outward. **That is the point at which the HTTP API
  (Feature 7) earns its keep** and should come off the deferred list. Until then
  the count is the metric to watch, not the elegance of any individual port.
- **Adding a transport is cheap and expected; writing an intelligence module is
  not** — the two extension points are deliberately asymmetric. A transport is one
  adapter taking prompt text to response text, inheriting all of the default
  module's prompting and parsing; a second module is for someone who disagrees
  with how the default one thinks rather than only with where it connects. The
  transport seam is the front door. The interface stays internal until it has been
  exercised against at least two genuinely different real environments, on the
  same reasoning as the policy seam: a contract designed against real environments
  is far likelier to survive a third than one designed against a hypothetical.
- **Open-core is left open, so the license is a deliberate choice** — this
  architecture makes a free core plus default module, with third-party or
  commercial modules on top, possible later without rework. That option is worth
  preserving, so the repository license should be chosen on purpose rather than
  inherited by default. Resolved 2026-08-18: MIT, deliberately — see below.
- **MIT, chosen rather than inherited (2026-08-18)** — `LICENSE` at the repo
  root; the `license: "MIT"` already declared in the root, `packages/core` and
  `packages/desktop` `package.json` files was the accidental default, and now
  matches a license the repository actually grants. The reasoning: as sole
  copyright holder the owner retains every right regardless of what is granted
  to others, so MIT constrains third parties only and never the owner —
  dual-licensing, relicensing and productizing all stay available. **Copyleft
  (GPL/AGPL) was rejected for a specific reason**, not a vague one: it would
  make a third party's in-process intelligence module or transport a derivative
  work, forbidding proprietary modules and so destroying the open-core option
  the two-seam architecture exists to preserve. Copyleft would protect the core
  from commercial forks by closing the exact door open-core needs open. The
  residual risk MIT accepts — someone commercially forking the core — is small
  in practice for a personal task manager, and costs the owner nothing they
  currently hold. `CONTRIBUTING.md` keeps the relicensing path clean:
  contributions come in under MIT, and contributors agree the owner may
  relicense the project including their contribution.

## Open questions raised by the policy layer

Not decisions yet — things the policy layer surfaced that need answering before
or during Feature 4.

- ~~**The license has already been chosen by default, which is the thing the
  decision above says not to do.**~~ **Resolved (2026-08-18) — MIT, now on
  purpose.** A real `LICENSE` file sits at the repo root and the three
  `package.json` declarations were left alone, because MIT is the deliberate
  choice and they now match it. The part worth deciding — that MIT equally
  permits a commercial fork of the core — was decided knowingly: see the MIT
  entry in the key decisions log for why copyleft would have cost more than that
  risk is worth.
- ~~**This partially supersedes the "Public repo" decision above**~~ **Resolved
  (2026-08-18)** — the "Public repo" entry has been rewritten rather than left
  to contradict the license decision. It keeps the portfolio-piece intent and
  the not-monetized status, and drops the implication that productizing requires
  a private fork; sole copyright ownership means it does not.
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
- ~~**The license is still unresolved.**~~ **Resolved (2026-08-18), carried
  since Feature 4.** MIT, deliberately: `LICENSE` at the repo root, a
  `CONTRIBUTING.md` that keeps the relicensing path clean, and a README section
  pointing at both. The free-core-plus-modules option the policy and
  intelligence seams create is preserved rather than foreclosed — which is
  precisely why copyleft was rejected. Full reasoning in the key decisions log.