# Feature Specification: Daily Shutdown

**Feature Branch**: `009-daily-shutdown`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "I want a daily shutdown — a two-minute end-of-day pass that lets me close the laptop knowing nothing is hanging, and knowing what I'm walking into tomorrow.

It shows me four things at a glance, on one screen. My top three for the week, with what's done and what's still open, so I can see whether today moved them. The projects I'm the DRI on that are active, each with its next action, so tomorrow's starting point is in front of me. Waiting-for items that have gone quiet longer than my configured threshold, so I can chase them tomorrow. And anything I flagged for the calendar that's been sitting unscheduled too long — the same idea as a waiting-for item going stale, judged the same way against the same threshold.

Then it lets me dump whatever is still in my head into the inbox, right there, without leaving the screen — the loose threads I don't want to carry home. That's ordinary capture landing in the ordinary inbox, sorted later like everything else.

This is a glance, not a ritual. There are no ordered steps, nothing to gate on, nothing to pass, and nothing to resume — if I close it halfway through, there's nothing half-finished, because there's nothing to finish. It's not a second weekly review and it must not grow into one.

I can act on what I see, from where I see it: mark a top-three outcome done, mark a milestone done, change a next action, record that I followed up on a waiting-for item. Every one of those goes through exactly the same action I'd use anywhere else, with the same rules and refusals. Nothing here is a shortcut around anything.

The shutdown writes no record of itself. No daily log file, no history of shutdowns, no note that I ran it or skipped it. Everything it changes is a change to the thing itself — a milestone, an outcome, an item — recorded exactly as it would be from any other surface.

Nothing starts it, schedules it, reminds me about it, or nags me for missing a day. I open it when I want it. Skipping a week of them leaves no gap to fill, because there's nothing that records they were missed.

It must work with no network connection, and it must not generate, summarize, rank, or suggest anything. It shows me what's true and lets me act on it.

This feature does not include the local HTTP API, any AI-assisted suggestion, a daily log or record, any notion of a daily plan or a tomorrow list stored on disk, scheduling or notifications, calendar integration beyond reading what I already flagged, or any new report or view over past days."

## Clarifications

### Session 2026-08-18

- Q: When something on screen stops qualifying for its panel while the screen is still open, does it disappear right away or stay visible in its new state until the shutdown is reopened? → A: Membership is fixed at the moment the screen opens. Rows update in place to show their new state — done, just chased, no longer stale — but nothing is added, removed, or reordered until the shutdown is reopened. The glance is a snapshot of a moment, and "I chased four things" stays visible as four things at the end of the pass.
- Q: Can the waiting-for panel record that something arrived, or only that it was chased? → A: Both. The existing waiting-for action already takes either kind, and offering half of one verb is a narrowing rather than a smaller feature. "It arrived, we're done" is exactly the loose end an end-of-day pass should close, and it adds no new verb, file, or rule.
- Q: How fast must all four panels appear, and in what size of vault? → A: Within 1 second in a vault of 100 projects, reading each file at most once per opening — the same budget and the same read-counting verification Feature 5 set for the review's project step (005 SC-016), so both surfaces are held to one standard.
- Q: If a whole file behind a panel cannot be read, should the shutdown still open? → A: Always opens. The affected panel says what failed and names the file; the other three work normally and remain fully actionable. FR-003 already forbids anything preventing the screen opening, and Feature 5 held the review to the same standard (005 SC-018) — a broken file is exactly when the other three panels matter most.

### Amendments — 2026-08-18 (cross-artifact analysis)

Recorded rather than changed silently, so the reason survives the edit.

- **FR-011a and SC-013 now name what the read count covers.** "Each source file" was readable as "every
  file touched", which the shipped policy module makes impossible to satisfy: `DefaultPolicy.decide()`
  re-reads `policy.md` on every decision so an edited rule can never go stale, and staleness is asked once
  per candidate item. The count is over the files the panels are built from; the policy configuration is
  excluded. This matches how the weekly review's equivalent criterion (005 SC-016) already scopes its count
  to project files.
- **SC-001 names its verification method.** It is a judgement made by hand against the populated fixture —
  now written down as quickstart scenario 9 rather than left implied.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the Whole Day's Loose Ends on One Screen (Priority: P1)

