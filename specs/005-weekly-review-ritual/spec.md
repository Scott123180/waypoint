# Feature Specification: Weekly Review Ritual

**Feature Branch**: `005-weekly-review-ritual`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "I want a weekly review ritual — a guided sequence I run at the same time each week that walks me through everything I've committed to, so nothing quietly rots.

The review moves through steps in order. First, my inbox: it shows me how many items are sitting there and lets me go sort them, because reviewing while the inbox is full means reviewing an incomplete picture. Second, my projects: it walks me through each active project one at a time and asks what happened — I can update its status, change its next action, mark milestones done, or park it. Projects flagged as needing structure or needing a DRI are surfaced here too, because this is when I have time to fix them. Third, my waiting-for list: it shows me anything that's been sitting untouched longer than a configured threshold so I can nudge it, and lets me mark items as followed up or received. Fourth, it asks me to set next week's top three, and shows me last week's so I can see what I actually finished before committing to more.

I can pause partway through and come back — each decision I make is saved as I go, and reopening the review picks up where I left off rather than starting over. A review belongs to a specific week, using the same week definition the top three already uses.

When I finish, the review is written to a plain-text log file for that week, recording what I reviewed, what changed, what I said was done, and what slipped. Past reviews are kept permanently and are readable as a record — this is the raw material a later retrospective will read.

Whether an unsorted inbox stops me from proceeding is a rule, not a fact about my data, so it lives in the policy module and I can change it. The staleness threshold for waiting-for items is a rule too, and lives in the same place with a documented default.

The review never changes anything on my behalf. It surfaces, prompts, and records what I decide. It does not auto-park stale projects, does not auto-nudge anyone, and does not generate the summary text for me.

This feature does not include the retrospective view across date ranges, the local API, calendar integration, sending actual reminders or messages to anyone, or any AI-assisted suggestions.

Whether an unsorted inbox stops me from proceeding is a rule, not a fact about my data, so it lives in the policy module. It ships defaulting to a warning — I'm told how many items are waiting and can proceed anyway — and I can configure it to block instead. The staleness threshold for waiting-for items is a rule too, and lives in the same place with a documented default."

## Clarifications

### Session 2026-08-15

- Q: When the review walks your projects, should it show you only the ones with status `active`, or also the ones sitting in `waiting`? → A: Walk `active` and `waiting`; additionally flag a `waiting` project that has been waiting longer than the staleness threshold and ask whether it is genuinely still blocked — closing the WIP limit's pressure valve the roadmap assigns to this feature.
- Q: Does the review let you write your own free text into the week's log, and if so, where? → A: One optional free-text note at the end of the review, recorded verbatim, skippable, never pre-filled. **And** core declares a summary port at the review's completion — the same kind of seam `TranscriptionPort` already is — so a later LLM provider can draft a summary that supplements the user's note. No provider ships here: the review works fully with none, nothing leaves the machine by default, a generated summary requires explicit acceptance, and it is recorded attributed as generated and separate from the user's own words.
- Q: When you run the review in week W, which week's top three does the last step ask you to set? → A: Week W+1, the week ahead, showing week W — the week being reviewed — as what was actually finished. This widens Feature 4's writable window from the current week to the current week and the next; weeks before the current one stay read-only. The widening applies everywhere, not only inside the review.
- Q: When you mark a waiting-for item as followed up or as received, what should change in `waiting.md`? → A: The same shape the project ledger takes. Actions accumulate as indented lines under the item — `followed up <date>`, `received <date>` — reusing the inbox's existing continuation grammar. The original waiting-since is preserved so total age stays visible, staleness is measured from the most recent action, and a received item stops being outstanding while its record stays in place.
- Q: How should the system know how long a project has been sitting in `waiting`? → A: Not a purpose-built field. A state change is metadata about the project, so a project carries an append-only **ledger** of the actions taken on it — each entry recording the action, when it happened, and how long the state it ended had lasted. Staleness is read from the ledger by whoever cares (the policy rule, a later feature), rather than core deciding in advance which durations are worth keeping.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the Ritual End to End and Get a Permanent Record (Priority: P1)

Monday morning, the user opens the review. It tells them their inbox has eleven items sitting in it and offers
to take them to sort. They proceed anyway, because the warning is a warning. The review walks them through the
four steps in order, and when they finish, a plain-text file for that week exists on disk recording what they
looked at, what they changed, what they called done and what slipped. Three months later that file still reads
exactly as it did the day it was written.

**Why this priority**: This is the ritual itself — the ordered spine, the completion, and the durable record.
Every other story is a step hanging off it, and the log file it produces is the raw material Feature 6's
retrospective will read. It is also the smallest slice that is genuinely useful: even with each step doing the
minimum, a user who runs it weekly now has a written history of their commitments where they previously had
none.

**Independent Test**: With one project, one waiting-for item, and a non-empty inbox on disk, start a review,
move through all four steps making no changes at all, and complete it. Confirm a log file for the current ISO
week exists, is readable in a text editor with no application running, names the week it belongs to, and
records each step as reviewed. Then run a second review the following week and confirm the first week's file
is byte-for-byte unchanged.

**Acceptance Scenarios**:

1. **Given** no review exists for the current week, **When** the user starts a review, **Then** a review for
   the current ISO week is opened at the first step, and no prior week's review is altered.
2. **Given** a review is open, **When** the user works through it, **Then** the steps are presented in the
   order inbox → projects → waiting-for → top three, and a later step cannot be reached before an earlier one
   has been passed.
3. **Given** the user is on a later step, **When** they go back to an earlier one, **Then** the earlier step is
   shown with the decisions already recorded against it, and nothing is discarded.
4. **Given** every step has been passed, **When** the user completes the review, **Then** the week's log file
   records what was reviewed, what changed, what was marked done, and what slipped.
4a. **Given** the user is completing a review, **When** they are offered a note, **Then** it is empty, and
    whatever they type is recorded verbatim as their own words.
4b. **Given** the user skips the note, **When** the review completes, **Then** the log shows no note was
    written and nothing is generated in its place.
4c. **Given** no summary provider is supplied — the shipped configuration — **When** the review completes,
    **Then** it completes normally, nothing is sent anywhere, and no broken or disabled summary affordance is
    shown.
4d. **Given** a summary provider is supplied and a draft is produced, **When** the user declines it, **Then**
    the log is exactly what it would have been without it.
4e. **Given** a summary provider is supplied and the user accepts a draft, **When** the log is read later,
    **Then** the generated text is attributed as generated, names its provider, and is plainly separate from
    the user's own note.
4f. **Given** a summary provider is supplied but unreachable, **When** the user completes the review, **Then**
    the failure is surfaced, the review completes with the user's note alone, and nothing is blocked.
5. **Given** a completed review for the current week, **When** the user opens the review again, **Then** it is
   presented as a finished record and offers no way to re-run or overwrite it in the application.
6. **Given** completed reviews for several past weeks, **When** the user lists them, **Then** each is readable,
   identified by its week, most recent first, and none has been pruned, rotated, or summarized away.
7. **Given** a completed review, **When** it is opened in a plain-text editor with no application running,
   **Then** every recorded decision is legible without the application to interpret it.
8. **Given** an empty vault — no projects, an empty waiting-for list, an empty inbox, no top three — **When**
   the user runs a review, **Then** every step completes with an explicit "nothing here" rather than an error
   or a skipped step, and a log file is still written.
9. **Given** a review is open, **When** the user abandons it without completing, **Then** nothing is forced,
   no step is auto-completed, and no completed log is written.
10. **Given** no review has ever been run, **When** the user opens the application, **Then** the system never
    starts a review, schedules one, or interrupts the user to demand one.

---

### User Story 2 - Walk Every Project I Am Carrying and Say What Happened (Priority: P2)

