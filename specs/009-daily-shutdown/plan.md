# Implementation Plan: Daily Shutdown

**Branch**: `009-daily-shutdown` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-daily-shutdown/spec.md`

## Summary

A read-only core module that composes four readings taken at one moment — the current ISO week's top three,
the user's active projects with their next actions and open milestones, waiting-for items past the staleness
threshold, and calendar-flagged items past that same threshold — and a window that displays them together
and lets the user act on what they see by calling the verbs that already exist.

It has no on-disk representation at all: no daily log, no state file, no record of shutdowns run or skipped,
no notion of a day anywhere. Nothing it writes is about the shutdown. Every write is an ordinary change to
an outcome, a milestone, a next action, a waiting-for item, or the inbox, indistinguishable from the same
change made anywhere else.

This is structurally Feature 6, not Feature 5. The load-bearing decisions:

- **`ShutdownServiceDeps` is read-only by type.** `vault` is `Pick<VaultStore, "read">`; the three service
  dependencies are structural shapes carrying one read verb each (`listDetailed`, `current`, `read`). No
  write is reachable from this service, so SC-002's byte-for-byte assertion is a regression net over
  something the compiler already holds (research R1).
- **The shutdown performs no action of its own.** Each affordance calls the same core verb the ordinary
  surface calls, through the same IPC channel where one exists. FR-037/FR-038/FR-039 are satisfied
  structurally: the shutdown cannot diverge from a validation, a refusal, a ledger write, or a policy
  consultation, because it is not executing any of them (research R2).
- **The waiting verbs get channels named for the verb, not for the screen.** Their only existing surface is
  the weekly review, whose channels also write a review log line — the review's record of its own ritual,
  which this feature must never reach (FR-050). `waiting:record-follow-up` and `waiting:record-received`
  call `WaitingService` directly. SC-004's parity comparison is therefore on the file the verb owns
  (research R2).
- **One rule, three subjects.** Calendar staleness is judged by the existing `waiting.stale.check` point.
  `WaitingStaleContext.subject` widens to `"item" | "project" | "calendar"` and the default module gains
  one message branch. `DECISION_POINTS` stays at five, `policy.md` gains no key, and `stalenessDays`
  governs all three (research R5).
- **Four reads build the whole screen**, verified by counting reads rather than by timing, the way Features
  3, 5, and 6 verify theirs. `WaitingService.read()` is added — additive, non-breaking — because `list()`
  and `unreadable()` each read `waiting.md` and FR-011a permits one read (research R3).
- **`calendar/` is a parser, not a service.** No write function exists anywhere in the module, which is the
  strongest available form of FR-031 and FR-042 (research R4).

**One interpretation the reader should check.** The plan input says open views reflect changes through the
generic changed signal so that "a capture made from this screen or a change made in another window updates
what is displayed without a close and reopen". Taken as *the shutdown re-reads itself while open*, that
contradicts FR-010a and FR-011a and the recorded clarification behind them. Taken as *the signal keeps
working* — the shutdown's writes go through the shipped adapters, so an open sort window sees the capture
and an open projects window sees the milestone — it is satisfied exactly and needs nothing new. This plan
adopts the second reading, and the shutdown window subscribes to no change signal (research R7). **The spec
settles it**: the clarification recorded on 2026-08-18 fixes membership at the moment the screen opens and
updates rows in place, which is the second reading in as many words. No amendment to FR-010a or FR-011a is
pending.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 22 (`.nvmrc` pins 22; `engines.node >= 22`)

**Primary Dependencies**: **None added.** Every input is an existing core module: `TopThreeService`,
`ProjectService` (and through it `resolveDri`, unchanged), `WaitingService`, `CaptureService`, the policy
seam, `daysBetween`/`localDate` from `vault/lists.ts`. No date library, no new package in either workspace.

**Storage**: **None.** This feature has no on-disk representation, no format contract of its own, and no
migration. It reads `top-three.md`, `projects/*.md`, `identity.md`, `waiting.md`, `calendar.md`, and
`policy.md` in the shapes Features 2, 3, 4, and 5 defined, and adds no file, field, section, index, or
cache. `calendar.md`'s grammar is Feature 2's, read for the first time here and not redesigned.

**Testing**: `node --test` over compiled output, `TZ=America/New_York` (pinned and load-bearing — staleness
and week membership are local-calendar facts). Six forms carry the weight: byte-for-byte immutability with
a dirtying sibling to prove it has teeth, action and refusal parity against the ordinary surfaces, one
threshold moving all three stale sets, read counting, five degradation paths, and offline (research R11).
Window behaviour under Playwright in `packages/desktop/tests/e2e/`.

**Target Platform**: Electron desktop on Linux and macOS. macOS builds continue to be produced by GitHub
Actions on a macOS runner and shipped as release artifacts; nothing is built or installed on the work
machine.

**Project Type**: npm workspaces monorepo — `packages/core` (all domain logic, imports nothing from
Electron) and `packages/desktop` (thin client).

**Performance Goals**: All four panels within 1 second in a vault of 100 projects, reading each **panel
source file** at most once per opening: one `top-three.md`, one `identity.md`, one per project file, one
`waiting.md`, one `calendar.md`.

`policy.md` is deliberately outside that count, and this is worth stating plainly because a bare
`maxReadCount() === 1` would be the obvious assertion and would be wrong. `DefaultPolicy.decide()` re-reads
its configuration on every decision — by design, so a user editing `policy.md` sees the new rule without
restarting anything — and staleness is a question asked once per candidate waiting item and once per
candidate flag. A shutdown over thirty stale subjects therefore reads `policy.md` thirty-odd times. That is
the shipped rule working, not this feature leaking a read, and neither FR-011a nor SC-013 asks it to stop.

So the assertion is a **filtered** read count over the panel sources on a 100-project fixture, the way
`review-read-count.test.ts` filters to `projects/` — never a stopwatch, and never `maxReadCount()` over
everything (SC-013, FR-011a). The two-minute read (SC-001) is quickstart scenario 9, checked by hand.

**Constraints**: Fully offline; no outbound anything. Writes nothing from the view service, enforced by the
dependency types. Adds no decision point — the count stays at five. Adds no policy value. Introduces no
domain vocabulary. No existing behaviour changes; Features 1–8 suites pass unmodified.

**Scale/Scope**: Single user, single vault. 100 projects, tens of waiting items, tens of calendar flags —
the fixture the criteria are written against. Thirty stale items are all listed, in full (FR-023, edge
case "a very long list").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Assessed against Constitution v2.0.0, all seven principles.

| Principle | Assessment | How this plan satisfies it |
|---|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS | Every task that implements behaviour is preceded by a failing test. Six tasks are deliberately **not** Red-first, named here so the exception is visible rather than assumed: T019 (the decision-point count — true the moment it is written), T034 (asserts a comparison *fails*), T090–T092 (guards over the finished surface), and T093 (a suite run). Principle I binds the code that adds behaviour; these assert behaviour was **not** added, and an absence has no Red state to observe. Four of the real tests deserve naming. The **byte-for-byte immutability** test is written before the service can read anything, so its Red is "there is nothing to run yet" rather than "nothing was written" — it ships paired with a deliberately-dirtying sibling, because a vacuously green immutability test is the specific way a read-mostly feature's headline guarantee rots (Feature 6 recorded this the hard way). The **one-threshold** test fails before any panel exists and pins the inclusive boundary for all three subjects from one number. The **action parity** tests cannot be written until the shutdown calls the same verb, because they compare bytes against the ordinary surface's result. The **read-count** test fails on any per-item read the moment a loop reaches for the vault. |
| **II. Library-First** | PASS | Panel membership, the DRI filter, the staleness question, day counts, ordering, empty-versus-failed, and every refusal are produced by `packages/core`. The window renders four lists, routes five actions to channels, and holds a capture box. Nothing about "is this mine", "is this stale", or "may I write this" is computable in the renderer. The service is one verb — `read()` — and the actions are the existing services' verbs. |
| **III. Local-First / Offline** | PASS | Nothing here has a network path to lose. FR-031 forbids contacting any external calendar, and no code in the feature can: the calendar module is a string parser. An offline test mirrors `retrospective-offline.test.ts`; SC-009's "no outbound connection attempted" is asserted the way `review-no-outbound.test.ts` asserts it. |
| **IV. Durable Plain-Text** | PASS | Reads plain text, writes plain text through existing verbs, creates nothing. A missing `waiting.md`, `calendar.md`, `top-three.md`, or `policy.md` produces an empty panel or a documented default and **no file** — a vault gains `calendar.md` by sorting into it, never by being looked at (FR-011c, and `policy-no-files-created.test.ts`'s established discipline). An unreadable line is shown verbatim with its 1-based line number so it can be fixed in an editor, and is never rewritten, counted, or dropped (FR-032). |
| **V. Enforced Process, Separable Policy** | PASS | No decision point is added; `decision-points.test.ts` is not edited and still asserts five. The one rule this feature asks is the shipped `waiting.stale.check`, consulted with a third subject that changes the message and not the decision. Core supplies both dates and reports the answer; it never compares anything to the threshold and never learns the number. Every write goes through a verb that already consults its own points, so no client can reach a rule this one bypasses — including this one. |
| **VI. Instant, Non-Blocking Capture** | PASS | Capture from this screen is `CaptureService.submit` through the existing `capture:submit` channel and the existing append queue. The budget and the non-blocking guarantee are properties of that service, not of the surface, so they are inherited rather than re-promised (FR-046). No capture code is added, changed, or wrapped. |
| **VII. One Consistent Interaction Model** | PASS | No new domain term enters the core (research R13). "Shutdown" names a window; nothing on disk knows the word, and there is no file, field, or record it could be written into. Every verb the screen offers is one the user already has elsewhere, with the same name, the same inputs, the same refusals, and the same reason text. Refusals keep the established `{ ok: false, reason, message }` shape. |

**Blocking-principle review (I, III, IV, V)**: no violations. Three concessions are recorded in Complexity
Tracking; none relaxes a blocking guarantee, and each is additive.

### Post-design re-check (after Phase 1)

Re-run against the completed contracts. Still PASS on all seven. Four things the design surfaced that the
pre-design check had not:

- **Principle V was at risk in a place the pre-check did not look.** The obvious way to reach the waiting
  verbs is `ReviewService.recordFollowUp`, which is what the only existing surface calls — and it writes a
  review log line. Reaching it from here would have written a record of the shutdown while every test about
  *this feature's* files passed. The design routes to `WaitingService` and names the parity target
  precisely (research R2); the immutability suite now includes an assertion that no file under `log/` is
  created or modified by any shutdown action.
- **Principle IV needed the "empty versus failed" distinction to be a type, not a convention.** FR-011c says
  "nothing here" and "could not be read this" must read differently. A panel modelled as a bare array makes
  them the same value, and the difference would then live in whichever renderer remembered it. `Panel<T>` is
  a two-state union so the renderer cannot conflate them (data-model).
- **Principle II gained a boundary worth stating.** The reason text for a stale calendar item is the policy
  module's words, passed through untouched, exactly as Feature 5 passes the waiting reason. A renderer that
  composed "this has been unscheduled for N days" from the day count would be holding domain vocabulary —
  a Principle VII breach reached through a Principle II one, which is the same trap Feature 6 recorded.
- **Principle I gained a trap worth naming twice.** Both the immutability test and the "no new decision
  point" test can pass without asserting anything if the service under test never ran. Each is paired: the
  first with a dirtying sibling, the second with a spy asserting the point *was* consulted for the stale
  subjects, so "consulted nothing" cannot masquerade as "consulted nothing new".

No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/009-daily-shutdown/
├── plan.md                       # This file
├── research.md                   # Phase 0 output — R1–R14
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/                    # Phase 1 output
│   ├── shutdown-api.md           # Service surface, action routing, IPC channels, vocabulary
│   └── calendar-format.md        # The read grammar for calendar.md (Feature 2's format, read here)
├── checklists/                   # Written by /speckit-specify
└── tasks.md                      # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── shutdown/                          # NEW — the composition
│   ├── types.ts                       # ShutdownView, Panel, SourceFailure, the four panel rows
│   └── shutdown-service.ts            # the one verb: read()
├── calendar/                          # NEW — read-only; no write function exists in this module
│   ├── types.ts                       # CalendarItem
│   └── calendar-document.ts           # CALENDAR_PATH, readCalendar(content)
├── waiting/
│   ├── waiting-service.ts             # MODIFIED: + read() — one vault read, items + unreadable
│   └── types.ts                       # MODIFIED: UnreadableLine doc widened to "a running list"
├── ports/index.ts                     # MODIFIED: WaitingStaleContext.subject += "calendar"
│                                      #   DECISION_POINTS unchanged — still five
├── policy/default-policy.ts           # MODIFIED: one message branch for the calendar subject
└── index.ts                           # MODIFIED: additive exports only

packages/core/tests/                   # ~38 new test files, flat, kebab-case by topic
                                       # shutdown-fakes.ts reuses retro-fakes.ts helpers
                                       # ZERO existing test files modified
                                       #   (decision-points.test.ts must stay untouched and green)

packages/desktop/src/
├── main/
│   ├── main.ts                        # MODIFIED: wire ShutdownService + window; NO change subscription
│   ├── ipc.ts                         # MODIFIED: + registerShutdownIpc (read + the two waiting verbs)
│   ├── tray.ts                        # MODIFIED: + "Daily shutdown" entry
│   └── shutdown-window.ts             # NEW — hides on close; show() sends shutdown:opened
├── preload/preload.ts                 # MODIFIED: + shutdown bridge (read, the five actions, capture)
├── renderer/
│   ├── shutdown.html                  # NEW
│   └── shutdown.ts                    # NEW — four panels, five actions, one capture box
├── ../tests/                          # NEW unit tests: shutdown-window.test.ts,
│                                      #   shutdown-no-refresh.test.ts, shutdown-ipc-contract.test.ts,
│                                      #   shutdown-capture-parity.test.ts,
│                                      #   shutdown-capture-behaviour.test.ts, shutdown-capture-undo.test.ts
└── ../tests/e2e/                      # NEW: shutdown-glance.spec.ts, shutdown-actions.spec.ts,
                                       #   shutdown-capture.spec.ts
                                       #   (playwright.config.ts sets testDir to tests/e2e — a spec
                                       #    placed anywhere else is silently never run)

package.json                           # MODIFIED: build:renderer copies shutdown.html
ROADMAP.md                             # MODIFIED: Feature 9 marked shipped, on merge
```

**Structure Decision**: The existing two-package monorepo is kept. `shutdown/` and `calendar/` are new
sibling modules inside `packages/core/src`, matching how `capture/`, `inbox/`, `sort/`, `projects/`,
`identity/`, `policy/`, `weekly/`, `waiting/`, `review/`, `retrospective/`, and `suggest/` are already
organised.

`calendar/` is separate from `shutdown/` on purpose: the grammar of `calendar.md` outlives this screen, and
the next feature that reads that file should find a parser rather than write a second one. Both are split
along the same seam every other module uses — pure functions over strings on one side, the one thing that
does I/O on the other.

## Complexity Tracking

> Filled because three concessions are worth recording. None relaxes a blocking guarantee.

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| `WaitingStaleContext.subject` widened, and `default-policy.ts` gains a message branch | FR-028 requires calendar staleness judged by the same rule and the same threshold, and FR-038 requires the reason text to be right for the subject | Reusing `subject: "item"` would tell the user "This has been waiting 14 days. Chase it, or let it go." about an item they flagged for their own calendar — wrong noun, wrong remediation. A `calendar.stale.check` point would be a sixth point for the same question, which the spec forbids in as many words |
| `WaitingService.read()` added beside `list()` and `unreadable()` | Those two each read `waiting.md`; FR-011a permits one read per opening | Migrating `ReviewService.waitingStep()` to the new method would touch shipped, covered behaviour for no gain to this feature. Reading the file in the shutdown and parsing it there would put `waiting.md`'s path and parse order in a second place |
| An unreadable file inside `projects/` fails the whole project panel, named as `projects/` rather than by file | `ProjectService.readAll` propagates the error; naming the individual file means changing a shipped service's read loop, whose blast radius is every caller of `list`, `listDetailed`, `listActive`, `listCompleted`, `getResolved`, and `overLimitState` | Changing `readAll` now would mean re-verifying Features 3, 4, 5, and 6 against a widened error contract to improve one string in one panel. FR-011b's substance — the shutdown still opens, the other three panels work and stay actionable — is met either way. Feature 6 hit the same boundary and recorded it rather than reaching across it |