It is 5:40pm. The user opens the shutdown and sees four panels at once, with no steps to walk and nothing
to click through. The top three for this week shows two outcomes still open and one marked done on Tuesday.
Four active projects they are the DRI on are listed, each with the next action they will pick up tomorrow.
Two waiting-for items have gone quiet past their threshold — one delegated eleven days ago and never chased,
one chased nine days ago and still not returned — and both say how long it has been. One calendar-flagged
item has been sitting unscheduled for two weeks. The user reads all of it in well under two minutes, closes
the window, and closes the laptop. Nothing on disk records that any of this happened.

**Why this priority**: This is the feature. Everything else hangs off having the four true things visible
together on one screen, and the glance alone is what makes the end of the day feel closed. It is also the
smallest genuinely useful slice: a read-only shutdown that changes nothing already answers "is anything
hanging, and what am I walking into tomorrow?"

**Independent Test**: With a fixture holding a current-week top three (one done, two open), six projects
covering active/waiting/parked/done and DRIs resolving to mine, someone else's, unassigned, and ambiguous,
four waiting-for items on either side of the threshold with and without follow-ups, and three
calendar-flagged items on either side of the threshold, open the shutdown and confirm each panel shows
exactly the right members and nothing else. Then confirm that opening and closing the shutdown leaves the
vault byte-for-byte unchanged.

**Acceptance Scenarios**:

1. **Given** a vault with data in all four areas, **When** the user opens the shutdown, **Then** all four
   panels are presented together on one screen, with no ordering, no step numbering, and no requirement to
   visit one before another.
2. **Given** the shutdown is open, **When** the user reads the top-three panel, **Then** it shows the
   current ISO week's outcomes with each one's done state, and a completion date for each that is done.
3. **Given** the current week has no top three set, **When** the shutdown is open, **Then** the panel says
   plainly that none is set, offers no suggestion of what to set, and is not an error.
4. **Given** projects with mixed statuses and DRIs, **When** the user reads the project panel, **Then** it
   lists exactly those projects whose status is `active` and whose DRI resolves to the user, each with its
   next action, and excludes every project that is parked, waiting, or done, and every project whose DRI is
   someone else's, unassigned, or ambiguous.
5. **Given** an active project of the user's with no next action recorded, **When** it is listed, **Then**
   the absence is shown plainly as "no next action" and nothing is invented, inferred, or suggested in its
   place.
6. **Given** waiting-for items on both sides of the configured staleness threshold, **When** the user reads
   the waiting panel, **Then** exactly the outstanding items untouched for longer than the threshold are
   listed, each showing who it is waiting on, how long since it was last touched, and how long it has been
   waiting in total.
7. **Given** a waiting-for item that has been received, **When** the shutdown is open, **Then** it is not
   listed however old it is, because it is no longer outstanding.
8. **Given** a waiting-for item chased yesterday but delegated three months ago, **When** the shutdown is
   open, **Then** it is not listed, because staleness is measured from the last action and chasing it is
   touching it.
9. **Given** calendar-flagged items on both sides of the threshold, **When** the user reads the calendar
   panel, **Then** exactly those flagged longer ago than the threshold are listed, each showing its text and
   how long it has gone unscheduled, and the threshold used is the same single configured value the waiting
   panel used.
10. **Given** an empty vault — no top three, no projects, an empty waiting list, no calendar-flagged items —
    **When** the user opens the shutdown, **Then** every panel says plainly that there is nothing in it, and
    no panel errors, disappears, or is replaced by something else.
11. **Given** the shutdown has been opened and closed, **When** the vault is inspected, **Then** no file
    records that a shutdown occurred: no daily log, no history, no timestamp, no counter, and no change of
    any kind attributable to opening or closing the screen.
12. **Given** the user closes the shutdown while reading it, **When** they open it again, **Then** it opens
    exactly as it would have from cold — nothing was in progress, nothing is resumed, and nothing is
    reported as unfinished.
13. **Given** the user has not opened the shutdown for two weeks, **When** they open the application,
    **Then** nothing prompts, reminds, nags, counts, or reports the days on which it was not opened.