The user has nine active projects and four sitting in `waiting`. The review shows them one at a time: the
outcome, the next action, who the DRI is, and which milestones are still open. On the first, nothing has moved
in three weeks, so they park it. On the third, they mark a milestone done. On the fourth, the next action is
stale — the thing it names already happened — so they replace it. One of the waiting projects has been waiting
five weeks, and the review says so and asks whether it is genuinely still blocked; it is not, so the user takes
it back to active. Two of the nine are stubs sort created weeks ago: one has no DRI and one has no outcome or
milestones, and both say so plainly right there in the walk, which is exactly when the user has time to fix
them. The rest they look at and pass over unchanged, which is itself recorded.

**Why this priority**: This is the step that catches the rot, and it is the largest single piece of the ritual.
It ranks second because the spine has to exist first, but it is where the feature earns its keep: a project
nobody has looked at in a month is the failure mode the whole ritual exists to prevent. Including `waiting`
projects is what closes the WIP limit's pressure valve, which the roadmap assigns to this feature explicitly.

**Independent Test**: With a fixture covering one fully structured active project, one missing a DRI, one
missing an outcome, one with open milestones, and two in `waiting` on either side of the staleness threshold,
walk the project step start to finish. Confirm each project is presented exactly once, in a stable order, with
its structure gaps and needs-a-DRI signal shown; confirm the over-threshold waiting project is flagged as
stale and the other is not; confirm a status change, a next-action change, and a milestone completion each
write through and are recorded; and confirm a project passed over with no change is recorded as reviewed
rather than as absent.

**Acceptance Scenarios**:

1. **Given** nine active projects and four waiting ones, **When** the project step runs, **Then** all thirteen
   are presented one at a time, exactly once each, in a stable order that is the same on a re-read of
   unchanged data, and no parked or done project is presented.
1a. **Given** a project that has been in `waiting` longer than the configured staleness threshold, **When** it
    is presented, **Then** it is flagged as stale, the user is told how long it has been waiting, and they are
    asked whether it is genuinely still blocked.
1b. **Given** a project that has been in `waiting` for less than the threshold, **When** it is presented,
    **Then** it is walked like any other project and is not flagged as stale.
1c. **Given** a stale waiting project, **When** the user answers that it is not genuinely blocked and takes it
    back to active, **Then** the status change goes through the WIP limit like any other, and the review
    records both the question and what the user did.
1d. **Given** a stale waiting project, **When** the user leaves it waiting, **Then** its status is unchanged,
    nothing is auto-parked or auto-reactivated, and the log records that it was surfaced and left.
1e. **Given** a project whose status changes during the walk, **When** the change is written, **Then** the
    project's ledger gains one entry naming the status it left, the status it entered, and the date — the
    same entry the same change would produce from any other surface.
1f. **Given** a project hand-edited into `waiting` with no ledger entry for it, **When** it is presented,
    **Then** it is walked with an unknown waiting duration, is not flagged stale, and no date is invented.
2. **Given** a project is presented, **When** the user looks at it, **Then** they see its title, status,
   outcome, next action, DRI and how that DRI resolves, and its milestones with their done state.
3. **Given** a project flagged as needing structure, **When** it is presented in the walk, **Then** the gaps
   are named, and the user is offered the chance to fix them without leaving the review.
4. **Given** a project with no DRI, **When** it is presented, **Then** the needs-a-DRI signal is shown, it is
   distinct from any structure gap, and it blocks nothing.
5. **Given** a project is presented, **When** the user changes its status, **Then** the change is written
   through the same core verb any other surface uses, and the same decision points are consulted.
6. **Given** the user is at their WIP limit, **When** they try to take a project to active inside the review,
   **Then** they are refused with the same message, count, and named remediation projects they would get
   anywhere else — the review is not a way around the limit.
7. **Given** a project with open milestones, **When** the user marks it done inside the review, **Then** the
   same confirmation fires, naming the still-open milestones, exactly as it does outside the review.
8. **Given** a project is presented, **When** the user parks it, **Then** its status becomes parked and the
   review records that the user parked it.
9. **Given** a project is presented, **When** the user changes its next action, **Then** only the next action
   changes, and the review records the change.
10. **Given** a project is presented, **When** the user marks a milestone done, **Then** it is recorded done
    with its completion date, exactly as it would be outside the review.
11. **Given** a project is presented, **When** the user makes no change and moves on, **Then** it is recorded
    as reviewed with no change — distinguishable in the log from a project that was never reached.
12. **Given** a project that has not been touched in months, **When** the project step runs, **Then** the
    system never parks it, changes its status, rewrites its next action, or alters it in any way on the user's
    behalf.
13. **Given** a project is edited in a text editor while the review has it on screen, **When** the user saves a
    change to the field that was edited, **Then** the write is refused and the project is re-presented as it
    now reads, inheriting the existing verify-before-write behavior.

---

### User Story 3 - Pause Partway and Come Back (Priority: P3)

The user gets four projects into the walk and a meeting starts. They close the window. That evening they open
the review again and it opens on the fifth project, with the four decisions they already made still recorded.
They did not lose the milestone they marked done, and they are not asked about the same projects again.

**Why this priority**: A twenty-minute ritual that has to be completed in one sitting is a ritual that gets
abandoned, and an abandoned review is a review that never happened. It ranks after the project walk because
there has to be enough review to be worth resuming, but it is what makes the ritual survivable in a real week.

**Independent Test**: Start a review, record decisions across two different steps, then simulate the
application closing entirely. Reopen and confirm the review resumes at the exact point it left off with every
prior decision intact, and confirm the partial state is readable in a plain-text editor while incomplete.

**Acceptance Scenarios**:

1. **Given** a review in progress with decisions recorded, **When** the application is closed and reopened,
   **Then** the review resumes at the step and position it was left at, not at the beginning.
2. **Given** a decision is made during a review, **When** it is made, **Then** it is persisted at that moment
   rather than at completion, so an abrupt close loses nothing already decided.
3. **Given** a review in progress, **When** the user reopens it, **Then** every prior decision is present and
   the user is not re-asked about anything already decided.
4. **Given** a review in progress, **When** the underlying data has changed since the review was paused — a
   project was completed, an item was added to the inbox — **Then** the review re-reads current state rather
   than showing what was true when it was paused.
5. **Given** a review in progress, **When** its state is opened in a plain-text editor, **Then** it is legible
   and identifiable as an incomplete review of a specific week.
6. **Given** a review in progress for a week, **When** the calendar moves into the next week before it is
   completed, **Then** the unfinished review remains as it is, is never auto-completed or deleted, and a review
   started in the new week is a separate review of that new week.
7. **Given** a review in progress, **When** the user starts a review again for the same week, **Then** the
   existing in-progress review is resumed rather than a second one being created.

---

### User Story 4 - Catch the Waiting-For Items That Have Gone Quiet (Priority: P4)

The user has fourteen things delegated. Eleven of them are recent and fine. Three have been sitting since
before the threshold, including one they had genuinely forgotten. The review shows those three, says how long
each has waited and who owns it, and lets the user record that they chased two of them and that the third has
actually come back. Nothing is sent to anyone; the user does the nudging themselves.

**Why this priority**: Delegated work that never returns is the second way commitments rot, and per the
roadmap this check is load-bearing for the WIP limit as well: a project moved to `waiting` to free a slot is
supposed to get caught here. It ranks below the project walk only because there are fewer of these items than
projects for most weeks.

**Independent Test**: With a waiting-for list containing items dated on both sides of the configured
threshold, run the waiting-for step and confirm exactly the over-threshold items are surfaced with their
owner and their age, that below-threshold items are counted but not flagged, that recording a follow-up and
recording a receipt each write through, and that changing the configured threshold alone changes which items
are surfaced.

**Acceptance Scenarios**:

1. **Given** waiting-for items on both sides of the threshold, **When** the step runs, **Then** exactly the
   items older than the threshold are surfaced as stale, and the total number of waiting-for items is also
   reported.
2. **Given** a stale item, **When** it is presented, **Then** the user sees its text, its owner, the date it
   started waiting, and how long it has been waiting.
