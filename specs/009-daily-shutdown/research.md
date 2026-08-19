# Phase 0 Research: Daily Shutdown

**Feature**: 009-daily-shutdown | **Date**: 2026-08-18 | **Plan**: [plan.md](./plan.md)

Every unknown in the Technical Context is resolved here. Nothing below is left as
NEEDS CLARIFICATION.

The shape of the problem: this feature is **structurally Feature 6, not Feature 5**. It composes four
readings of files other features already write, holds no state, and records nothing about itself. Where it
differs from the retrospective is that the user can act from it — and the whole design of that acting is
"call the verb that already exists and add no path of your own".

---

## R1 — Where the feature lives, and what may reach a write from it

**Decision**: A new core module `packages/core/src/shutdown/` containing `types.ts` and
`shutdown-service.ts`, exposing exactly one verb: `read(): Promise<ShutdownView>`. It is **read-only by
type**, following `RetrospectiveService`:

```ts
export interface ShutdownServiceDeps {
  projects: ProjectSource;      // structural: { listDetailed() }
  topThree: TopThreeSource;     // structural: { current() }
  waiting: WaitingSource;       // structural: { read() }
  vault: Pick<VaultStore, "read">;  // calendar.md only — no write, no appendLine
  policy: PolicyModule;         // consulted, never for a write
  clock?: Clock;
}
```

No dependency in that list has a write verb on it. `write` and `appendLine` do not typecheck, and
`ProjectService`, `TopThreeService`, and `WaitingService` satisfy the structural shapes by construction, so
the real services are passed in and only their read half is reachable.

**Rationale**: SC-002 and FR-053 ("opening and closing leaves the vault byte-for-byte unchanged") become
something the compiler holds rather than something a test hopes to catch. Feature 6 proved this pattern and
its byte-for-byte test is a regression net over a guarantee the types already give (006 research R1). The
same argument applies here with more force, because unlike the retrospective this surface *does* write —
just never through this service.

**Alternatives considered**:
- *Put the actions on `ShutdownService` as pass-throughs.* Rejected: a pass-through is a second path to
  the same write, and FR-037's parity is strongest when there is literally one path. It would also give
  this service a `VaultStore` with `write` on it, discarding the type-level guarantee above.
- *No core module; assemble the view in the renderer.* Rejected outright — Principle II. "Which projects
  are mine and active", "which items are stale", and "what does the week's commitment look like" are all
  domain questions.

---

## R2 — How the actions are performed (the parity question)

**Decision**: The shutdown performs no action of its own. Each affordance calls the core verb the ordinary
surface calls:

| Affordance (FR) | Core verb | IPC channel |
|---|---|---|
| Mark a top-three outcome done (FR-033) | `TopThreeService.completeOutcome(ref)` | `top-three:complete` (exists) |
| Mark a milestone done (FR-034) | `ProjectService.completeMilestone(slug, ref)` | `projects:complete-milestone` (exists) |
| Change a next action (FR-035) | `ProjectService.setNextAction(slug, expected, next)` | `projects:set-next-action` (exists) |
| Record a follow-up (FR-036) | `WaitingService.recordFollowUp(ref)` | `waiting:record-follow-up` (**new channel, existing verb**) |
| Record a receipt (FR-036a) | `WaitingService.recordReceived(ref)` | `waiting:record-received` (**new channel, existing verb**) |
| Capture (FR-043–FR-049) | `CaptureService.submit` / `.undo` | `capture:submit`, `capture:undo` (exist) |

**The one trap worth naming.** The only existing surface for the waiting verbs is the weekly review, and
its channels (`review:record-follow-up`, `review:record-received`) go through
`ReviewService.recordWaiting`, which delegates to `WaitingService` **and additionally writes a line into
`log/YYYY-Www.md`**. That log line is the *review's* record of its own ritual. The shutdown must never
reach it (FR-050, FR-051), so it calls `WaitingService` directly, through channels named for the core verb
rather than for this screen — `waiting:*`, which any later surface uses too.