14. **Given** no network connection at all, **When** the user opens the shutdown and reads every panel,
    **Then** everything works identically and nothing is contacted.
15. **Given** any panel with content, **When** it is displayed, **Then** nothing is generated, summarized,
    ranked by importance, scored, or suggested — items appear as they read on disk, in a stable order that
    is the same on a re-read of unchanged data.

---

### User Story 2 - Act on What I See Without Leaving the Screen (Priority: P2)

The user sees that one of this week's outcomes actually finished today, so they mark it done. A milestone on
one of their projects landed this afternoon, so they mark that done too. Tomorrow's next action on another
project is stale — the thing it names already happened — so they replace it right there. They emailed a
chaser about one of the quiet waiting-for items an hour ago, so they record the follow-up; another one
actually landed this afternoon, so they record it received and it is closed for good. Every one of these writes exactly what the same action writes anywhere else, and when
they try to mark a project's last milestone in a way that would trip a rule, they are refused with the same
message they would get in the weekly review.

**Why this priority**: A glance that shows rot but cannot fix it makes the user open a second surface to do
two seconds of work, and the two-minute pass becomes ten. It ranks second because the panels must exist
before anything can be acted on from them, and because the read-only shutdown is already useful.

**Independent Test**: From the shutdown alone, mark an outcome done, mark a milestone done, change a next
action, record a follow-up, and record a receipt. Confirm each write produces the byte-identical file change the same action
produces from its existing surface, that every decision point is consulted with the same result, and that a
refusal from any of them carries the same reason text. Confirm no additional file is written by any of them.

**Acceptance Scenarios**:

1. **Given** an open outcome in the current week's top three, **When** the user marks it done from the
   shutdown, **Then** it is recorded done with the local completion date, exactly as the same action
   records it from any other surface.
2. **Given** an outcome marked done from the shutdown, **When** the panel re-reads, **Then** it shows as
   done in place, and no second record of the completion exists anywhere.
3. **Given** a listed project with open milestones, **When** the user marks one done from the shutdown,
   **Then** it is recorded done with its completion date, identically to marking it anywhere else.
4. **Given** a listed project, **When** the user changes its next action from the shutdown, **Then** only
   the next action changes and the project's other fields are untouched.
5. **Given** a stale waiting-for item, **When** the user records a follow-up from the shutdown, **Then** a
   `followed up <date>` action is appended under the item, the original waiting-since date is preserved, and
   the item is shown in place as just chased — it stays listed for the rest of this opening, and is absent
   from the stale list the next time the shutdown is opened.
5a. **Given** a stale waiting-for item, **When** the user records it received from the shutdown, **Then** a
    `received <date>` action is appended under the item, identically to recording it received anywhere else,
    and the item is no longer outstanding — so it never appears in the panel again, at any age.
5b. **Given** a waiting-for item already recorded as received, **When** the user opens the shutdown, **Then**
    it is not listed, and no way to chase or re-receive it is offered from this screen.
6. **Given** any action taken from the shutdown, **When** it is written, **Then** it goes through the same
   core verb the existing surfaces use, and the same named decision points are consulted with the same
   inputs.
7. **Given** an action a rule refuses, **When** the user attempts it from the shutdown, **Then** they are
   refused with the same decision, the same reason text, and the same named remediation they would receive
   from any other surface — the shutdown is not a way around any rule.
8. **Given** a rule that warns rather than blocks, **When** the user proceeds from the shutdown, **Then**
   they see the same warning and the same choice, with no shortcut, no suppression, and no
   "don't ask me again".
9. **Given** the shutdown is showing an item, **When** that item is edited in a text editor and the user
   then saves a change to it, **Then** the write is refused and the item is re-presented as it now reads,
   inheriting the existing verify-before-write behavior unchanged.
10. **Given** any write made from the shutdown, **When** the vault is inspected, **Then** the only change is
    to the thing itself — the outcome, the milestone, the next action, the waiting-for item — with no
    record that the change was made from the shutdown rather than from anywhere else.
11. **Given** a listed calendar-flagged item, **When** the user looks for something to do with it, **Then**
    it is presented as information only, with no scheduling, no dismissing, and no writing back to the
    calendar list.