3. **Given** a stale item, **When** the user records that they followed up, **Then** the follow-up is appended
   beneath the item with today's date, the item's original waiting-since date is unchanged, and the item
   remains outstanding.
3a. **Given** an item followed up two days ago against a seven-day threshold, **When** the step runs, **Then**
    it is not surfaced as stale, because it has been touched — while its total age since the original
    waiting-since date remains visible when it is shown.
3b. **Given** an item with two follow-ups already recorded, **When** the user records a third, **Then** it is
    appended and the earlier two are still there, unchanged.
4. **Given** a waiting-for item, **When** the user records that it has been received, **Then** it is appended
   as a received action with today's date, it stops being counted as outstanding, it is never surfaced as
   stale again, and its line and full history remain in the file.
5. **Given** a stale item, **When** the user leaves it alone, **Then** nothing changes, no message is sent, and
   no follow-up is invented.
6. **Given** the configured staleness threshold is changed in the data directory, **When** the step is run
   again, **Then** a different set of items is surfaced with no application change.
7. **Given** no waiting-for items at all, **When** the step runs, **Then** it reports an empty list and
   completes without error.
8. **Given** every waiting-for item is newer than the threshold, **When** the step runs, **Then** nothing is
   surfaced as stale, the step completes, and the user is not asked to act on anything.
9. **Given** a waiting-for line that was hand-written and does not parse, **When** the step runs, **Then** the
   line is shown as it reads on disk, is never silently dropped, and is never rewritten by the system.
10. **Given** a stale item, **When** the review runs, **Then** the system never sends an email, message,
    reminder, or notification to the item's owner or to anyone else.

---

### User Story 5 - Commit to the Week Ahead Against What Actually Happened (Priority: P5)

It is Friday. Before the user writes down what matters next, the review shows them what they said mattered
this week and how much of it they actually finished — two of three done, one untouched. One of the two they
finished an hour ago and never marked, so they mark it right there. Seeing the third still open, they write
three outcomes for next week rather than five, because the record is right in front of them.

**Why this priority**: The confrontation is the point: committing to the next week without seeing how the last
one went is how overcommitment compounds. It ranks last of the steps because Feature 4 already ships setting
and viewing a top three — this step adds the juxtaposition, the prompt, and the week ahead, not the capability.

**Independent Test**: With the reviewed week's top three containing a mix of done and not-done outcomes, run
the top-three step and confirm the reviewed week is shown with its done state, that an outcome can be marked
done from within the step, that outcomes set for the following week are written through the existing
top-three verbs including the configured cap, that a week two ahead is refused, and that every week before the
reviewed one is untouched and offers no edit.

**Acceptance Scenarios**:

1. **Given** the reviewed week has three outcomes of which two are done, **When** the top-three step runs,
   **Then** that week is shown with each outcome's done state, so the user sees what they actually finished.
2. **Given** the reviewed week is shown, **When** the user marks a still-open outcome done, **Then** it is
   recorded done with its completion date, exactly as it would be outside the review.
2a. **Given** the step is showing weeks before the reviewed one, **When** the user looks at them, **Then**
    they are presented as a record with no edit, completion, or removal affordance.
3. **Given** the user sets outcomes for the week ahead, **When** they are recorded, **Then** they land in the
   week following the review's week and are written through the existing top-three behavior, including the
   configured maximum and the refusal of empty text.
3a. **Given** the user is at the configured outcome cap for the week ahead, **When** they try to add one more,
    **Then** they are refused with the same message they would get anywhere else.
3b. **Given** any surface outside the review, **When** the user sets an outcome for the week ahead, **Then** it
    succeeds — the widened window is not a review-only power.
3c. **Given** a write aimed at a week two or more ahead, **When** it is attempted from anywhere, **Then** it is
    refused and the refusal states which weeks are writable.
3d. **Given** a review run in the last ISO week of a year, **When** the user sets the week ahead, **Then** it
    lands in week 01 of the next ISO week-numbering year, computed by the same rule as every other week.
4. **Given** the reviewed week has no top three at all, **When** the step runs, **Then** it says so plainly
   and the user can still set the week ahead.
5. **Given** the user sets outcomes for the week ahead, **When** the review is completed, **Then** every
   earlier week's outcomes, done marks, and completion dates are unaltered.
6. **Given** the top-three step, **When** it runs, **Then** the system never suggests, pre-fills, ranks, or
   carries forward an unfinished outcome into the new week on the user's behalf.
7. **Given** the user chooses to set no outcomes at all, **When** they pass the step, **Then** the review can
   still be completed, and the log records that no top three was set.

---

### User Story 6 - The Rules Are Mine to Change (Priority: P6)

The user finds that being blocked at the inbox is the right amount of pressure for them, so they change the
inbox rule from a warning to a block in their data directory. Their colleague, opening the same data with a
different client, gets the same block. Separately, seven days turns out to be too twitchy for their team's
cadence, so they raise the staleness threshold to ten and fewer items are surfaced.

**Why this priority**: No new user-facing capability, which is why it ranks last, but it is what makes the
ritual honest under Principle V: the two opinions this feature holds about how the user should work are
configurable, live with the data, and are not baked into the ritual's logic.

**Independent Test**: With the inbox rule at its default, confirm a non-empty inbox produces a warning that
can be passed. Change the configured rule to block and confirm the same state now prevents advancing. Change
the staleness threshold and confirm the set of surfaced items changes. Make both changes by editing the data
directory only, with no application change.

**Acceptance Scenarios**:

1. **Given** default configuration and a non-empty inbox, **When** the user reaches the end of the inbox step,
   **Then** they are told how many items are waiting and may proceed anyway.
2. **Given** the inbox rule configured to block and a non-empty inbox, **When** the user tries to advance,
   **Then** they cannot, the count is stated, and they are told sorting the inbox is what unblocks it.
3. **Given** the inbox rule configured to block and an empty inbox, **When** the user advances, **Then** it
   proceeds with no message.
4. **Given** no policy configuration file exists, **When** a review runs, **Then** the documented defaults
   apply — a warning at the inbox, a seven-day staleness threshold — nothing errors, and no file is created
   behind the user's back.
5. **Given** a malformed or out-of-range value for either rule, **When** it is read, **Then** the documented
   default is used, the problem is surfaced, and no step of the review is blocked by the configuration error
   itself.
6. **Given** two different clients opening the same data directory, **When** each evaluates the same review
   state, **Then** both receive the same decision.
7. **Given** the inbox rule, **When** the ritual's logic is inspected, **Then** neither the inbox rule nor the
   staleness threshold is expressed anywhere except the policy module and its configuration.

---

### Edge Cases

- The user starts a review on Sunday evening and finishes it on Monday morning, after the ISO week has turned
  over. The review belongs to the week it was started in and stays there; it does not migrate to the new week
  or split across two log files. The week it commits to is still the week after its own — which by Monday
  morning is simply the current week, and remains writable.
- The review is run in the last ISO week of a year. The week ahead is week 01 of the next ISO week-numbering
  year, and the log for the review's own week may carry the previous year's label — both follow the same rule
  Feature 4 already established, where a January date can belong to the previous ISO year.
- The user runs the review on Monday rather than Friday. It reviews the week they are in, which has barely
  started, and commits to the following one. Nothing breaks; the ritual simply reads a thinner week. Which day
  the ritual runs is the user's habit, and the system never enforces or infers one.
- The user sets the week ahead during the review, then edits that same week from the ordinary top-three view
  before it arrives. It is writable there too, because the widened window is a property of the top three
  rather than of the review.
- The user never completes a review for a week, and weeks later runs one for the current week. The abandoned
  review remains on disk as an incomplete record of that earlier week; nothing backfills it and nothing
  deletes it.
- The inbox is empty at the start of the review and something is captured into it while the review is open.
  The count is derived on read, so the state shown reflects the file at the time the step is evaluated rather
  than a snapshot from when the review opened.