This makes SC-004's parity target precise: **the byte-identical comparison is on the file the verb owns.**
`waiting.md` after a shutdown follow-up is byte-identical to `waiting.md` after a review follow-up; the
review's extra log line is not part of the waiting action and is not compared. Stating this now prevents an
implementer either writing a review log from the shutdown (a spec violation) or writing a parity test that
can never pass.

**Rationale**: FR-037/FR-038/FR-039 are satisfied structurally — the shutdown cannot diverge from a rule,
a refusal, a ledger write, or a policy consultation, because it is not executing any of them, it is calling
the code that does.

**Alternatives considered**:
- *`shutdown:complete-milestone` etc., forwarding to the same verb.* Rejected: channels named for a screen
  invite a second implementation. Where a channel exists, it is reused; where one does not, it is named for
  the verb.
- *Route waiting writes through `ReviewService` and suppress the log.* Rejected: a suppression flag on a
  ritual's recorder is exactly the "bypass" FR-039 forbids, and it would make the review's own record
  conditional on who called it.

---

## R3 — Reading each source at most once (FR-011a)

**Decision**: Four reads build the whole screen:

| Panel | Call | Files read |
|---|---|---|
| Top three | `TopThreeService.current()` | `top-three.md` × 1 |
| Projects | `ProjectService.listDetailed()` | each `projects/*.md` × 1, `identity.md` × 1 |
| Waiting | `WaitingService.read()` | `waiting.md` × 1 |
| Calendar | `vault.read(CALENDAR_PATH)` | `calendar.md` × 1 |

`WaitingService.read(): Promise<{ items: WaitingItem[]; unreadable: UnreadableLine[] }>` is **new and
additive**. Today `list()` and `unreadable()` each read `waiting.md`, so a caller wanting both reads the
file twice — which FR-011a forbids. `read()` reads once and parses both. `list()` and `unreadable()` are
untouched, and `ReviewService.waitingStep()` is deliberately **not** migrated: it is shipped, its behaviour
is covered, and changing it buys this feature nothing.

Verified by counting reads, not timing (SC-013), reusing Feature 6's `CountingVault` — see R11.

**Rationale**: `listDetailed()` exists precisely because Feature 5 needed the body and the row from one
pass (005 SC-016). Reusing it means the 100-project budget is inherited rather than re-derived.

**Alternatives considered**:
- *Have the shutdown read `waiting.md` itself and call `parseWaiting`/`parseUnreadable`.* Rejected: it puts
  a file path and a parse order in a second place. `WaitingService` owns that file.
- *Change `list()` to return both.* Rejected: it is shipped and has callers.

---

## R4 — Reading `calendar.md`

**Decision**: A new read-only module `packages/core/src/calendar/` with `calendar-document.ts` and
`types.ts`, exporting `CALENDAR_PATH`, `CalendarItem`, and
`readCalendar(content): { items: CalendarItem[]; unreadable: UnreadableLine[] }`. **No service, and no
write function anywhere in the module.**

The grammar is already fixed by Feature 2 and is not being designed here — see
[contracts/calendar-format.md](./contracts/calendar-format.md). The parser mirrors `waiting-document.ts`:
parsing never fails, an unreadable line is carried verbatim with its 1-based line number, and nothing is
ever rewritten.

**Rationale**: FR-031 and FR-042 say the calendar list is information only, and no verb exists today to
clear a flag. A module with no write function is the strongest available form of that promise — the same
"absent rather than accepted-and-unused" reasoning that kept `policy` off `RetrospectiveServiceDeps`
(006 research R11). A `CalendarService` would be a class whose only method is a read, whose existence
invites a second method.

`UnreadableLine` (`{ line, raw }`) is **reused** from `waiting/types.ts` rather than duplicated; its doc
comment is widened from "a line of `waiting.md`" to "a line of a running list". That is a comment edit with
no behavioural change. A duplicate type would mean two shapes for one idea and two renderers.

**Alternatives considered**:
- *Parse `calendar.md` inside `ShutdownService`.* Rejected: the next reader of that file would write a
  second parser. The grammar belongs beside the grammar it was deliberately shaped like.