12. **Given** the user takes no action at all, **When** they close the shutdown, **Then** nothing is
    written, nothing is defaulted, and nothing is marked as seen, acknowledged, or reviewed.

---

### User Story 3 - Dump What's Still in My Head Into the Inbox (Priority: P3)

Reading the four panels reminds the user of three things that are nowhere in the system: a promise made in a
corridor, a question for someone tomorrow, and a nagging thought about a vendor renewal. They type each one
into the shutdown's capture box without leaving the screen. All three land in the ordinary inbox, in the
ordinary shape, and get sorted next time like everything else.

**Why this priority**: This is what actually empties the head, and it is the last thing the two-minute pass
needs. It ranks third because capture already exists and works elsewhere; having it on this screen is a
convenience that removes the one reason to leave mid-glance.

**Independent Test**: From the shutdown, capture three items in a row and confirm each lands in the inbox
with the same grammar, timestamp, and undo behavior as an item captured from the existing capture surface,
that focus stays on the shutdown throughout, and that the inbox file is indistinguishable from one produced
by capturing the same three items anywhere else.

**Acceptance Scenarios**:

1. **Given** the shutdown is open, **When** the user types a thought and confirms it, **Then** it is
   captured into the ordinary inbox with its capture timestamp, verbatim, in the same shape any other
   capture produces.
2. **Given** an item has just been captured, **When** the user looks at the screen, **Then** they are still
   on the shutdown, the box is ready for the next thought, and no panel has been navigated away from.
3. **Given** several thoughts in a row, **When** the user captures each, **Then** each is a separate inbox
   item in capture order, and none is merged, deduplicated, split, or rewritten.
4. **Given** an item captured from the shutdown, **When** the inbox is read, **Then** it is
   indistinguishable from an item captured anywhere else — no marker, tag, or field records where it came
   from.
5. **Given** the user is typing a thought, **When** they close the shutdown without confirming it, **Then**
   nothing is captured and nothing is saved as a draft.
6. **Given** capture from the shutdown, **When** the user confirms an item, **Then** it responds within the
   same capture time budget and never blocks on disk, exactly as the existing capture surface does.
7. **Given** an item captured from the shutdown, **When** the user reaches for undo, **Then** the same undo
   affordance exists with the same behavior it has at the existing capture surface.
8. **Given** an empty or whitespace-only entry, **When** the user confirms it, **Then** nothing is captured
   and no empty item enters the inbox.

---

### Edge Cases

- **A panel's source cannot be read at all.** The shutdown opens anyway. That panel names the file and says
  it could not be read; the other three are unaffected, including every action offered on them.
- **A panel's source file does not exist.** No `top-three.md`, no `waiting.md`, no `calendar.md` — each panel
  shows its empty state, and the shutdown never creates a file merely because it looked for one.
- **A line the grammar cannot read.** An unreadable line in `waiting.md` or `calendar.md` has no date and
  nothing to be stale about. It is never listed as stale, never counted, never rewritten, and never silently
  dropped; where a panel reports its source's problems, it names the line as it reads on disk so the user
  can fix it in their editor.
- **A hand-edited status with no ledger entry.** A project moved into `active` by hand has no recorded start
  for its current status. It is still listed if its DRI resolves to the user; no date is invented.
- **No `policy.md`, or a threshold that will not parse.** The documented default staleness threshold applies,
  the same value the weekly review uses, and the problem is reported for display rather than thrown.
- **A threshold of zero.** Everything outstanding is stale by definition; the panels list it all rather than
  treating zero as "off".
- **A DRI that is ambiguous against another name.** The project is excluded from the panel — ambiguous is
  not "mine", exactly as it is not counted against the WIP limit — and nothing guesses which human it is.
- **The date changes while the screen is open.** Ages shown were computed against the day the screen read
  the data; nothing recomputes silently behind the user, and reopening the shutdown shows the newer numbers.
- **The vault changes underneath the screen.** Membership was fixed when the screen opened, so nothing
  appears or vanishes while it is open — including when another window writes to the same vault. Any write
  the user then attempts against something that changed underneath is refused by the existing
  verify-before-write behavior rather than overwriting the change, and the item is re-presented as it now
  reads.