- A project is completed in another window while the review has it queued. The walk reads current state, so
  the project either presents as it now is or is no longer part of the active set — the review never writes a
  status change based on what was true when it started.
- All nine of the user's projects are parked. The project step presents nothing to walk and completes with
  an explicit "nothing to walk", which is a legitimate state and not an error.
- A project has been in `waiting` for five weeks against a seven-day threshold. It is surfaced as stale and
  the user is asked whether it is really still blocked; if they say nothing and move on, the project is
  untouched and the log records that it was asked about and left.
- A project is moved to `waiting` during the walk to get under the WIP limit. It is not stale yet, so it is
  not flagged this week — the check catches it in a later review, which is the point of the threshold.
- A project is hand-edited from `active` to `waiting` in a text editor. No ledger entry exists for that
  transition, so its waiting duration is unknown and it is never flagged stale. It is still walked, and the
  unknown is shown rather than papered over with a guessed date.
- A project's `status:` says `parked` while its last ledger entry says it entered `active`, because the file
  was hand-edited. Both are shown as they read; the status field is what the project is, the ledger is what
  was recorded, and neither is rewritten to agree with the other.
- A project bounces between `active` and `waiting` four times in a month. The ledger holds all four
  transitions with the duration of each, and staleness reads only the most recent entry into the current
  status — an old waiting spell does not make a fresh one look stale.
- The ledger of a long-lived project grows to hundreds of entries. It is never compacted, rotated, or
  summarized; growing is what an append-only record does, and pruning is deliberately nobody's job.
- A project has no DRI and no outcome. Both signals appear on it during the walk, independently: needing a
  DRI is not a structure gap, and a project missing only a DRI is not flagged as needing structure.
- The user marks a milestone done during the review and then, in the same review, reopens it. Both facts are
  what the project file now says; the log records the decisions the user made, not a reconstruction.
- A waiting-for item's date is in the future because it was hand-typed wrong. It is not stale, it is shown as
  it reads, and no date is corrected.
- An item was chased every week for three months and still has not come back. It is never stale, because it
  keeps being touched — and its original waiting-since date is right there showing it has been outstanding for
  ninety days, which is the number that should prompt a different conversation than "nudge again".
- An item is marked received and then something further arrives on the same subject. The received item stays
  received; a new waiting-for item is a new item, not a reopening of an old one.
- A follow-up line is typed by hand under an item in a text editor. It counts exactly as one the application
  wrote, and resets the untouched clock the same way.
- The waiting-for file does not exist at all. The step reports an empty list rather than failing to read.
- The staleness threshold is configured to zero. Every waiting-for item is stale, which is a coherent
  configuration and is not corrected.
- The review's log file for the current week has been hand-edited. The system shows it as it reads and does
  not repair, reorder, or regenerate it.
- The log directory does not exist when the first review completes. It is created as part of writing the
  review, and no other file is created speculatively.
- The user completes a review and then hand-edits a project. The review is a record of what was decided at
  review time and does not update to match later edits.
- The user runs a review with the network disabled, which is the ordinary case, and every step works — up to
  and including completing it and writing the log, because no provider is supplied by default and the summary
  port is not on any required path.
- A summary provider is supplied and returns nothing, empty text, or something unusable. Nothing is recorded,
  the review completes on the user's note alone, and the empty result is not written as a summary.
- A summary is accepted and later contradicted by the user's own note, because they wrote the note first. Both
  stay in the log as they were written; the record shows what each said, and neither is reconciled.
- A generated summary is accepted for a week, and the user later hand-edits it in the log. It is their file;
  the attribution line stays where they leave it, and nothing regenerates or re-attributes it.

## Requirements *(mandatory)*

### Functional Requirements

#### The ritual and its sequence

- **FR-001**: The system MUST provide a guided review that presents four steps in a fixed order: the inbox,
  the active projects, the waiting-for list, and the coming week's top three.
- **FR-002**: A step MUST NOT be reachable before every step before it has been passed.
- **FR-003**: Users MUST be able to return to an already-passed step and see the decisions recorded against
  it, without any decision being discarded.
- **FR-004**: A review MUST belong to exactly one week, identified by the ISO-8601 week identifier Feature 4
  defines, computed by the same rule so that a week's review, that week's top three, and that week's log all
  refer to the same seven days.
- **FR-005**: At most one review MUST exist per week. Starting a review when one already exists for that week
  MUST resume it rather than create a second.
- **FR-006**: A review MUST be started explicitly by the user. The system MUST NOT start, schedule, auto-open,
  or prompt for a review.
- **FR-007**: Every step MUST complete on empty data, reporting the empty state explicitly rather than
  erroring or being silently skipped.
- **FR-008**: Users MUST be able to abandon a review at any point without completing it, and abandoning MUST
  NOT complete any step, write a completed log, or alter any project, item, or outcome.
- **FR-009**: The review MUST read current state each time a step is evaluated, and MUST NOT act on data
  cached from when the review was opened.
- **FR-010**: A review MUST be completable only after every step has been passed.
- **FR-011**: Once completed, a review MUST be presented in the application as a read-only record, with no
  affordance to re-run, reopen, or overwrite it.
- **FR-012**: The review MUST use the vocabulary already in the core — project, area, waiting-for, top three,
  capture, sort, review — and MUST NOT introduce a concept, verb, or status that does not exist in the core.

#### Step 1 — the inbox

- **FR-013**: The inbox step MUST report how many unsorted items are currently in the inbox.
- **FR-014**: The count MUST be derived from the inbox file on read and MUST NOT be stored or cached.
- **FR-015**: Hand-written inbox lines MUST count exactly as captured ones do; inbox zero means the file is
  genuinely clear.
- **FR-016**: The step MUST offer the user a way to go and sort the inbox, and returning MUST bring the user
  back to the inbox step with a freshly derived count.
- **FR-017**: Whether a non-empty inbox prevents advancing MUST be a policy decision taken at a named decision
  point, consulted when the user attempts to advance past the inbox step.
- **FR-018**: The default MUST be a warning: the user is told the count and MAY proceed. The rule MUST be
  configurable to block instead.
- **FR-019**: When the rule blocks, the refusal MUST state the count and name sorting the inbox as what
  unblocks it. When it warns, the message MUST state the count and MUST NOT prevent advancing.
- **FR-020**: With an empty inbox, the step MUST advance with no warning and no refusal, whichever way the
  rule is configured.

#### Step 2 — the projects

- **FR-021**: The project step MUST present the projects in the walk set one at a time, each exactly once, in a
  stable order that does not change between reads of unchanged data.
- **FR-022**: The walk set MUST be the projects whose status is `active` and the projects whose status is
  `waiting`. Projects that are parked or done MUST NOT be walked.
- **FR-022a**: A walked project that has been in `waiting` longer than the configured staleness threshold MUST
  be surfaced as stale, showing how long it has been waiting, and the user MUST be asked whether it is
  genuinely still blocked.
- **FR-022b**: That question MUST be a prompt only. The system MUST NOT change a stale waiting project's
  status, park it, or reactivate it, whatever the user answers or declines to answer.
- **FR-022c**: A waiting project's staleness MUST be decided by the same policy rule, at the same decision
  point, and against the same configured threshold as a waiting-for item's. A project waiting too long and a
  delegated item waiting too long are the same rule applied to two subjects, and MUST NOT be separately
  configurable.
- **FR-022d**: The duration a project has been waiting MUST be derived from the project's ledger (FR-087
  onward) — specifically the most recent entry that took it into `waiting`. A project whose ledger has no such
  entry MUST be walked with an unknown duration and MUST NOT be flagged stale (FR-093).
- **FR-023**: For each project presented, the system MUST show its title, status, outcome, next action, DRI,
  how that DRI resolves, and its milestones with their done state.
- **FR-024**: For each project presented, the system MUST show its structure gaps, if any.
- **FR-025**: For each project presented, the system MUST show the needs-a-DRI signal when no DRI is named.
  This signal MUST remain distinct from a structure gap and MUST block nothing.