- *Its own `CalendarUnreadableLine`.* Rejected as above.

---

## R5 — Calendar staleness: the same point, a third subject

**Decision**: Calendar staleness is judged by the **existing** `waiting.stale.check` decision point.
`WaitingStaleContext.subject` widens from `"item" | "project"` to `"item" | "project" | "calendar"`, and
`default-policy.ts` gains one message branch. **`DECISION_POINTS` stays at five**, `policy.md` gains no
key, and `stalenessDays` remains the single value governing all three subjects.

The existing `decision-points.test.ts` is **not modified** and continues to assert five.

**Rationale**: FR-028/FR-029 require the same threshold and forbid a second one; the spec's own words are
"one rule, three subjects". `subject` is documented in `ports/index.ts` as being "for the message only —
the rule and the threshold are identical for both", so widening it changes what the rule *says*, never what
it *decides*. Every consequence of the threshold — inclusive boundary at `days >= stalenessDays`,
unreadable and future dates never stale (FR-029a), zero meaning "everything is stale" — is inherited
unchanged, because it is literally the same function.

**Alternatives considered**:
- *Reuse `subject: "item"` for calendar items.* Rejected: the user would be told "This has been waiting 14
  days. Chase it, or let it go." about something they flagged for their own calendar. Wrong noun, wrong
  remediation, and FR-038 requires the reason text to be right rather than merely present.
- *A `calendar.stale.check` point.* Rejected: it is the same question with a different subject, and the
  spec says in as many words to add no point.
- *A `calendarStalenessDays` policy key.* Rejected: FR-029 forbids it.

---

## R6 — The DRI filter

**Decision**: `ProjectService.listDetailed()`, filtered on
`summary.status === "active" && summary.dri.resolution === "mine"`. Core's existing `resolveDri` is used
through the summary it already produces; nothing about identity is recomputed or reimplemented, and no
identity code is copied into this module.

`unassigned` and `ambiguous` are excluded by the same predicate that excludes `theirs` — a single equality
against `"mine"`, so there is no branch where an unknown owner could be treated as the user (FR-019).

**Rationale**: Feature 4 chose to derive resolution per read rather than cache it, because a cache drifts
the moment a file is hand-edited. The spec's assumptions restate that choice and decline to revisit it. The
cost — one `identity.md` read and one pass over every project file — is what the read-count budget is
written against.

---

## R7 — Membership is frozen at open, and what the changed signal is for

**Decision**: The shutdown window **does not subscribe to `VaultChanged` or `InboxChanged`**, and re-reads
nothing while it is open. Membership and order are fixed by the single `read()` that built the screen
(FR-010a, FR-011a). A row updates in place from the **return value of the write the user just made** —
every relevant verb already returns the written state (`TopThreeOutcomeResult.week`, `ProjectOutcome`,
`WaitingOutcome.item`) — which is what FR-010b describes. Reopening calls `read()` again and rebuilds from
current state (FR-010c).

**On the plan input's sentence about the changed signal.** The input says: *"Open views reflect changes to
their underlying files through the generic changed signal established in Feature 2, so a capture made from
this screen or a change made in another window updates what is displayed without a close and reopen."* Read
as a statement about the shutdown re-reading itself, it contradicts FR-010a and FR-011a and the recorded
clarification behind them. Read as a statement about **the signal continuing to work**, it is satisfied
exactly and requires nothing new:

- The shutdown's writes all go through the shipped services and therefore through `FsVaultStore` and
  `FsInboxStore`, which is where `VaultChanged` and `InboxChanged` are raised. A capture made from this
  screen updates the open sort window; a milestone marked here updates the open projects window. Nothing
  about the shutdown teaches those windows anything.
- The clause "a capture made from this screen … updates what is displayed" can only mean *another* view,
  because the shutdown displays no inbox. That is the reading adopted here.

The plan proceeds on that reading. If the intent was that the shutdown itself re-reads while open, FR-010a
and FR-011a would have to be amended first, and this decision revisited — it is called out in the plan
Summary rather than buried here.