- **A very long list.** Thirty stale waiting-for items are all listed, in full, in stable order; nothing is
  truncated to a "top" few, collapsed into a count, or prioritized.
- **The user closes the window mid-action.** There is nothing in progress to lose: writes already made stand
  as the writes they were, and nothing partial, resumable, or half-finished exists to come back to.
- **The weekly review is open at the same time.** The shutdown holds no state of its own and gates on
  nothing, so both surfaces read the same data and write through the same verbs with no interaction beyond
  the existing verify-before-write behavior.

## Requirements *(mandatory)*

### Functional Requirements

#### The screen itself

- **FR-001**: The system MUST provide a daily shutdown surface that presents four panels — the current
  week's top three, the user's active projects, stale waiting-for items, and stale calendar-flagged items —
  together, on one screen.
- **FR-002**: The shutdown MUST NOT impose an order on the panels' use: no step sequence, no numbering, no
  "next", no prerequisite, and no panel that must be visited before another is available.
- **FR-003**: The shutdown MUST NOT gate on anything. No condition — a full inbox, an unset top three, a
  stale item, a project needing structure — may prevent it opening or prevent any part of it being used.
- **FR-004**: The shutdown MUST hold no state of its own between openings. Opening it MUST produce the same
  screen regardless of how or when the previous opening ended.
- **FR-005**: The shutdown MUST NOT be resumable, and MUST NOT present itself as complete, incomplete,
  passed, skipped, or in progress at any time.
- **FR-006**: The shutdown MUST NOT be startable by anything other than the user opening it: no schedule, no
  timer, no launch-on-open, no end-of-day trigger, and no prompt to run it.
- **FR-007**: The system MUST NOT notify, remind, nag, or otherwise surface the fact that a shutdown was not
  opened on any day, and MUST NOT count, store, or display days on which it was not opened.
- **FR-008**: The shutdown MUST function fully with no network connection, and MUST NOT contact any external
  or remote system.
- **FR-009**: The shutdown MUST NOT generate, summarize, rank, score, prioritize, or suggest any content. It
  MUST present what is on disk and nothing else.
- **FR-010**: Every panel MUST present its members in a stable order that is identical on a re-read of
  unchanged data.
- **FR-010a**: Panel membership MUST be determined once, when the shutdown is opened. While it remains open,
  no item may be added to a panel, removed from it, or reordered — not by the user's own actions, and not by
  a change made in another window or in a text editor.
- **FR-010b**: When the user acts on a listed item, its row MUST update in place to show its new state —
  done, just chased, no longer stale — so the action is visibly confirmed without the item leaving the panel.
- **FR-010c**: Reopening the shutdown MUST re-read every source from disk and rebuild membership from current
  state, so a chased item is gone from the stale list on the next opening.
- **FR-011**: Every panel MUST have an explicit empty state that states plainly that there is nothing in it,
  and MUST NOT error, vanish, or substitute other content when empty.
- **FR-011a**: Building the screen MUST read each panel's source file at most once per opening. Because
  membership is fixed at open (FR-010a), no panel may re-read while the screen stays open. The count is over
  the files the panels are built from — `top-three.md`, `identity.md`, each project file, `waiting.md`,
  `calendar.md`. It does not include the policy configuration: the policy module re-reads `policy.md` on
  every decision by design, so that an edited rule takes effect without a restart, and staleness is asked
  once per candidate item. This feature does not change that, and MUST NOT cache around it.
- **FR-011b**: A source that cannot be read at all — a missing directory, a disk error, or content the
  grammar cannot make any sense of — MUST NOT prevent the shutdown opening. The affected panel MUST state
  what failed and name the file; the other three MUST be built, displayed, and remain fully actionable.
- **FR-011c**: A failed source MUST NOT be repaired, recreated, rewritten, or emptied by the shutdown, and
  MUST NOT be presented as an empty panel — "nothing here" and "could not read this" are different answers
  and MUST read differently.

#### Panel 1 — the week's top three

- **FR-012**: The top-three panel MUST show the current ISO week's outcomes, using the same week definition
  the existing weekly top three uses.
- **FR-013**: The panel MUST show each outcome's text verbatim, its done state, and the completion date of
  each outcome that is done.