- **FR-026**: Users MUST be able to change a project's status from within the walk, including parking it.
- **FR-027**: Users MUST be able to change a project's next action from within the walk.
- **FR-028**: Users MUST be able to mark a milestone done from within the walk, recorded identically to
  marking one done anywhere else, completion date included.
- **FR-029**: Users MUST be able to supply the fields a flagged project is missing from within the walk, so a
  structure gap or a missing DRI can be fixed without leaving the review.
- **FR-030**: Every change made in the walk MUST be written through the same core verbs any other surface
  uses, so that no behavior exists only inside the review.
- **FR-031**: Every decision point already declared MUST be consulted identically inside the review. The WIP
  limit MUST refuse a status change to active with the same message, count, and named remediation projects,
  and the open-milestone confirmation MUST fire on the same conditions.
- **FR-032**: The review MUST NOT be a path around any rule enforced elsewhere.
- **FR-033**: Users MUST be able to pass over a project having made no change.
- **FR-034**: A project passed over with no change MUST be recorded as reviewed, distinguishably from a
  project that was never reached.
- **FR-035**: Writes made from the walk MUST inherit the existing verify-before-write behavior: a field
  changed on disk since it was shown MUST cause the write to be refused and the project re-presented as it
  now reads.

#### Step 3 — the waiting-for list

- **FR-036**: The waiting-for step MUST surface the waiting-for items that have been waiting longer than the
  configured staleness threshold.
- **FR-037**: Staleness MUST be computed against the current local calendar date from the most recent action
  recorded on the item — the date it started waiting when nothing has happened since, otherwise the date of
  the latest follow-up. Staleness measures how long something has gone untouched, and chasing it is touching
  it.
- **FR-038**: The threshold MUST be a policy rule with a documented default of seven days, decided by the
  policy module rather than computed in the ritual's own logic.
- **FR-039**: The step MUST also report the total number of outstanding waiting-for items, so the user knows
  what was not surfaced.
- **FR-040**: For each stale item the system MUST show its text, its owner, the date it started waiting, any
  follow-ups already recorded on it, and how long it has gone untouched.
- **FR-041**: Users MUST be able to record that they followed up on an item, and the item MUST remain
  outstanding afterwards.
- **FR-042**: Users MUST be able to record that an item has been received, after which it MUST NOT be counted
  as outstanding or surfaced as stale.
- **FR-043**: Both MUST be recorded as an action appended beneath the item — an indented continuation line
  carrying the action and the local calendar date it was taken — reusing the continuation grammar the inbox
  and the running lists already use. No new syntax MUST be introduced for this.
- **FR-043a**: The date the item started waiting MUST be preserved unchanged when an action is recorded, so
  that total age remains visible alongside the untouched-since clock.
- **FR-043b**: Actions MUST accumulate. Recording a second follow-up MUST NOT replace the first, and no
  existing line, action, or item MUST be rewritten, reordered, or removed by the system.
- **FR-043c**: A received item MUST remain in the file with its history intact. The system MUST NOT delete it,
  move it, or archive it elsewhere.
- **FR-043d**: An action line written by hand MUST be read exactly as one written by the application. The file
  is the record, whoever wrote it.
- **FR-044**: A waiting-for line that does not parse MUST be shown as it reads on disk, MUST NOT be dropped,
  and MUST NOT be rewritten by the system.
- **FR-045**: Users MUST be able to leave a stale item untouched, and doing so MUST change nothing.
- **FR-046**: The system MUST NOT send an email, message, reminder, or notification to an item's owner or to
  anyone else, at any point.

#### Step 4 — the top three

- **FR-047**: The top-three step MUST show the top three of the week being reviewed — the review's own week —
  each outcome with its done state, before prompting for the week ahead.
- **FR-048**: Users MUST be able to mark an outcome of the reviewed week done or not done from within the
  step. The reviewed week is the current week, which Feature 4 already permits editing, and a Friday review is
  exactly when a straggler gets finished.
- **FR-048a**: Weeks earlier than the reviewed week MUST remain read-only, with no edit, completion, or
  removal affordance, unchanged from Feature 4.
- **FR-049**: The step MUST prompt the user to set the top three for the week after the review's week.
- **FR-049a**: The writable window of the top three MUST therefore widen from the current week to the current
  week and the week immediately following it. This widening MUST apply to every surface, not only to the
  review, so that no behavior exists only inside the ritual.
- **FR-049b**: Weeks beyond the next one MUST NOT be writable, and past weeks MUST remain read-only. The
  refusal for writing outside the window MUST state which weeks are writable.
- **FR-049c**: The week after the review's week MUST be computed by the same ISO rule as every other week, so
  that a review run in the last week of a year sets the first week of the next ISO week-numbering year.
- **FR-050**: Outcomes set in this step MUST be recorded through the existing top-three behavior, including
  the configured maximum, the refusal of empty text, and the per-entry verify-before-write.
- **FR-051**: A refusal in this step MUST carry the same message the user would see setting a top three
  anywhere else.
- **FR-052**: The step MUST be passable with no outcomes set, and the review MUST still be completable.
- **FR-053**: The system MUST NOT suggest, pre-fill, rank, or carry an unfinished outcome forward on the
  user's behalf.

#### Pausing and resuming

- **FR-054**: Each decision the user makes during a review MUST be persisted at the moment it is made, not at
  completion.
- **FR-055**: Reopening a review MUST resume at the step and position the user left, not at the beginning.
- **FR-056**: On resume, every prior decision MUST be present, and the user MUST NOT be asked again about
  anything already decided.
- **FR-057**: An in-progress review MUST be stored as human-readable, hand-editable plain text in the
  git-tracked data directory, legible and identifiable as an incomplete review of a specific week.
- **FR-058**: An in-progress review MUST survive the application closing abruptly, losing no decision already
  made.
- **FR-059**: When the calendar moves into a new week while a review is in progress, the in-progress review
  MUST remain attached to its own week, MUST NOT be auto-completed, and MUST NOT be deleted.
- **FR-060**: A review left incomplete MUST remain readable as an incomplete record, and MUST NOT be backfilled
  or completed later on the user's behalf.
- **FR-061**: Resuming MUST re-read the underlying data rather than replaying what was on screen when the
  review was paused.

#### The weekly log

- **FR-062**: Completing a review MUST write a plain-text log for that week, in the git-tracked data
  directory, in a location derived from the same ISO week identifier the review and the top three use.
- **FR-063**: The log MUST record which projects were reviewed, including those passed over with no change.
- **FR-064**: The log MUST record what changed: status changes, next-action changes, milestones marked done,
  and fields supplied for flagged projects.
- **FR-065**: The log MUST record what the user said was done — milestones completed, projects completed, and
  the reviewed week's outcomes that were done.
- **FR-066**: The log MUST record what slipped — the reviewed week's outcomes that were not done, the stale
  waiting-for items surfaced and what the user did about each, and the stale waiting projects surfaced and
  what the user did about each.
- **FR-067**: The log MUST record the inbox count at the time the inbox step was passed, and whether it was
  zero.
- **FR-068**: The log MUST be readable and editable in a plain-text editor with no application running, and
  MUST be legible without the application to interpret it.
- **FR-069**: Completed reviews MUST be retained permanently. The system MUST NOT prune, rotate, compact, or
  summarize away a past review.
- **FR-070**: Writing a week's log MUST NOT alter, overwrite, or reorder any other week's log.
- **FR-071**: Users MUST be able to list and read past reviews, each identified by its week, most recent
  first.
- **FR-072**: A log that has been hand-edited MUST be shown as it reads and MUST NOT be repaired, reordered,
  or regenerated.

#### What the review never does

- **FR-073**: The review MUST NOT change a project's status, next action, DRI, milestones, or existence except
  as the direct result of an explicit user decision in that review.
- **FR-074**: The review MUST NOT auto-park, auto-complete, or auto-flag a project on the basis of inactivity,
  staleness, or any other derived judgment.