**Rationale**: The signal is raised in the adapters, so a write from any surface is seen by every open view
without any window knowing about any other. The shutdown is a consumer of nothing and a producer of the
ordinary signal.

**Alternatives considered**:
- *A retrospective-style "the vault changed, re-read?" notice.* Rejected. The retrospective earns its
  notice because a reading is copied out of and exported. A two-minute glance does not, and a banner
  inviting the user to re-run the shutdown is a nudge toward exactly the ritual FR-002–FR-007 exist to
  prevent. The case that actually matters — acting on something that changed underneath — is already
  handled by verify-before-write, which refuses and re-presents the item as it now reads (FR-040).

---

## R8 — Rebuilding on reopen when the window was only hidden

**Decision**: `ShutdownWindow.show()` sends `shutdown:opened` to its renderer; the renderer calls
`shutdown:read` on that signal as well as on first load. The window hides on close, like every other
window in the app.

**Rationale**: Every other window keeps itself current by re-reading on `vaultChanged`. This one
deliberately does not (R7), so without an explicit open signal a hidden-then-shown window would present the
screen it had when it was hidden — silently breaking FR-010c and FR-004, and looking exactly like the
resumption FR-005 forbids.

**Alternatives considered**:
- *Destroy the window on close so every open is cold.* Rejected: it diverges from every other window for a
  cosmetic gain, and costs a full renderer start on every open against a two-minute budget.

---

## R9 — Panel-level failure isolation

**Decision**: Each panel is built inside its own `try`/`catch` in `ShutdownService.read()`. Every panel is
one of two states and never both:

```ts
type Panel<T> = { items: T[]; failure: null } | { items: []; failure: SourceFailure };
interface SourceFailure { path: string; message: string }
```

`path` is the vault-relative source (`top-three.md`, `waiting.md`, `calendar.md`, or `projects/`), and
`message` is the underlying error's message verbatim. `read()` itself never rejects, so no panel can
prevent the screen opening (FR-011b), and an empty panel and a failed panel are different values that must
read differently (FR-011c).

**The known limit, recorded rather than papered over**: when one file inside `projects/` is unreadable for
a reason other than absence, `ProjectService.readAll` propagates the error and the whole project panel
fails. The failure names `projects/` unless the error carries a path. Naming the individual file would mean
changing a shipped service's read loop — the same boundary Feature 6 hit and recorded (006 Complexity
Tracking). It is in this plan's Complexity Tracking with its blast radius.

**Rationale**: FR-011b's "the other three MUST be built, displayed, and remain fully actionable" is a
statement about isolation, and isolation that lives in the client would have to be re-implemented by every
later client.

---

## R10 — Order, ages, and the absence of ranking

**Decision**:
- **Order is source order, everywhere.** Top three: file order. Projects: `listDetailed()` order, which is
  `list("projects")` sorted by slug. Waiting and calendar: file order. Nothing is sorted by staleness,
  age, or urgency (FR-009, FR-010), and nothing is truncated (FR-023).
- **Ages are computed once, at read, by `daysBetween`** against `today = localDate(clock.now())` taken once
  at the top of `read()`. Both numbers FR-027 requires — days since last touch and days waiting in total —
  come from that same `today`, so they cannot disagree. Nothing recomputes while the screen is open; the
  date changing under an open window changes nothing until it is reopened.

**Rationale**: `daysBetween` is already the single definition of "how many days", chosen so the ledger and
the staleness rule cannot round differently (`vault/lists.ts`). A second day count here would be the bug
that comment exists to prevent. Sorting by staleness would be ranking, which FR-009 forbids in as many
words.

---

## R11 — Testing strategy

**Decision**: `node --test` over compiled output with `TZ=America/New_York`, mirroring every existing
suite. A new `packages/core/tests/shutdown-fakes.ts` **reuses Feature 6's `retro-fakes.ts`** —
`readOnlyVault` (the throwing Proxy), `CountingVault`, `projectFile`, `topThreeFile` — and adds
`waitingFile` and `calendarFile` builders. Zero existing test files are modified.