- **FR-014**: The panel MUST show the open and done outcomes together so the week's whole commitment is
  visible at once, rather than filtering to one or the other.
- **FR-015**: When no top three is set for the current week, the panel MUST say so and MUST NOT propose,
  pre-fill, or suggest outcomes.
- **FR-016**: The panel MUST NOT show or offer any other week — no past week, no next week — because the
  shutdown is a view of today against this week's commitment.

#### Panel 2 — my active projects

- **FR-017**: The project panel MUST list exactly those projects whose status is `active` and whose DRI
  resolves to the user, using the existing identity resolution unchanged.
- **FR-018**: The panel MUST exclude projects whose status is `parked`, `waiting`, or `done`.
- **FR-019**: The panel MUST exclude projects whose DRI resolves to someone else, to unassigned, or to
  ambiguous, and MUST NOT guess the identity behind an ambiguous DRI.
- **FR-020**: Each listed project MUST show its title and its next action.
- **FR-021**: A project with no next action MUST be shown with that absence stated plainly, and the system
  MUST NOT infer, derive, or suggest one.
- **FR-022**: Each listed project MUST show its open milestones, so a milestone finished today can be marked
  done from here.
- **FR-023**: The panel MUST NOT limit, truncate, or rank the projects it lists.

#### Panels 3 and 4 — what has gone quiet

- **FR-024**: The waiting panel MUST list exactly those waiting-for items that are still outstanding and
  have been untouched for at least as many days as the configured staleness threshold. The boundary is
  inclusive, matching the shipped staleness rule exactly: at the default of 7, an item last touched 7 days
  ago is stale and one touched 6 days ago is not.
- **FR-025**: Staleness for a waiting-for item MUST be measured from the item's most recent recorded action,
  or from the date it started waiting when it has none — the same measure the weekly review uses.
- **FR-026**: An item with a recorded receipt MUST NOT be listed, regardless of its age.
- **FR-027**: Each listed waiting-for item MUST show who it is waiting on, its text verbatim, how long since
  it was last touched, and how long it has been waiting in total, so "chased weekly for three months" is
  distinguishable from "delegated three months ago and forgotten".
- **FR-028**: The calendar panel MUST list exactly those calendar-flagged items flagged at least as many
  days ago as the configured staleness threshold, showing each item's text verbatim and how long it has gone
  unscheduled. The boundary is the same inclusive one FR-024 states, because it is the same rule.
- **FR-029**: Both panels MUST use the same single configured staleness threshold value. The system MUST NOT
  introduce a second, separate, or calendar-specific threshold.
- **FR-029a**: A date that cannot be read, or one in the future, MUST NOT be treated as evidence of neglect:
  such an item MUST NOT be listed as stale, matching how the shipped staleness rule already answers.
- **FR-030**: The staleness threshold MUST be read from the existing policy configuration stored with the
  data, and its documented default MUST apply when the configuration is absent or a value cannot be read.
- **FR-031**: The system MUST NOT read from, write to, or contact any external or system calendar; the
  calendar panel reads only the items the user already flagged.
- **FR-032**: A source line the grammar cannot read MUST NOT be listed as stale, counted, rewritten, or
  discarded, and MUST be surfaced as it reads on disk wherever the surface reports its source's problems.

#### Acting from the shutdown

- **FR-033**: The user MUST be able to mark a top-three outcome done from the shutdown.
- **FR-034**: The user MUST be able to mark a project milestone done from the shutdown.
- **FR-035**: The user MUST be able to change a listed project's next action from the shutdown.
- **FR-036**: The user MUST be able to record a follow-up on a listed waiting-for item from the shutdown.
- **FR-036a**: The user MUST be able to record a listed waiting-for item as received from the shutdown, using
  the same existing action and its other kind. Both kinds MUST be offered on every listed item, and the
  system MUST NOT infer, prefer, or default to either.
- **FR-037**: Every action taken from the shutdown MUST be performed by the same core verb the existing
  surfaces use for that action, with the same inputs and the same effect on disk.
- **FR-038**: Every action taken from the shutdown MUST consult the same named decision points, and MUST
  surface the resulting allow, warn, or block with the same reason text and the same named remediation the
  user would receive from any other surface.