- **FR-075**: The review MUST NOT nudge, remind, or contact anyone.
- **FR-076**: The review MUST NOT generate, suggest, pre-fill, or rank any text the user is asked for —
  including the summary of the week. Where free text is recorded, it originates from an explicit user entry,
  or from a supplied summary provider under the conditions in FR-100 onward, which the user must accept and
  which is attributed as generated.
- **FR-077**: The review MUST NOT modify the inbox, sort an item, or route anything on the user's behalf.

#### Policy placement and configuration

- **FR-078**: The inbox rule MUST live in the policy module and MUST be consulted at a named decision point
  declared by the core. The ritual's own logic MUST NOT contain the rule.
- **FR-079**: The staleness threshold MUST live in the policy module and its configuration, and MUST NOT be a
  constant in the ritual's logic.
- **FR-080**: This feature MUST add exactly two decision points to the three already declared — one consulted
  when the review attempts to advance past the inbox step, and one consulted per staleness subject, meaning
  both per outstanding waiting-for item and per walked project whose status is `waiting` (FR-022c) — and no
  others. A decision point with no rule registered against it MUST NOT be declared speculatively.
- **FR-081**: Each decision MUST return exactly one of allow, warn, or block, with a reason a client can
  display, and enforcement MUST occur at the core's decision points so that no client can bypass a rule
  another client enforces.
- **FR-082**: Both rules' configuration MUST live in the existing policy configuration in the git-tracked data
  directory, changeable by editing that file alone with no application change, taking effect for every client
  opening that directory.
- **FR-083**: When policy configuration is absent, the documented defaults MUST apply — warn at the inbox,
  seven days for staleness — with no error and no file created without the user asking.
- **FR-084**: When either value is malformed or out of range, the documented default MUST apply, the problem
  MUST be surfaced, and no step of the review MUST be blocked by the configuration error itself.

#### Platform constraints

- **FR-085**: Every capability in this feature MUST function with no network connection.
- **FR-086**: The ritual MUST be implemented in the core as a module with its own interface, with any client
  a thin consumer that renders, routes input, and calls the core, holding no logic of its own.

#### The project ledger

- **FR-087**: A project MUST carry an append-only ledger of the actions taken on it, stored in the project's
  own file as human-readable, hand-editable plain text.
- **FR-088**: Each ledger entry MUST record the action that occurred and the local calendar date it occurred
  on, and — where the action ended a state the project was in — how long that state had lasted.
- **FR-089**: A status change MUST append a ledger entry naming the status the project left and the status it
  entered.
- **FR-090**: This feature MUST record status changes in the ledger. Recording other actions is not required
  here, and an entry MUST NOT duplicate state the project file already carries — a milestone's completion date
  stays on the milestone.
- **FR-091**: The ledger MUST be append-only. The system MUST NOT rewrite, reorder, compact, or remove an
  existing entry, including entries the user wrote or altered by hand.
- **FR-092**: Ledger entries MUST be written by the core verb performing the action, so that the same action
  taken from the review, from a project view, or from any future client is recorded identically. The review
  MUST NOT write ledger entries of its own.
- **FR-093**: How long a project has been in its current status MUST be derived from the most recent ledger
  entry that entered that status, read at the time the question is asked, and MUST NOT be stored as a separate
  field.
- **FR-094**: A project whose ledger holds no entry for its current status — a file hand-edited into that
  status, or one predating the ledger — MUST be shown with an unknown duration and MUST NOT be flagged stale.
  No date may be substituted, inferred, or backfilled.
- **FR-095**: The ledger MUST NOT be the source of truth for the project's current state. The `status:` field
  remains what the project is; the ledger is the record of how it got there. Where the two disagree, both MUST
  be shown as they read and neither MUST be repaired.
- **FR-096**: The ledger MUST be readable and interpretable in a plain-text editor with no application
  running, and any consumer — the staleness rule in policy, a later retrospective, a future client — MUST be
  able to read it without the application.
- **FR-097**: The review MUST NOT record a ledger entry for a project it merely displayed. An entry records an
  action taken, not attention paid; "reviewed, no change" belongs in the week's log.
- **FR-098**: Only projects MUST gain a ledger in this feature. The entry shape MUST be designed so that areas,
  waiting-for items, or any other record can carry one later without changing what a project's ledger means.
- **FR-099**: Adding the ledger MUST NOT rewrite any project file already on disk. A project gains its ledger
  the first time an action is recorded against it, in the way Feature 3 established: extend, never migrate.

#### The review summary and the summary port

- **FR-100**: On completing a review, the system MUST offer the user an optional free-text note, recorded
  verbatim in that week's log as the user's own words.
- **FR-101**: The note MUST be skippable. A review with no note MUST complete normally, and the log MUST show
  that none was written rather than fabricating one.
- **FR-102**: Core MUST declare a summary port: a named interface, with exactly one call site, at the review's
  completion, at which a supplied provider MAY draft a summary of the week.
- **FR-103**: No provider MUST ship with this feature. With none supplied, the review MUST complete normally
  and MUST NOT present a broken, disabled, or failing summary affordance.
- **FR-104**: A supplied provider MUST be additive and MUST NOT be required. Every capability in this feature
  MUST work with no provider supplied and no network available.
- **FR-105**: A drafted summary MUST be shown to the user for explicit acceptance. It MUST NOT be written to
  the log without that acceptance, and declining MUST leave the log exactly as it would have been.
- **FR-106**: An accepted summary MUST be recorded distinctly from the user's own note, attributed as
  generated and naming the provider that produced it, so a later reader can always tell whose words they are.
- **FR-107**: A generated summary MUST NOT replace, overwrite, edit, or be merged into the user's note. It
  supplements the record; it does not stand in for it.
- **FR-108**: The only input a provider MUST receive is the review's own record for that week. Project files,
  the inbox, the identity configuration, and any other data MUST NOT be sent.
- **FR-109**: What would be sent MUST be inspectable by the user before it is sent.
- **FR-110**: Sending anything to an external service MUST require explicit user configuration and MUST
  default to off. Nothing MUST leave the machine by default, at any point in this feature.
- **FR-111**: A provider that fails, times out, is unreachable, or is misconfigured MUST NOT block completing
  the review. The failure MUST be surfaced plainly, and the review MUST complete with the user's note alone.
- **FR-112**: The port MUST be internal in the same sense the policy seam is: the interface and its one call
  site only. A loader, a discovery mechanism, or a public extension API MUST NOT be built here.
- **FR-113**: The summary port MUST NOT be a policy decision point. It produces text for the user to accept or
  decline, never an allow, warn, or block, and the count of decision points MUST remain as FR-080 states.

### Key Entities

- **Review**: One guided pass over the user's commitments, belonging to exactly one ISO week. Carries its
  current position, every decision recorded so far, and whether it is in progress or complete. At most one per
  week; never created, completed, or deleted by the system.
- **Review step**: One of the four ordered stages — inbox, projects, waiting-for, top three. Each has a
  passed/not-passed state and the decisions recorded against it.
- **Project review record**: What happened to one project in one review — that it was seen, and what the user
  changed, including "nothing". Distinguishes reviewed-no-change from never-reached.
- **Waiting-for item history**: The actions recorded beneath a waiting-for item — follow-ups and its receipt —
  each with the date it was taken, accumulating beneath the item in the file. The same idea as the project
  ledger, expressed in the grammar `waiting.md` already has. Distinguishes an item nobody has touched in a
  month from one chased last Tuesday, and marks an item as no longer outstanding without deleting it.
- **Waiting-for review record**: What the user did about one surfaced item — followed up, received, or left
  alone — together with how long it had gone untouched when it was surfaced.
- **Project ledger**: The append-only history a project carries in its own file — one entry per action taken
  on it, recording what happened, when, and how long the state it ended had lasted. Written by the core verb
  that performs the action, never by a client or by the review. The source of "how long has this been
  waiting?", and the raw material for judgments this feature does not make: core records what happened, and
  policy or a later feature decides whether it is worth flagging.