The throwing Proxy is load-bearing twice: it counts reads for SC-013, and any attempt to reach `write` or
`appendLine` from the shutdown throws with a message naming the requirement rather than
`undefined is not a function`.

Six kinds of test carry the weight:

1. **Byte-for-byte immutability** (SC-002, FR-053) — snapshot every file, open, read every panel, close,
   compare. Paired with a deliberately-dirtying sibling proving the assertion has teeth: Feature 6 recorded
   that a read-only feature's headline test is the one that rots into a vacuous green (006 post-design
   re-check).
2. **Action parity** (SC-004) — two identical vaults; the same action through the shutdown's path and
   through the ordinary surface's; the file the verb owns compared byte for byte. One test per offered
   action, plus refusal parity on reason text (SC-005).
3. **One threshold, three subjects** (SC-006) — a fixture of waiting items and calendar items dated 0–30
   days old; assert membership of both panels at the default 7 and at one other value, including the
   boundary day itself; assert that waiting projects move with the same value. Changing one number moves
   all three sets or the test fails.
4. **Read counting, not timing** (SC-013) — 100 projects, `maxReadCount() === 1`.
5. **Degradation** (SC-011a) — missing `policy.md`, malformed threshold, missing `waiting.md`, missing
   `calendar.md`, unreadable project file: each leaves the shutdown openable with the unaffected panels
   displayed and actionable.
6. **Offline** (SC-009) — mirroring `retrospective-offline.test.ts` and `review-no-outbound.test.ts`.

Window behaviour under Playwright, in `packages/desktop/tests/e2e/` — **`playwright.config.ts` sets
`testDir` to that directory and a spec placed anywhere else is silently never run** (006 post-analysis
correction, repeated here so it is not re-learned).

**Rationale**: Every one of these forms already exists in the repo for a shipped feature; none is invented
for this one.

---

## R12 — Capture on this screen

**Decision**: The shutdown's capture box calls `capture:submit` and, on the returned id, offers the same
undo affordance the capture surface offers, calling `capture:undo`. `CaptureService` is unchanged, the
inbox path is unchanged, and the item carries nothing recording where it was typed (FR-045). Empty and
whitespace-only entries are refused by `EmptyCaptureError` as they already are (FR-048); consecutive
captures are separate items in order because the append queue already guarantees that (FR-047).

**Rationale**: Principle VI's budget and the non-blocking guarantee are properties of `CaptureService` and
its append queue, not of the surface. Reusing the channel inherits both. Nothing about capture is
re-implemented, so there is nothing that could drift.

**Alternatives considered**:
- *A `shutdown:capture` channel.* Rejected: FR-045's "indistinguishable" is easiest to guarantee when there
  is nothing to distinguish, and SC-008 compares the resulting inbox byte for byte.

---

## R13 — Vocabulary (Principle VII)

**Decision**: This feature introduces **no new domain term**. The screen is assembled from *top three*,
*outcome*, *project*, *DRI*, *next action*, *milestone*, *waiting for*, *followed up*, *received*,
*calendar-flagged*, *stale*, and *capture* — all of which already exist in the core and all of which mean
here exactly what they mean elsewhere. "Shutdown" names a window, not a concept in the data: nothing on
disk knows the word, and no file, field, or record uses it.

**Rationale**: FR-039 forbids introducing any concept the core does not have. The absence of an on-disk
representation makes that structural: there is no place a new term could be persisted.

---

## R14 — What is deliberately not built

Recorded so a later reader does not mistake absence for oversight. All are Out of Scope in the spec:
the local HTTP API; any AI-assisted suggestion, summary, or ranking on this screen; a daily log or any
record that a shutdown ran or did not; a stored tomorrow list or day state; scheduling, notification, or
anything that opens the screen other than the user; calendar integration beyond reading flags already
written; and any view over past days.

Two of these are guaranteed by construction rather than by discipline: **no record of the feature** (there
is no writable dependency on `ShutdownService`, R1) and **no suggestion** (there is no intelligence
dependency, and none is accepted).