- **FR-039**: The shutdown MUST NOT introduce any action, verb, concept, or vocabulary that does not already
  exist in the core, and MUST NOT offer a bypass, override, suppression, or "don't ask again" for any rule.
- **FR-040**: Every write attempted from the shutdown MUST inherit the existing verify-before-write
  behavior: a mismatch against what was on screen cancels the write, leaves the file unchanged, and
  re-presents the item as it now reads.
- **FR-041**: The shutdown MUST NOT change anything on the user's behalf. It MUST NOT auto-complete, park,
  chase, reschedule, dismiss, or clear anything, and taking no action MUST write nothing.
- **FR-042**: Calendar-flagged items MUST be presented as information only. The shutdown MUST NOT offer to
  schedule, dismiss, clear, or otherwise write to the calendar list.

#### Capture from the shutdown

- **FR-043**: The user MUST be able to capture free-text items into the ordinary inbox from the shutdown
  without navigating away from it.
- **FR-044**: A captured item MUST land in the same inbox, with the same grammar, verbatim text, and capture
  timestamp any other capture produces.
- **FR-045**: A captured item MUST carry no marker, tag, field, or ordering that records it came from the
  shutdown, and MUST be sorted later exactly like any other inbox item.
- **FR-046**: Capture from the shutdown MUST meet the same capture responsiveness budget and MUST NOT block
  on disk I/O, inheriting the existing capture behavior.
- **FR-047**: Consecutive captures MUST each produce a separate inbox item in capture order, with no
  merging, splitting, deduplication, or rewriting.
- **FR-048**: An empty or whitespace-only entry MUST NOT be captured.
- **FR-049**: Undo MUST be available for a capture made from the shutdown with the same behavior it has at
  the existing capture surface.

#### What the shutdown must never write

- **FR-050**: The shutdown MUST NOT write any record of itself: no daily log file, no shutdown history, no
  run or skip record, no timestamp of last opening, and no counter.
- **FR-051**: Every change the shutdown makes MUST be a change to the underlying thing — an outcome, a
  milestone, a next action, a waiting-for item, an inbox item — recorded exactly as the same change is
  recorded from any other surface.
- **FR-052**: The system MUST NOT store any notion of a daily plan, a tomorrow list, a carried-over item, or
  a day's state.
- **FR-053**: Opening and closing the shutdown without acting MUST leave the vault byte-for-byte unchanged.

### Key Entities

- **Shutdown view**: A derived, read-at-open composition of four existing lists. It is not stored, has no
  identity, no lifecycle, and no persisted state. It exists only while the screen is open.
- **Stale waiting-for item**: An existing waiting-for item that is outstanding and whose last touch is older
  than the configured threshold. Staleness is derived at read time and never stored on the item.
- **Stale calendar-flagged item**: An existing calendar-flagged item whose flag date is older than the same
  configured threshold. Derived the same way, for the same reason.
- **Staleness threshold**: The existing single policy value governing how long any subject may sit untouched
  before it is surfaced. Read, never written, by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with a populated vault can read all four panels and know what is hanging and what they
  are starting tomorrow in under two minutes, without leaving the screen — verified by hand against the
  populated fixture (quickstart scenario 9), because no unit test can make this judgement.
- **SC-002**: Opening the shutdown, reading every panel, and closing it leaves 100% of vault files
  byte-for-byte unchanged.
- **SC-003**: After any number of shutdowns over any number of days, no file anywhere in the vault records
  that a shutdown was opened, or that one was not — verified by full-vault comparison against a run in which
  the same changes were made from the existing surfaces instead.
- **SC-004**: For every action the shutdown offers, the resulting file change is byte-identical to the same
  action performed from its existing surface — verified on 100% of the offered actions.
- **SC-005**: For every action the shutdown offers, an attempt that a rule refuses produces the same
  decision and the same reason text as the same attempt from any other surface — verified on 100% of the
  refusals reachable from this screen.
- **SC-006**: Across a fixture of waiting-for items and calendar-flagged items dated from 0 to 30 days old,
  both panels list exactly the members at or past the configured threshold and no others, at the default
  value and at one other — 100% correct, including at the boundary day itself, with changing the single
  threshold changing both panels.