- **Ledger entry**: One recorded action — at minimum the action and its date, plus the duration of the state
  it ended where there was one. Shaped to generalize to records other than projects without changing meaning.
- **Weekly log**: The permanent plain-text record of a completed review for a week: what was reviewed, what
  changed, what was done, what slipped. Never pruned, never rewritten by a later review, readable without the
  application. The raw material Feature 6's retrospective reads.
- **Review note**: The user's own free text about the week, written at completion, optional, recorded verbatim
  and never pre-filled. The summary text the ritual explicitly does not write for them.
- **Summary provider**: An optional, supplied implementation of the summary port that drafts a summary of the
  week from the review's own record. None ships here. Whatever it produces is a draft the user accepts or
  declines, recorded attributed as generated and never in place of the user's note. The same kind of seam the
  transcription port already is: core owns the interface and the call site, a client supplies the engine.
- **Inbox gate decision**: The policy answer to whether a non-empty inbox stops the review advancing. Warn by
  default, configurable to block, stated with the count.
- **Staleness threshold**: The policy rule defining how long a waiting-for item may sit untouched before it is
  surfaced. Documented default of seven days, stored with the data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete a full review — four steps, a nine-project walk, a waiting-for list, and a
  top three — in under 20 minutes.
- **SC-002**: 100% of completed reviews produce a log file for the correct ISO week, verified across a fixture
  spanning a year boundary including a 53-week year.
- **SC-003**: Across four consecutive weekly reviews, all four log files remain readable with their original
  content intact — zero prior-week logs altered, truncated, or removed.
- **SC-004**: 100% of completed reviews are readable and comprehensible in a plain-text editor with no
  application running.
- **SC-005**: A review interrupted at any step and any position resumes at exactly that point in 100% of
  tested interruption points, with zero decisions lost.
- **SC-006**: 100% of decisions made during a review are durably persisted before the next decision is made,
  verified by killing the application immediately after each one.
- **SC-007**: In a walk over 50 active projects, each project is presented exactly once and the order is
  identical across repeated reads of unchanged data, in 100% of runs.
- **SC-008**: Every project reviewed is recorded in the log, including those passed over unchanged — 100%
  agreement between projects presented and projects recorded.
- **SC-009**: Every rule enforced outside the review produces an identical decision inside it, verified for
  the WIP limit, the milestone cap, and the open-milestone confirmation, with 100% agreement on message,
  verdict, and named subjects.
- **SC-010**: With the default configuration and a non-empty inbox, 100% of attempts to advance produce a
  warning naming the count and 0% are prevented; with the rule configured to block, 100% are prevented.
- **SC-011**: Changing the inbox rule or the staleness threshold in the data directory alone changes the
  enforced behavior on the next read, with no application change, verified at two values each.
- **SC-012**: Across a fixture of waiting-for items dated from 0 to 30 days old, the set surfaced as stale
  matches the configured threshold exactly, in 100% of cases, at the default and at one other value.
- **SC-012a**: Across a fixture of `waiting` projects that entered that status from 0 to 60 days ago, the set
  flagged as stale matches the configured threshold exactly, in 100% of cases, and the same threshold value
  governs both projects and waiting-for items — changing it once changes both.
- **SC-012b**: Zero `waiting` projects have their status changed by the review itself across the full test
  suite; every status change is traceable to an explicit user decision.
- **SC-012c**: 100% of status changes — made from the review, from a project view, or from any other surface —
  append exactly one ledger entry naming the status left and the status entered, with zero entries written for
  a project that was only displayed.
- **SC-012d**: Across a sequence of 20 status changes on one project, every entry survives unaltered — zero
  entries rewritten, reordered, or removed — and the ledger is legible in a plain-text editor with no
  application running.
- **SC-012e**: A project hand-edited into `waiting` with no ledger entry reports an unknown duration and is
  never flagged stale, in 100% of tested cases, and zero dates are substituted or backfilled.
- **SC-012f**: Every project file on disk before this feature is byte-for-byte unchanged until an action is
  recorded against it — zero migrations.
- **SC-012g**: Outcomes set in the top-three step land in the week following the review's week in 100% of
  cases, verified across a fixture spanning an ISO year boundary including a 53-week year.
- **SC-012h**: Writes to the current week and to the next week succeed from every surface, and writes to any
  earlier week or to a week two or more ahead are refused, in 100% of attempts, with the refusal naming the
  writable weeks.
- **SC-012i**: For every item carrying follow-ups, staleness is measured from the most recent action and the
  original waiting-since date is still readable in the file — 100% of recorded follow-ups leave that date
  untouched, and zero prior actions are lost when a new one is recorded.
- **SC-012j**: 100% of received items are excluded from both the outstanding count and the stale set, and
  zero received items are deleted, moved, or archived out of the file.
- **SC-013**: Zero messages, emails, reminders, or notifications are emitted to any party across the full test
  suite.
- **SC-014**: Zero projects, milestones, waiting-for items, inbox items, or outcomes are modified during a
  review except as the direct result of an explicit user decision, verified by comparing the data directory
  before and after a review in which the user changes nothing — byte-for-byte identical apart from the
  review's own record.
- **SC-015**: 100% of free text stored by this feature is traceable to an explicit user entry; with no
  provider supplied — the shipped configuration — zero generated, suggested, or inferred text appears at any
  point in testing.
- **SC-015a**: With a stub provider supplied, 100% of drafted summaries require an explicit acceptance before
  being recorded, 100% of recorded ones are attributed as generated and separate from the user's note, and
  0% overwrite or alter the user's note.
- **SC-015b**: A provider that fails, hangs, or is unreachable leaves 100% of reviews completable, with the
  failure surfaced and the user's note intact.
- **SC-015c**: Zero bytes leave the machine in the shipped configuration, and with a provider configured, what
  is sent contains only the review's own record — verified against a fixture where a project file, the inbox,
  and the identity configuration each contain a distinctive marker string that must not appear in the payload.
- **SC-016**: The project step presents its first project within 1 second in a vault of 100 projects, and
  reads each project file at most once to build the walk — verified by counting reads, not by timing.
- **SC-017**: Every capability in this feature works with the network disabled, verified across the full test
  suite.
- **SC-018**: A missing policy configuration file, a malformed value, a missing waiting-for file, and a
  missing log directory each leave every step of the review completable, in 100% of tested paths.

## Out of Scope

Explicitly excluded, and named here so a later feature can claim them rather than this one growing into them:

- **The retrospective view across date ranges** (Feature 6). This feature writes the weekly logs and can list
  and read them; it does not aggregate completions across projects over an arbitrary range.
- **The local HTTP/JSON API** (Feature 7).
- **Calendar integration.** `calendar.md` remains a staging list; this review neither reads it as a step nor
  syncs anything with a real calendar.
- **Sending reminders or messages to anyone.** The review surfaces what has gone quiet; the nudging is the
  user's to do, by whatever means they already use.
- **Any AI-assisted suggestion** (Feature 8) — no suggested next actions, no suggested outcomes, no ranking of
  what to review first, and **no summary provider**. The summary *port* is in scope and one call site is
  built; the thing that would call an API is not, and none ships. Feature 8 is where a provider arrives, as a
  client of this port.
- **A loader or discovery mechanism for summary providers.** As with the policy seam: the interface and one
  call site, supplied by injection, internal until deliberately published.
- **Scheduling, notifying, or nagging the user to run the review.** "The same time each week" is the user's
  habit, not a system behavior. Daily surfacing is Feature 9's.
- **A plugin loader, policy module discovery, or a public extension API.** Two decision points are added to
  the existing seam; the interface stays internal.
- **Areas.** The walk is over projects. Areas have no end state, no DRI, and no milestones, and are not part
  of this ritual.
- **Any migration of existing files.** Projects, `waiting.md`, `top-three.md`, `identity.md`, and `policy.md`
  keep their current shapes, with additions made in the way Feature 3 established: extend, never rewrite. A
  project gains a ledger the first time an action is recorded against it, not by being rewritten.
- **Ledger entries for actions other than status changes.** Marking a milestone done, replacing a next action,
  and naming a DRI are recordable in the same shape, and deliberately are not recorded here — the entry format
  is the deliverable, not a complete audit trail.
- **Ledgers on anything but projects.** Areas, waiting-for items, and inbox items do not gain one in this
  feature.
- **Any judgment made from the ledger beyond the staleness rule.** Core records what happened; deciding what
  is worth flagging is policy's, and only the one threshold rule is registered here.
- **Draining `## Unprocessed`.** Feature 3 owns that; the walk may show a project's structure gaps without
  becoming a second sort surface.

## Assumptions

- **The review belongs to the ISO week it was started in**, computed by Feature 4's existing rule, and stays
  there even if it is finished after the week has turned over. A review that straddles a boundary belongs to
  one week or the other, and the week it was opened in is the one whose work it is reviewing.
- **The review reviews the week it is in and commits to the week after it.** This is what makes the three
  parts agree: the log is for week W and records what happened in W, the outcomes shown are W's so the user
  sees what they actually finished, and what they commit to is the week about to start. It assumes an
  end-of-week ritual, which is the classic slot, but nothing enforces a day — a Monday review simply reads a
  thin week and commits to the next.
  - **Known cost, accepted:** Feature 4 ships a writable window of exactly one week, so this widens it to the
    current week plus the next. That is a change to a module already in use, and it applies to every surface
    rather than only the review — a rule that held only inside the ritual would be a behavior that exists in
    one client, which the architecture forbids. Past weeks stay read-only, unchanged.
- **The log lives at `log/YYYY-Www.md`**, one file per week. Feature 4 explicitly handed this reconciliation
  to Feature 5: the roadmap sketches `log/YYYY-WW.md`, and the shipped week identifier is `YYYY-Www`. The
  identifier wins, so a filename and a `top-three.md` section heading for the same week read identically and
  sort chronologically as plain text.
- **An in-progress review is stored in that same weekly log file**, marked as incomplete until it is
  completed, rather than in a separate state file that is promoted at the end. One file per week means there
  is no hidden machine state beside the record, the partial review is inspectable by hand exactly like the
  finished one, and there is nothing to leave behind if the application dies. The cost is that the file exists
  before the review is finished, which is why its incompleteness has to be legible on the page.
- **"Reviewed" is recorded, not just "changed."** A project passed over unchanged is a decision the user made,
  and a log that only records changes cannot distinguish it from a project the user never reached — which is
  precisely the thing the ritual exists to catch.
- **Waiting-for staleness is a per-item policy decision** rather than a threshold number core reads and
  compares itself. Reading the number into core would put the rule back in core in everything but name; asking
  the policy module per item keeps the comparison, the threshold, and the wording of "12 days" all on the
  policy side of the seam. The cost is a decision per item, which is why the performance criterion counts
  reads.
- **The inbox gate is a `warn` by default, per the user's explicit instruction**, and configurable to `block`.
  This is the opposite default from the WIP limit, deliberately: the WIP limit guards a commitment the user is
  making, while a full inbox only makes the picture incomplete, and a review that cannot start is a review
  that does not happen.
- **The inbox step offers navigation to sort, it does not embed sorting.** Sorting is Feature 2's surface and
  already exists; duplicating it inside the review would be a second implementation of the same verbs.
- **Structure gaps and the needs-a-DRI signal are surfaced inline on each project as it comes up in the
  walk**, rather than as a separate fifth step. The user's reason — "this is when I have time to fix them" —
  is satisfied by having the fix available at the moment the project is in front of them, and sort-created
  stubs are already `active`, so they arrive in the walk by construction.
- **The review calls the existing project, top-three, and waiting-for verbs rather than writing files
  itself.** Everything it changes is something another surface can already change, so a second write path
  would be a second set of rules to keep in step.
- **Areas are excluded from the walk** because the user said "each active project", and because an area has
  no outcome, milestones, DRI, or end state to review against.
- **The walk covers `waiting` projects as well as `active` ones**, and a waiting project that has sat too long
  is flagged with the same threshold the waiting-for step uses. This is the roadmap's assignment to this
  feature: Feature 4's limit counts only `active`, so `waiting` is the escape hatch, and the review is the
  only place it gets caught. Parked is deliberately not walked — parking is a decision the user already made
  on purpose, whereas waiting is a claim that someone else is holding things up, and that claim is what goes
  stale.
- **A state change is metadata about the project, so it is recorded as a ledger entry rather than as a
  purpose-built field.** A `waiting since:` field would answer exactly one question and would have to be
  joined by another the next time a feature wanted a duration; a ledger answers the general question once, and
  lets policy and later features decide what is worth flagging without core having guessed in advance which
  durations matter. It is also the shape Feature 6's retrospective wants: a project's history already written
  down rather than reconstructed.
  - **Known cost, accepted:** this reaches outside the ritual. Every status-change path in the core gains a
    ledger write, which is a change to Feature 3's project format and to code this feature would otherwise not
    touch. It is scoped down as far as it can go without being useless — projects only, status changes only,
    no migration of files already on disk — and the entry shape is specified so the next record type inherits
    it rather than inventing a second one.
- **A waiting-for item accumulates its actions in place**, in the continuation grammar the running lists
  already use, rather than gaining a separate file or being deleted when it returns. It is the project ledger
  idea at the scale of a single line: the item keeps its identity, its original date, and everything that has
  happened to it. Nothing is ever removed from `waiting.md` by the application, which matches the habit
  `trash.md` established — the file grows, and pruning stays the user's business.
  - **Known cost, accepted:** an old received item stays visible in the file forever. Filtering the
    outstanding set from the full file is cheap; recovering a deleted record is not.
- **Chasing something resets its untouched clock, deliberately.** The alternative — measuring staleness from
  the original delegation date — would surface the same item every single week no matter what the user did
  about it, which is the fastest way to teach someone to ignore the list. Total age stays visible so a thing
  chased fruitlessly for three months still reads as a three-month-old problem.
- **A duration is only observable at the moment of transition**, which is why it is written down rather than
  derived. Nothing on disk today records when a project entered a status, so a hand-edited status has no
  entry, an unknown duration, and no staleness — the same habit the inbox already follows, where a
  hand-written line gets no invented capture timestamp.
- **Past reviews are read-only in the application and hand-editable on disk**, matching how past weeks of the
  top three already behave. Correcting history is deliberate, and the text editor is the place to do it.
- **The summary is a port, not an extension API, which is what makes it constitutional.** Principle V defers
  loaders, discovery, and public extension surfaces, and Principle III requires everything to work offline —
  so what is built here is the shape `TranscriptionPort` already established: core owns the interface and the
  single call site, a client injects an implementation, and none is injected by default. That leaves an
  LLM-drafted summary a supply-and-configure away without this feature taking a network dependency, shipping a
  provider, or opening an extension surface the constitution says to keep closed.
  - **Why it is worth building now rather than in Feature 8:** the call site is inside review completion, and
    retrofitting it later would mean changing the shape of a completed review after users have weeks of logs
    on disk. Deciding now what a generated summary looks like in the file — attributed, separate, accepted —
    is what keeps that later addition from rewriting the record's meaning.
  - **Suggest, don't decide** is carried over from the roadmap's Feature 8 entry: a draft the user accepts or
    declines, never text that appears because a machine produced it.
- **The user's note is written at completion, not per project.** Thirteen typing prompts inside a walk is how
  a twenty-minute ritual becomes an hour-long one, and the thing the user asked for — the summary of the week —
  is a single piece of prose. Per-project notes are the obvious later addition, and the log's shape leaves room
  for them without requiring them.
- **A completed review is not re-runnable for the same week.** A second pass over the same week would either
  overwrite the record or produce two records of one week; both are worse than the user editing the file.