- **SC-007**: Against a fixture covering every project status and every DRI resolution, the project panel
  lists exactly the active-and-mine projects — 100% correct, with ambiguous and unassigned DRIs never
  listed.
- **SC-008**: An item captured from the shutdown is indistinguishable in the inbox from the same item
  captured elsewhere — verified by byte comparison of the resulting inbox.
- **SC-009**: The shutdown opens, displays, and accepts every action with no network available, and no
  outbound connection is attempted — verified with networking disabled.
- **SC-010**: Closing the shutdown at any point during use leaves nothing incomplete: a subsequent opening
  presents the same screen a cold opening would, with no resume, no prompt, and no partial state — verified
  by closing at each panel and at mid-capture.
- **SC-011**: An empty vault produces four explicit empty panels and zero errors.
- **SC-011a**: A missing policy configuration, a malformed threshold value, a missing waiting-for file, a
  missing calendar file, and an unreadable project file each leave the shutdown openable with every
  unaffected panel displayed and actionable, in 100% of tested paths.
- **SC-012**: Marking an outcome done, marking a milestone done, changing a next action, and recording a
  follow-up each leave every panel's membership and order unchanged for the remainder of that opening, with
  only the acted-on row showing its new state — verified on 100% of the offered actions, and verified again
  against a concurrent write from a second window.
- **SC-013**: The shutdown presents all four panels within 1 second in a vault of 100 projects, and reads
  each panel source file at most once to build them — verified by counting reads, not by timing, the same
  way the weekly review's project step is verified, and scoped to those source paths the same way that
  criterion scopes its own count to project files. The policy configuration is excluded, per FR-011a.

## Assumptions

- **The four panels read existing data only.** The top three, projects, waiting-for list, and
  calendar-flagged list all already exist on disk. This feature introduces no new data file and no new field
  on any existing one.
- **`calendar.md` is written today but never read.** Sorting has recorded a flag date on every
  calendar-flagged item precisely so a later feature could measure staleness; this is that feature, so the
  ability to read that list is expected to be new work even though its format is already fixed.
- **"The week" means the current ISO week**, the same definition the existing weekly top three and weekly
  review use. The shutdown shows only that week.
- **"Active" means the project status `active`**, exactly. Projects in `waiting` are deliberately excluded:
  the weekly review is where a blocked project gets questioned, and pulling that question into the daily
  glance is the first step toward it becoming a second review.
- **"Mine" means the DRI resolves to the user.** Unassigned and ambiguous are not mine, matching how the WIP
  limit already counts, so the same project is treated the same way on both screens.
- **The staleness threshold is the existing single policy value**, shared by both panels, with its existing
  documented default. Nothing here makes it separately configurable per subject, and this feature adds no
  new policy value and no new decision point — it enforces no rule of its own, so there is nothing for one
  to decide.
- **Calendar-flagged items are read-only here.** The user's list of things to act on does not include them,
  and no verb exists today to clear a flag; adding one would be calendar work beyond "reading what I already
  flagged".
- **Marking a top-three outcome done is already permitted for the current week**, which is inside the
  existing writable window, so this feature needs no widening of it.
- **Identity resolution stays derived per read, uncached.** The DRI panel needs every project's names to
  answer "is this DRI ambiguous?", which Feature 4 deliberately chose to derive per read rather than cache.
  This feature does not revisit that choice; it states a budget the once-per-opening read must fit inside.
- **The shutdown is a client surface only.** All four reads and all four writes are core capabilities;
  the surface routes input and renders, and holds no domain logic of its own.

## Out of Scope

- The local HTTP/JSON API.
- Any AI-assisted suggestion, generation, summary, ranking, or prioritization on this screen.
- A daily log, shutdown history, or any record that a shutdown was run or missed.
- Any stored notion of a daily plan, a tomorrow list, or carried-over items.
- Scheduling, notifications, reminders, alarms, or anything that starts or prompts the shutdown.
- Calendar integration beyond reading the items the user already flagged — no external calendar is read,
  written, or contacted, and no flag is scheduled or cleared.
- Any new report or view over past days, or any trend, streak, or comparison across days.
- Anything that turns the glance into a ritual: ordered steps, gates, completion, resumption, or a record of
  having been performed.
