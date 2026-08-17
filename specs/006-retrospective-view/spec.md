# Feature Specification: Retrospective View

**Feature Branch**: `006-retrospective-view`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "I want a retrospective view that shows me what I actually accomplished over any date range I choose, so I can write a year-end review, prepare for a performance conversation, or walk into a one-on-one knowing what I've done.

I pick a start and end date — a quarter, a year, since I joined, whatever I want — and it shows me everything completed in that window. Milestones I marked done, with which project each belonged to. Projects I completed. Weekly outcomes I marked done, grouped by the week I committed to them. Everything is ordered by when it was completed, and I can see the whole range at once or narrow it to a single project.

The completions come from my actual data — the completion dates recorded on milestones, on projects, and on weekly outcomes — not from whether I ran a review that week. If I finished something in a week I never got around to reviewing, it still shows up, because it still happened.

On top of that, where I did run a review, the view also shows me what I wrote at the time: my own notes for that week, and what I recorded as having slipped. That's the story around the numbers, and it's only there for weeks I actually reviewed. Weeks I skipped simply have no notes, and the view says so plainly rather than pretending the week was empty.

I can also see what a project's history looks like — when it changed status and how long it sat in each one — drawn from what's already recorded on the project.

The view never changes anything. It reads what's on disk and presents it. It doesn't recalculate, backfill, or infer a completion date that wasn't recorded, and anything without a recorded date is shown as undated rather than guessed at.

I can export what I'm looking at as plain text, so I can paste it into a document I'm writing.

The view must work with no network connection, and it must not generate, summarize, rank, or editorialize anything. It shows me what I did; the writing is mine to do.

This feature does not include the local API, any AI-assisted summarizing or drafting, charts or visualizations, comparisons against goals or targets, anything about other people's work, or writing any new data."

## Clarifications

### Session 2026-08-16

- Q: When the underlying data changes in another window while a retrospective is open, should the view re-read immediately or hold what it showed until the user asks for fresh results? → A: Held, with a refresh offer. The range is read once when it is submitted and the results stand; a change signal surfaces a notice that the data has changed, and the user chooses when to re-read. This is what makes "the export is exactly what I was looking at" provable, and it keeps the core a plain read returning a value rather than something that pushes at a client.
- Q: For a very large range, should the view present the entire result or show it in pages or a capped slice? → A: The whole result, always. The core returns every completion in range with no cap, sample, or truncation; the view shows all of it; the export is that same complete result. How many entries are painted at once is a rendering concern that never changes what the answer contains or its order.
- Q: Where should a project's status history be shown — inside the retrospective when narrowed to that project, on the existing project view, or both? → A: In the retrospective only, appearing when the view is narrowed to a project. This feature adds one surface, not two, and does not reach into Feature 5's project walk or the project view. The core reader over the ledger stays available for a later feature to render elsewhere without reimplementing it.
- Q: When a range covers many weeks the user never reviewed, should each get its own "no review was run" entry, or should they be reported together? → A: Reviewed weeks are shown individually with their narrative; unreviewed weeks are reported together as a count with each week named by its identifier. This says plainly that a skipped week is not an empty one while staying legible over a four-year range, and it is one rule at any length rather than a threshold to pick and defend.
- Q: Should the view state how many entries each section contains, or does counting fall under the rule against summarizing? → A: Counts of what is shown are allowed and required, and nothing beyond them. A count is arithmetic over entries the reader can see listed beneath it, not an opinion or a generated sentence, so it sits outside the no-summarizing rule — which is amended to say so explicitly. Rates, averages, streaks, and per-period or per-project breakdowns remain forbidden.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See What I Actually Finished Over a Range I Choose (Priority: P1)

It is December. The user opens the retrospective, types 1 January and 31 December, and sees the year: every
milestone they marked done — each one naming the project it belonged to — and every project they completed,
in one list ordered by when each was finished. Three of the milestones say "undated" because the user marked
them done in vim months ago and never typed a date; they are shown as exactly that, not slotted into February
because February is where they might have been.

**Why this priority**: This is the feature. Everything else hangs off having a range and the completions
inside it, and this alone answers the question the user actually asks — "what did I get done?" — from data
they have already been recording for five features without being asked to capture anything new. Even with no
narrative, no filter, and no export, a user who can produce this list can write their year-end review from it.

**Independent Test**: With a fixture of milestones and projects carrying completion dates spread across
fourteen months, plus several marked done with no date at all, run a retrospective over a range covering part
of that span. Confirm exactly the dated completions inside the range appear, that each milestone names its
project, that the order is by completion date and identical on a repeated read of unchanged data, that the
undated ones appear as undated and are never given a date, and that no file in the data directory changes.

**Acceptance Scenarios**:

1. **Given** milestones and projects completed on dates inside and outside the chosen range, **When** the
   retrospective is run, **Then** exactly those whose recorded completion date falls within the range —
   inclusive of both endpoints — are shown.
2. **Given** a milestone recorded done with a completion date in range, **When** it is shown, **Then** it is
   shown with the project it belongs to, named as that project currently reads.
3. **Given** several completions in range, **When** they are presented, **Then** they are ordered by recorded
   completion date, and entries sharing a date appear in a stable order that is identical across repeated
   reads of unchanged data.
4. **Given** a milestone marked done with no recorded completion date, **When** the retrospective is run,
   **Then** it is shown as undated, no date is inferred or substituted for it, and it is not placed in the
   dated ordering.
5. **Given** a completion date on disk that does not read as a date, **When** it is shown, **Then** it is
   shown verbatim as it reads, treated as undated for selection and ordering, and never corrected.
6. **Given** a range in which nothing was completed, **When** the retrospective is run, **Then** it states
   plainly that no completions are recorded in that range, and does not error.
7. **Given** a range whose end date precedes its start date, **When** it is submitted, **Then** it is refused
   with a message naming the problem, and nothing is read as a result or written.
8. **Given** any range, **When** the retrospective is run, **Then** the data directory is byte-for-byte
   unchanged afterwards.
9. **Given** a range of a single day, **When** it is run, **Then** completions recorded on that day are shown
   and the range is not widened or narrowed.
10. **Given** a project file that cannot be read or parsed, **When** the retrospective is run, **Then** it is
    surfaced as unreadable, is never silently omitted from the count of what was examined, and the rest of the
    range is still shown.
11. **Given** a retrospective on screen, **When** the underlying data changes in another window, **Then** the
    entries shown do not change, and the user is told the data has changed.
12. **Given** the user has been told the data has changed, **When** they ask for the range to be re-read,
    **Then** a fresh result is read from the files as they now stand.
13. **Given** the user has been told the data has changed, **When** they ignore it, **Then** what is on screen
    remains readable and exportable exactly as it was read.

---

### User Story 2 - See the Weekly Outcomes I Finished, Grouped by the Week I Committed to Them (Priority: P2)

The user's range covers a quarter. Beside the milestones and projects, they see the weekly outcomes they
marked done, gathered under the week each was committed to: three under 2026-W20, one under 2026-W21, none
under 2026-W22. The grouping is what makes them legible — an outcome finished on Thursday means something
different depending on the week it was promised for.

**Why this priority**: The top three is the record of what the user said mattered, and a retrospective that
showed only milestones would miss the commitments that never became milestones. It ranks below the completion
list because that list is the spine, but this is the second of the three sources the user named explicitly.

**Independent Test**: With a `top-three.md` fixture spanning several weeks including an ISO year boundary,
containing outcomes done inside the range, done outside it, and not done at all, run a retrospective over the
range. Confirm exactly the outcomes with a completion date in range appear, that each appears under the week
it was committed to rather than the week it was finished in, that weeks are ordered consistently with the rest
of the view, and that not-done outcomes do not appear as completions.

**Acceptance Scenarios**:

1. **Given** weekly outcomes marked done with completion dates inside and outside the range, **When** the
   retrospective is run, **Then** exactly those with a recorded completion date in range are shown.
2. **Given** an outcome committed to in one week and completed in a later one, **When** it is shown, **Then**
   it appears under the week it was committed to, and the date it was completed is shown with it.
3. **Given** outcomes from several weeks, **When** they are presented, **Then** they are grouped by week, each
   group identified by the same ISO-8601 `YYYY-Www` identifier the top three and the weekly log already use,
   computed by the same rule.
4. **Given** an outcome marked done with no completion date, **When** the retrospective is run, **Then** it is
   shown as undated, exactly as an undated milestone is, and no date is inferred.
5. **Given** outcomes that were never marked done, **When** the retrospective is run, **Then** they do not
   appear among the completions.
6. **Given** a range spanning an ISO year boundary in a 53-week year, **When** outcomes are grouped, **Then**
   each lands in the week identifier the existing rule produces, and no week is duplicated or lost.
7. **Given** no `top-three.md` exists at all, **When** the retrospective is run, **Then** it reports that no
   weekly outcomes are recorded and every other part of the view still works.

---

### User Story 3 - Read What I Wrote at the Time, and See Plainly Where I Wrote Nothing (Priority: P3)

Looking back at the quarter, the user sees their own words against six of the thirteen weeks — the note they
wrote at the end of each review, and what that review recorded as having slipped. Beneath them, one line says
no review was run for the other seven, and names them. One of the six is a review they started and abandoned;
it is shown as it stands, marked incomplete, rather than dressed up as a finished one.

**Why this priority**: The numbers say what got done; the notes say what it was like. It ranks third because
it is additive to the completion list — the user was explicit that completions come from the data and not from
whether a review happened — but it is the difference between a list and a story worth pasting into a
performance conversation. The honest absence matters as much as the presence: a silent week must not read as
an empty one.

**Independent Test**: With weekly logs present for some weeks in the range and absent for others, including
one in-progress log and one log recording no note at all, run the retrospective. Confirm the notes and slipped
records appear verbatim for the weeks that have them, that every week with no log is named in a single
unreviewed report carrying both counts, that a week whose log records no note is distinguishable from a week
with no log, that the in-progress log is shown as incomplete, and that no log file is altered. Then repeat
over a four-year range and confirm the same rule applies with no threshold behaviour appearing.

**Acceptance Scenarios**:

1. **Given** a week in the range whose review was completed with a note, **When** the retrospective is run,
   **Then** that note is shown verbatim as the log records it.
2. **Given** such a week, **When** it is shown, **Then** what the log records as having slipped is shown as
   the log records it, without being recomputed against current data.
3. **Given** weeks in the range with no log at all, **When** the narrative is shown, **Then** they are
   reported together as a count of weeks with no review, each named by its week identifier, alongside the
   total number of weeks the range covers — and none of them is presented as a week in which nothing happened.
3a. **Given** a range of four years in which most weeks were never reviewed, **When** the narrative is shown,
    **Then** the reviewed weeks each appear individually and the rest are named in that same single report,
    with no threshold at which the behaviour changes.
4. **Given** a week whose log exists but records no note, **When** it is shown, **Then** it is distinguishable
   from a week that has no log at all.
5. **Given** a week whose review is still in progress, **When** it is shown, **Then** it is shown as it reads,
   identified as incomplete, and nothing is completed, backfilled, or assumed on its behalf.
6. **Given** a log carrying a generated summary accepted during the review, **When** it is shown, **Then** its
   attribution is intact and it remains plainly separate from the user's own note.
7. **Given** a week whose completions and whose log disagree — something completed in a week the log does not
   mention — **When** the retrospective is run, **Then** the completion still appears, because completions
   come from the recorded dates and not from the log.
8. **Given** a log hand-edited in a text editor, **When** it is shown, **Then** it is shown as it reads and is
   not repaired, reordered, or regenerated.
9. **Given** a week only partly inside the range, **When** it is shown, **Then** the week identifier and the
   calendar dates the week spans are both stated, so the reader can see the note covers days outside the
   range.
10. **Given** the log directory does not exist, **When** the retrospective is run, **Then** every week in the
    range is named in the unreviewed report, no directory or file is created, and nothing errors.

---

### User Story 4 - Narrow to One Project (Priority: P4)

Preparing for a conversation about one particular project, the user narrows the same range to it. They see
that project's milestones, in completion order, and the project's own completion if it landed inside the
range. The weekly outcomes and the weekly notes are not shown, and the view says why: neither is recorded
against a project, so showing an empty list under this filter would be a claim, not a fact.

**Why this priority**: The user asked for it in the same breath as the range itself, and it is what turns a
year-long list into something usable in a specific conversation. It ranks below the three sources because a
filter is only worth having once there is something to filter.

**Independent Test**: With completions across several projects in range, narrow to one project and confirm
only that project's milestone completions and its own completion appear; confirm the weekly outcome and
narrative sections are omitted with a stated reason rather than shown empty; confirm clearing the filter
restores the full range unchanged; and confirm narrowing writes nothing.

**Acceptance Scenarios**:

1. **Given** milestones completed across several projects in range, **When** the user narrows to one project,
   **Then** only that project's milestone completions are shown.
2. **Given** the narrowed project was itself completed inside the range, **When** the view is shown, **Then**
   its completion appears; **Given** it was not, **Then** no completion is invented for it.
3. **Given** the view is narrowed to a project, **When** the user looks for weekly outcomes, **Then** they are
   omitted and the view states that outcomes are not recorded against a project, rather than showing an empty
   list.
4. **Given** the view is narrowed to a project, **When** the user looks for the weekly narrative, **Then** it
   is omitted for the same stated reason: a note belongs to a week, not to a project.
5. **Given** a narrowed project with no completions in the range, **When** the view is shown, **Then** it says
   so plainly and does not error.
6. **Given** the view is narrowed, **When** the user clears the filter, **Then** the full range is shown
   exactly as it was before narrowing.
7. **Given** any narrowing or clearing, **When** it happens, **Then** nothing on disk changes and no
   preference, filter, or view state is written into the data directory.

---

### User Story 5 - Export It as Plain Text (Priority: P5)

The user has the year on screen and a document open in another window. They export, and what they get is the
same list in the same order — the undated entries still labelled undated, the weeks with no review still
saying so — as plain text they can paste straight in and then write around.

**Why this priority**: The stated purpose of the whole feature is writing something afterwards, and text that
cannot leave the window is text the user retypes. It ranks here because it can only export what the earlier
stories put on screen, and because a user could, in the meantime, read the view and type from it.

**Independent Test**: With a populated retrospective on screen, export it and compare the exported text
against what is displayed: same entries, same order, same undated and no-review statements, nothing added or
dropped. Confirm the exported text is legible with no application running, confirm nothing in the data
directory changed as a result of exporting, and confirm the same comparison holds for a narrowed view.

**Acceptance Scenarios**:

1. **Given** a retrospective on screen, **When** the user exports it, **Then** the exported text contains the
   same entries in the same order as shown.
2. **Given** the view contains undated entries and weeks with no review, **When** it is exported, **Then**
   those statements appear in the export exactly as they do in the view.
3. **Given** an export, **When** it is read, **Then** nothing has been added, removed, reordered, ranked,
   summarized, or reworded relative to the view.
4. **Given** a narrowed view, **When** it is exported, **Then** the export reflects the narrowing, including
   the stated reasons for the omitted sections.
5. **Given** an export, **When** it is opened in a plain-text editor with no application running, **Then** it
   is legible and self-explanatory.
6. **Given** an export, **When** it completes, **Then** nothing is written into the data directory, no project
   or log or top-three file is touched, and no record that an export happened is kept.
7. **Given** an empty retrospective, **When** it is exported, **Then** the export states the range and that
   nothing is recorded in it, rather than being an empty file.
8. **Given** the underlying data changed after the view was read and the user has not re-read, **When** they
   export, **Then** the export matches what is on screen — the answer as the files read when the range was
   submitted — and does not silently mix in the newer data.

---

### User Story 6 - See How a Project Moved (Priority: P6)

The user wants to explain why one project took seven months. They narrow the retrospective to it, and beside
its completions they see what the project already records: it went active in February, waited from April,
went active again in June, and was done in September — with how long each of those states lasted, where the
record says. Two earlier transitions the user made by hand in vim show no duration at all, and the view says
unknown rather than doing arithmetic on dates that were never written down.

**Why this priority**: It is the smallest addition and the most narrowly useful, and it reads a record
Feature 5 already writes. It ranks last because the retrospective is complete and useful without it, and
because it answers a question about one project rather than about the range. It hangs off the narrowing story
directly: the history has no place to appear until there is a project filter to appear under.

**Independent Test**: With a project whose ledger holds several status changes, some carrying a duration and
some not, and a second project with no ledger at all, narrow the retrospective to each in turn. Confirm every
recorded entry is shown with its date and the statuses it names, that durations appear only where the entry
records one and read as unknown otherwise, that the project with no ledger reports no recorded history rather
than a history of none, that no history appears in the unnarrowed view, that neither the project view nor the
review's project walk has changed, and that no ledger is written, reordered, or compacted.

**Acceptance Scenarios**:

1. **Given** a project whose ledger records several status changes, **When** the retrospective is narrowed to
   it, **Then** its history appears beside its completions, each entry with its recorded date and the statuses
   it names.
1a. **Given** the retrospective is not narrowed to a project, **When** it is shown, **Then** no project
    history appears anywhere in it.
1b. **Given** this feature is built, **When** the project view and the review's project walk are inspected,
    **Then** neither renders a ledger or a history, and neither has changed.
2. **Given** an entry that records how long the ended state lasted, **When** it is shown, **Then** that
   duration is shown as recorded.
3. **Given** an entry that records no duration, **When** it is shown, **Then** the duration reads as unknown,
   and none is computed from the surrounding dates.
4. **Given** a project with no ledger at all, **When** the retrospective is narrowed to it, **Then** it
   reports that no history is recorded, distinguishable from a project that has never changed status.
5. **Given** a project whose `status:` field and whose last ledger entry disagree, **When** the history is
   shown, **Then** both are shown as they read and neither is repaired to agree with the other.
6. **Given** a ledger entry written by hand, **When** it is shown, **Then** it is read exactly as an
   application-written one and is shown as it reads.
7. **Given** any project history is viewed, **When** it is viewed, **Then** no entry is written, rewritten,
   reordered, compacted, or removed.

---

### Edge Cases

- The range is "since I joined" — four years and several thousand entries. It is a legitimate range and it is
  answered in full: nothing is capped, sampled, or held behind a page the user has to walk. "What did I do
  this year" answered with the first hundred things is a wrong answer, not a shorter one.
- A four-year range produces more entries than fit on a screen. Scrolling is how the user reaches them; how
  many rows are drawn at a time is the client's business and changes neither the result nor the export.
- The range starts before any data exists. Everything recorded is inside it; nothing is fabricated for the
  years before the vault did.
- The start and end are the same day. One day is a range.
- The end date is in the future. It is accepted — a range may reach past today — and simply contains nothing
  after today, which the view does not remark on as an error.
- A milestone was marked done and later reopened by hand, its completion date left behind on the line. The
  view shows what the file says now; it is not a historian of edits it never saw.
- A milestone's text was reworded after it was completed. The current text is shown, because the file is the
  record and there is no earlier version to show.
- A project was renamed. Its current title is shown against every milestone that belonged to it, including
  ones completed under the old name — the retrospective reads projects, not a history of filenames.
- Two milestones on two projects carry the same completion date. Both appear, in a stable order that does not
  change between reads, and neither is presented as having come first in reality.
- A project is `done` with no completion date. It is shown as undated, exactly as an undated milestone is, and
  no date is taken from its ledger, its file, or its last milestone.
- A project carries a completion date while its `status:` says `active`, because the file was hand-edited.
  Both are shown as they read; the completion date is what places it in a range, the status is what the
  project says it is, and neither is rewritten to agree with the other.
- A completion date is typed as `2026-13-45`. It is shown verbatim, counted as undated, and never corrected.
- A completion date is in the future. It is in range if the range reaches that far and outside it otherwise;
  no date is second-guessed.
- Every completion in a long range is undated. The view is not empty — it says everything it found is undated,
  which is a fact about the data and a useful one.
- The range covers thirteen weeks and the user reviewed none of them. All thirteen are named as unreviewed,
  the narrative section is that report and nothing else, and the completions are all still there, because
  completions never depended on the review.
- The range covers four years and 197 of its 209 weeks were never reviewed. Twelve weeks appear with their
  notes and one report names the 197, rather than 197 sections saying the same thing — which is what "says so
  plainly" means at that length.
- Every week in the range was reviewed. The unreviewed report says none, rather than being absent, so a reader
  can tell the difference between a complete record and a section that failed to render.
- A section contains nothing at all. It states zero and says what it found none of, for the same reason: a
  missing count and a count of zero look identical only if one of them is missing.
- A section's count and the entries listed under it could not disagree, because the count is taken from the
  entries. There is no stored total to drift, which is the same habit the inbox count already follows.
- The range covers one week, of which four days fall inside it. That week's note is shown with the week's own
  span stated beside it, so the reader can see the note covers days the range does not.
- A weekly log exists for a week with no completions in it at all. The week is shown with its note and nothing
  completed — a week can be worth writing about and produce no completions, and the view does not hide it.
- A weekly log file has been hand-edited into something that does not parse. It is surfaced as unreadable, is
  never dropped silently, and is never rewritten.
- Two log files claim the same week because one was copied by hand. Both are surfaced as they read; the view
  does not pick a winner or merge them.
- An outcome's text is identical in two different weeks. They are two outcomes, grouped under their own weeks,
  and neither is deduplicated away.
- A project is deleted from disk after milestones were completed against it. Those completions are gone with
  the file, because the file is the record; nothing is recovered from a log, and the view does not report a
  completion it cannot read.
- The vault is completely empty. Every section reports its own emptiness explicitly and the export still
  produces a file that states the range and that nothing is recorded in it.
- The user narrows to a project, then changes the range. The narrowing survives the range change, because it
  is a filter on the same question, and the view is recomputed from disk rather than from what was on screen.
- A project file is edited in another window while the retrospective is open. What is on screen stays on
  screen, and the user is told the data has changed; the entries do not shift under them mid-read. Nothing
  stale is written back, because there is nothing to write back.
- A milestone is completed in another window while the user is halfway through copying a year's worth of
  entries out of the view. The copy they end up with is coherent — it is the answer to the range as the files
  read when they asked — and the new completion appears when they re-read.
- The data changes while a retrospective is on screen and the user never re-reads. What they have is a true
  account of an earlier moment, and it stays exportable as one; the notice is what stops it being mistaken
  for the present.
- The user re-reads and the result is different because they themselves marked something done in another
  window a minute ago. The difference is the point; nothing is reconciled or diffed against the previous
  read, which is not kept.
- The network is unavailable, which is the ordinary case. Every part of the feature works, up to and including
  the export.
- The user asks for the same range twice. The second run produces the same result as the first, because
  nothing in the first run changed anything.

## Requirements *(mandatory)*

### Functional Requirements

#### The range and what it selects

- **FR-001**: The system MUST let the user choose an arbitrary start date and end date and see what was
  completed between them, with both endpoints inclusive.
- **FR-002**: Dates MUST be compared as local calendar dates, in the same form completion dates are already
  recorded, with no time-of-day or timezone conversion applied to a recorded date.
- **FR-003**: A range whose end precedes its start MUST be refused with a message naming the problem, and MUST
  change nothing.
- **FR-004**: A range of a single day MUST be accepted, and a range whose end is in the future MUST be
  accepted without special treatment.
- **FR-005**: Selection MUST be by recorded completion date alone. Whether a review was run for the week
  containing a completion MUST NOT affect whether that completion appears.
- **FR-006**: The retrospective MUST include every milestone recorded done whose completion date falls in the
  range, every project whose completion date falls in the range, and every weekly outcome whose completion
  date falls in the range.
- **FR-006a**: The result MUST contain every completion in the range. It MUST NOT be capped, truncated,
  sampled, limited to a most-recent subset, or otherwise reduced, whatever the size of the range or the number
  of entries it contains.
- **FR-007**: Each included milestone MUST be shown with the project it belongs to, named as that project
  currently reads.
- **FR-008**: Milestone and project completions MUST be ordered by recorded completion date, and entries
  sharing a date MUST appear in a stable order that is identical across repeated reads of unchanged data.
- **FR-009**: A range containing no completions MUST report that plainly and MUST NOT be an error.
- **FR-010**: The retrospective MUST state the range it is showing, so an exported or archived copy is
  self-describing.
- **FR-010a**: A retrospective MUST be read once, when the range is submitted, and the results MUST stand
  unchanged on screen until the user asks for them to be re-read. Entries MUST NOT appear, move, or vanish
  while the user is reading.
- **FR-010b**: When the underlying data changes while a retrospective is on screen, the user MUST be told
  that the data has changed. The view MUST NOT re-read on its own, and MUST NOT present the changed data as
  though it were what the user asked for.
- **FR-010c**: Users MUST be able to re-read the same range on demand, producing a fresh result read from the
  files as they now stand.
- **FR-010d**: Being told the data has changed MUST NOT alter, invalidate, or blank the results already shown.
  A stale retrospective is still a true account of what the files said when it was read, and MUST remain
  readable and exportable as such.
- **FR-010e**: The view MUST present the whole result. How many entries are drawn at a time is a rendering
  concern and MUST NOT change which entries the result contains, their order, or what an export produces.
  There MUST be no page, slice, or limit the user has to move through to reach an entry in range.
- **FR-010f**: Each section MUST state how many entries it contains, counted from the entries shown in it, so
  the number and the list beneath it can never disagree. A section containing nothing MUST state zero rather
  than omitting its count.
- **FR-010g**: Counts MUST be the only figures derived. The retrospective MUST NOT compute a rate, an average,
  a streak, a per-quarter or per-month breakdown, a per-project breakdown, or any other derived statistic over
  what it shows.

#### Weekly outcomes

- **FR-011**: Weekly outcome completions MUST be grouped by the week the outcome was committed to, not by the
  week it was completed in.
- **FR-012**: Each group MUST be identified by the ISO-8601 `YYYY-Www` week identifier the top three and the
  weekly log already use, computed by the same rule, so a week's outcomes, its log, and its identifier all
  refer to the same seven days.
- **FR-013**: Each shown outcome MUST carry its recorded completion date, so a commitment finished late is
  legible as such.
- **FR-014**: Outcomes not marked done MUST NOT appear among the completions.
- **FR-015**: When no top three has ever been recorded, the retrospective MUST report that no weekly outcomes
  are recorded and every other part of the view MUST still work.

#### Undated and unreadable records

- **FR-016**: A milestone, project, or outcome recorded done with no completion date MUST be shown as undated.
  No date MUST be inferred, substituted, computed, or backfilled for it, from a ledger, a log, a file
  timestamp, a neighbouring entry, or anything else.
- **FR-017**: Undated completions MUST be presented distinctly from dated ones, labelled so that a reader sees
  they are recorded as done but carry no date and therefore cannot be placed within the range.
- **FR-018**: A recorded completion date that does not read as a date MUST be shown verbatim as it reads on
  disk, MUST be treated as undated for selection and ordering, and MUST NOT be corrected or rewritten.
- **FR-019**: Where a completion date and the record's own status disagree — a hand-edited file — both MUST be
  shown as they read, neither MUST be repaired, and the record MUST NOT be excluded on that basis.
- **FR-020**: A project file, log file, or outcome line that cannot be read or parsed MUST be surfaced as
  unreadable. It MUST NOT be silently dropped, and MUST NOT be rewritten.

#### The weekly narrative

- **FR-021**: For each week overlapping the range that has a weekly log, the retrospective MUST show the
  user's own note for that week, verbatim as the log records it.
- **FR-022**: For each such week, the retrospective MUST also show what the log records as having slipped, as
  the log records it.
- **FR-023**: The narrative MUST be read from the week's log only. It MUST NOT be recomputed, re-derived, or
  reconciled against current project, outcome, or waiting-for data.
- **FR-024**: Each week in the range that has a log MUST be shown individually, with its narrative.
- **FR-024a**: The weeks in the range with no log MUST be reported together, as a count of how many had no
  review, with each such week named by its week identifier. They MUST NOT be omitted, MUST NOT be silently
  absorbed into the reviewed weeks, and MUST NOT be presented as weeks in which nothing happened.
- **FR-024b**: That report MUST state the total number of weeks the range covers alongside the number with no
  review, so the proportion is legible without the reader doing arithmetic.
- **FR-024c**: The rule MUST be the same at every range length. There MUST NOT be a threshold, count, or range
  size at which unreviewed weeks start or stop being named.
- **FR-024d**: When every week in the range was reviewed, the report MUST still appear and MUST state that
  none were missed, so a reader can distinguish a complete record from a section that failed to render.
- **FR-025**: A week whose log records no note MUST be distinguishable from a week that has no log at all.
- **FR-026**: A log recording a review still in progress MUST be shown as it reads and identified as
  incomplete. It MUST NOT be completed, backfilled, or treated as a finished review.
- **FR-027**: A generated summary recorded in a log MUST be shown with its attribution intact and MUST remain
  plainly separate from the user's own note, as the log records both.
- **FR-028**: A week overlapping the range at any day MUST be accounted for in the narrative. Every week shown
  individually MUST state both its week identifier and the calendar dates it spans, so a partially covered
  week is legible as such; a week named in the unreviewed report is identified by its week identifier alone.
- **FR-029**: A missing log directory MUST leave every week in the range named in the unreviewed report, MUST
  NOT error, and MUST NOT cause any directory or file to be created.

#### Narrowing to one project

- **FR-030**: Users MUST be able to narrow the retrospective to a single project, and to clear that narrowing
  and see the full range again unchanged.
- **FR-031**: A narrowed retrospective MUST show that project's milestone completions in range and that
  project's own completion when it falls in range, and no other project's.
- **FR-032**: Because no weekly outcome carries a project association in the data, a narrowed retrospective
  MUST omit the weekly outcome section and MUST state that reason, rather than presenting an empty list that
  would read as "nothing was committed".
- **FR-033**: For the same reason — a note belongs to a week, not to a project — a narrowed retrospective MUST
  omit the weekly narrative and MUST state that reason.
- **FR-034**: A narrowed project with no completions in range MUST say so plainly and MUST NOT error.
- **FR-035**: Narrowing, clearing, and changing the range MUST write nothing: no file, no preference, and no
  view state in the data directory.

#### A project's status history

- **FR-036**: Users MUST be able to see a project's status history — the status changes recorded against it
  and how long each ended state lasted — when the retrospective is narrowed to that project. It MUST appear
  alongside that project's completions, and MUST NOT be shown in the unnarrowed view.
- **FR-036a**: This feature MUST NOT add the history, or any other rendering of the ledger, to the project
  view, the review's project walk, or any other existing surface. One surface is added, not two.
- **FR-036b**: The reader that produces the history MUST live in the core beside the rest of this feature, so
  a later feature can render it on another surface without reimplementing it.
- **FR-037**: The history MUST be read from the project's ledger and from nothing else. It MUST NOT be
  reconstructed from completion dates, logs, file timestamps, or any other source.
- **FR-038**: Each entry MUST show the date it records, the statuses it names, and the duration it records for
  the state that ended.
- **FR-039**: Where an entry records no duration, the duration MUST read as unknown. None MUST be computed,
  inferred, or backfilled from surrounding entries or dates.
- **FR-040**: A project whose ledger holds no entries MUST report that no history is recorded, distinguishable
  from a project shown as never having changed status.
- **FR-041**: Where a project's `status:` field and its ledger disagree, both MUST be shown as they read and
  neither MUST be repaired to agree with the other.
- **FR-042**: A hand-written ledger entry MUST be read exactly as an application-written one and MUST be shown
  as it reads.
- **FR-043**: Viewing a history MUST NOT write, rewrite, reorder, compact, summarize, or remove any entry.

#### Export

- **FR-044**: Users MUST be able to export exactly what the retrospective is currently showing as plain text.
- **FR-045**: The export MUST contain the same entries in the same order as the view — which is the whole
  result for the range (FR-006a, FR-010e) — including the undated labelling, the no-review statements, and the
  stated reasons for any omitted section. Nothing MUST be added, removed, reordered, ranked, summarized, or
  reworded relative to the view, and no part of the result MUST be omitted from the export on the grounds that
  it was not drawn on screen at the moment of export.
- **FR-046**: The export MUST state the range it covers and any active project narrowing, so it is
  self-describing once separated from the application.
- **FR-047**: The export MUST be legible and comprehensible in a plain-text editor with no application
  running.
- **FR-048**: An empty retrospective MUST still export, stating the range and that nothing is recorded in it.
- **FR-049**: Exporting MUST NOT write into the data directory, MUST NOT alter any project, log, or top-three
  file, and MUST NOT record anywhere that an export happened.
- **FR-050**: The exported text MUST be obtainable both as a copy the user can paste directly and as a file
  saved to a location the user chooses, so no intermediate application is required to get it into the document
  they are writing.

#### What the retrospective never does

- **FR-051**: The retrospective MUST NOT create, modify, or delete any project, milestone, weekly outcome,
  weekly log, waiting-for item, inbox item, ledger entry, or configuration file.
- **FR-052**: The retrospective MUST NOT recalculate, backfill, or infer a completion date that was not
  recorded.
- **FR-053**: The retrospective MUST NOT generate, summarize, draft, rank, score, grade, or editorialize any
  text. Every word it shows either came from the user's data or is the view's own fixed labelling. A count of
  the entries shown in a section (FR-010f) is explicitly not a summary: it is arithmetic over facts the reader
  can see listed beneath it, and carries no judgement about them.
- **FR-054**: The retrospective MUST NOT compare what it shows against a goal, a target, a quota, a previous
  period, or any other benchmark.
- **FR-055**: The retrospective MUST NOT report on, aggregate, or rank anyone else's work. Where a project
  names a DRI, that is shown as part of the project as it reads, and no per-person view or comparison is
  built.
- **FR-056**: The retrospective MUST NOT send a message, email, reminder, or notification to anyone.
- **FR-057**: The retrospective MUST NOT prompt, schedule, or nag the user to run it.

#### Policy, platform, and architecture

- **FR-058**: This feature MUST NOT declare a policy decision point and MUST NOT consult one. Nothing it does
  is an allow, warn, or block, and the declared count MUST remain the five already in place.
- **FR-059**: Every capability in this feature MUST function with no network connection.
- **FR-060**: The retrospective MUST be implemented in the core as a module with its own interface, with any
  client a thin consumer that renders, routes input, and calls the core, holding no logic of its own.
- **FR-061**: The retrospective MUST use the vocabulary already in the core — project, milestone, top three,
  outcome, week, review. Any term it needs that does not yet exist MUST be added to the core first, so every
  client inherits it.
- **FR-062**: The retrospective MUST read the files already on disk in the shapes Features 3, 4, and 5
  established. It MUST NOT require a new file, a new field, a migration, or any change to how completions are
  recorded.
- **FR-063**: A missing top-three file, a missing log directory, a missing project directory, or an
  unreadable individual file MUST each leave the retrospective usable, reporting what is absent or unreadable
  rather than failing.

### Key Entities

- **Retrospective range**: The question being asked — a start date, an end date, and optionally one project.
  Held for the duration of a look; never stored, never written to disk, and re-answered from the files each
  time it is asked.
- **Completion**: One thing recorded as finished — a milestone, a project, or a weekly outcome — together with
  the date recorded against it and enough context to identify it a year later: for a milestone, the project it
  belonged to; for an outcome, the week it was committed to. Read, never written.
- **Undated completion**: A completion recorded as done with no readable date. Not an error and not excluded —
  a distinct category the view names, because "I finished this and never wrote down when" is a true statement
  about the data and the only honest thing to show.
- **Week narrative**: What a week's log records about that week — the user's own note, what the log calls
  slipped, and any accepted generated summary with its attribution. Present only for weeks with a log, shown
  as the log reads, never recomputed. Its absence is itself shown, distinct from a week with nothing in it.
- **Project status history**: The project's ledger, read and presented — one entry per recorded status change,
  with the date, the statuses named, and the duration where the entry records one. Unknown where the ledger is
  silent. The ledger is the record of how a project got where it is, and this view is a reader of it, not a
  second interpreter.
- **Reading**: One answer to one range, read from the files at one moment and then held. It is complete — every
  completion in range, never capped or paged — and it does not change underneath the user; a change signal
  offers a fresh reading rather than replacing this one. What makes an export provably equal to what was on
  screen, and what makes "the same range twice" a testable claim.
- **Unreviewed weeks report**: The single statement covering every week in the range with no log — how many
  there were, out of how many weeks the range covers, and which ones by identifier. Present even when there
  are none, so a complete record is distinguishable from a section that did not render. The honest form of
  "weeks I skipped have no notes" at any range length.
- **Export**: A plain-text rendering of exactly what the view currently shows, self-describing about its range
  and its filter, produced for the user to paste or save and written nowhere the application will read it back.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can produce a full year's completion list for a vault of 100 projects in under 10
  seconds from opening the view to seeing the first entry.
- **SC-002**: Across a fixture of completions dated from three years before the range to one year after it,
  100% of the entries shown fall inside the chosen range and 100% of the in-range entries are shown — no
  entry missed and none included in error, verified at range boundaries on both endpoints.
- **SC-003**: Running the same retrospective twice over unchanged data produces byte-identical output in 100%
  of runs, including the order of entries sharing a completion date.
- **SC-004**: The data directory is byte-for-byte identical before and after every operation this feature
  offers — running a retrospective, narrowing it, viewing a project history, and exporting — across the full
  test suite, with zero files created, modified, or deleted.
- **SC-005**: Across a fixture where every kind of record appears both dated and undated, 100% of undated
  completions are shown as undated and zero dates are inferred, substituted, or backfilled anywhere in the
  output.
- **SC-006**: A completion recorded in a week with no review appears in 100% of cases, verified against a
  fixture where half the weeks in range have no log at all.
- **SC-007**: Every week overlapping the range is accounted for — either shown individually with its narrative
  or named in the unreviewed report — with zero weeks silently omitted, verified at a 13-week range and at a
  209-week one. A week whose log records no note is distinguishable from a week with no log in 100% of cases.
- **SC-007a**: The unreviewed report names 100% of the weeks with no log and states both counts, and the same
  rule holds at every tested range length — zero thresholds, and no range size at which the behaviour changes.
- **SC-008**: 100% of notes and slipped records shown are byte-identical to what the corresponding log file
  contains, verified by comparing the rendered text against the file.
- **SC-009**: Weekly outcomes are grouped under the week they were committed to in 100% of cases, verified
  across a fixture spanning an ISO year boundary including a 53-week year, with zero weeks duplicated or lost.
- **SC-010**: Narrowing to a project shows that project's completions and no other project's in 100% of cases,
  and clearing the narrowing reproduces the unnarrowed view byte-identically.
- **SC-011**: An exported retrospective matches the view it was taken from entry-for-entry and in order, in
  100% of cases, with zero entries added, dropped, reordered, or reworded, verified for a full range, a
  narrowed range, and an empty range.
- **SC-012**: 100% of exports are legible and self-describing in a plain-text editor with no application
  running, each stating its range and any active filter.
- **SC-013**: Across a fixture of projects with ledgers containing entries with and without recorded
  durations, 100% of durations shown come from a ledger entry and 0% are computed, with unknown shown wherever
  the ledger is silent.
- **SC-014**: A project with no ledger reports no recorded history in 100% of cases, and is never rendered as
  a project that has not changed status.
- **SC-014a**: A project history appears in 100% of narrowed retrospectives and 0% of unnarrowed ones, and
  zero existing surfaces — the project view, the review's project walk — render a ledger or gain a change from
  this feature.
- **SC-015**: Zero generated, summarized, ranked, or inferred text appears anywhere in the view or the export
  across the full test suite; 100% of displayed content is either verbatim user data, fixed labelling present
  in the view's own vocabulary, or a count of the entries shown beneath it.
- **SC-015a**: Every count shown equals the number of entries listed in its own section, in 100% of cases
  including sections containing nothing, and zero figures other than counts appear anywhere in the view or the
  export — no rate, average, streak, or breakdown.
- **SC-016**: Every capability in this feature works with the network disabled, verified across the full test
  suite, and zero bytes leave the machine.
- **SC-017**: A missing top-three file, a missing log directory, an unparseable project file, an unparseable
  log, and a malformed completion date each leave the retrospective usable and every other section intact, in
  100% of tested paths, with the affected record surfaced rather than dropped.
- **SC-018**: The number of declared policy decision points is unchanged by this feature, verified by
  assertion — five before, five after.
- **SC-019**: In a four-year range over a vault of 100 projects with 2,000 completions, every project file is
  read at most once to build the view — verified by counting reads, not by timing.
- **SC-020**: With a retrospective on screen, 100% of writes made elsewhere leave the displayed entries
  unchanged and produce a change notice; zero re-reads occur without the user asking, verified by counting
  reads across a fixture of writes to projects, the top three, and the logs.
- **SC-021**: An export taken after the data changed but before the user re-read matches the displayed view
  entry-for-entry in 100% of cases, with zero entries from the newer data appearing in it.
- **SC-022**: Over a four-year range containing 2,000 completions, the result and its export each contain all
  2,000 — zero entries capped, sampled, truncated, or unreachable — verified by counting entries in the export
  against the fixture.

## Out of Scope

Explicitly excluded, and named here so a later feature can claim them rather than this one growing into them:

- **The local HTTP/JSON API** (Feature 7). The retrospective is a core module a later API can call; this
  feature does not expose it over a network.
- **Any AI-assisted summarizing, drafting, or ranking** (Feature 8). The user was explicit: the view shows
  what they did, the writing is theirs. Feature 5's summary port exists at review completion and is not
  reached from here; no port, provider, or call site is added by this feature.
- **Charts, graphs, visualizations, or any graphical rendering of the data.** Counts and lists only.
- **Comparison against goals, targets, quotas, or prior periods.** No "up 12% on last quarter", no streaks, no
  scores.
- **Anything about other people's work.** No per-DRI aggregation, no team view, no comparison. A project's DRI
  is shown as part of the project because it is on the project.
- **Writing any new data.** No new file, field, index, cache, or migration. The retrospective is possible
  precisely because Features 3, 4, and 5 already record what it needs, and the moment it writes something it
  stops being a reader.
- **Backfilling or repairing completion dates.** A milestone with no date stays undated. Offering to fix that
  is a separate, deliberate, writing feature.
- **Ledger entries for actions other than status changes.** Feature 5 records status changes only; this
  feature reads what is there and does not extend the ledger to make a richer history possible.
- **Ledgers on anything but projects.** Areas, waiting-for items, and outcomes do not gain one here.
- **Areas.** They have no completion date and no end state, so there is nothing for a retrospective of
  completions to show.
- **Waiting-for items as completions.** A received item is a delegation returning, not an accomplishment; the
  weekly logs already record what the user did about the ones that went stale, and that record is shown as
  part of the narrative rather than counted as a completion.
- **Rendering the project history anywhere but the narrowed retrospective.** The project view and the
  review's project walk are untouched by this feature. The core reader exists for a later feature to use; a
  second rendering built now would be two surfaces to keep in step for a question the user asked about the
  retrospective.
- **Editing anything from within the view.** Marking a milestone done, correcting a date, or writing a note
  are existing surfaces' verbs; a read-only view that could write would need every decision point the writing
  surfaces have.
- **Saved ranges, named periods, or remembered filters.** A range is a question asked in the moment. Storing
  one would be writing into the data directory, which this feature does not do.
- **Scheduling, notifying, or prompting the user to look at it.** Daily surfacing is Feature 9's.

## Assumptions

- **The range is inclusive at both ends and is expressed in local calendar dates**, the same form completion
  dates already take on disk. Comparing a stored `2026-03-14` against a range endpoint as text-shaped local
  dates avoids a timezone conversion that could silently move a completion into or out of a range — which
  would be exactly the kind of recalculation the user forbade.
- **Completions are ordered most recent first**, matching the convention Feature 5 established for listing
  past reviews, so the application does not order the same kind of thing two ways in two places. The direction
  is one fixed rule rather than a per-user setting; a user writing chronologically reads or pastes upward,
  which is cheaper than a preference this feature would have nowhere to store.
- **The tie-break for entries sharing a completion date is stable and derived from the data**, not from
  filesystem order, so repeated reads of unchanged data produce identical output. Two things finished on the
  same day genuinely have no recorded order, and inventing one that changes between runs would be worse than
  a fixed arbitrary one.
- **A count is not a summary, and the spec says so rather than leaving it to be argued.** The user forbade
  generating, summarizing, ranking, and editorializing, all of which are the view forming an opinion about the
  work. Counting the entries listed directly beneath the number is not that: it is arithmetic the reader could
  do themselves, over facts already on the page, and "18 milestones" is usually the first line of the document
  they are about to write. The boundary is drawn tightly — counts only, taken from the entries shown, with no
  stored total to drift and nothing derived beyond them — because every step past a count (a rate, a streak, a
  per-quarter split) is where a view starts having a view.
- **Unreviewed weeks are named together rather than given a section each.** The requirement the user set is
  that a skipped week must not read as an empty one, and a count that names every missed week satisfies that
  exactly — while two hundred near-identical sections would bury the six weeks they actually wrote something
  about, which is the same failure in the other direction. Naming the weeks rather than only counting them is
  what keeps it a record rather than a statistic. It is deliberately one rule at every length: a threshold
  would be a number with no principled value, and the first thing a reader would have to learn about the view.
- **A week is included in the narrative if it overlaps the range at all**, and each week states its own span.
  Including only fully-covered weeks would silently drop the note for the week a quarter ends in, which is
  usually the most relevant one; stating the span is what keeps the partial overlap honest.
- **The narrative comes from the logs and the completions come from the records**, and the two are never
  reconciled. This is the user's own distinction and it is load-bearing: a milestone finished in an unreviewed
  week appears because it was recorded done, and a log's account of what slipped is shown as written because
  it is a record of what the user believed at the time, not a claim to be re-checked against today's files.
- **An in-progress review's log is shown as it stands, marked incomplete.** Feature 5 stores an in-progress
  review in the same weekly file as the finished one, so a partial log is what a paused review looks like on
  disk. Hiding it would misreport the week as unreviewed; presenting it as finished would misreport what the
  user did.
- **Weekly outcomes and the weekly narrative are omitted, with a stated reason, when the view is narrowed to a
  project.** Neither carries a project association anywhere in the data, so any project-scoped rendering of
  them would be a guess. Showing them unfiltered under a project filter would imply an association that does
  not exist; showing an empty list would imply the user committed to nothing. Saying why is the only honest
  option, and it is cheap.
- **A milestone's project is the file it lives in**, so "which project each belonged to" needs no new field
  and no join. A project renamed after a milestone was completed shows its current title, because there is no
  record of the old one and this feature does not create one.
- **Undated completions are shown rather than dropped.** The user asked for undated rather than guessed, which
  implies they are still shown; a range cannot contain them, so they are gathered in their own labelled
  section that states exactly that. The cost is that a user with many hand-edited files sees a section they
  may not have expected, which is the point — it is a true fact about their data.
- **A malformed date is treated as undated for ordering and selection, and shown verbatim.** It is neither a
  usable date nor an absent one; showing it as it reads lets the user find and fix it in vim, which is where
  fixing it belongs.
- **The export is markdown**, the same plain text the vault is already written in, so it pastes into the
  documents the user is likely writing and stays readable if it does not. This follows Principle IV rather
  than being a separate choice.
- **The export is offered both as a direct copy and as a file the user places**, because "paste it into a
  document I'm writing" is the stated purpose and a file the user then has to open and copy is a worse version
  of the same thing. The saved file goes wherever the user says, defaulting outside the data directory —
  writing an export into the vault would make the retrospective a writer.
- **This feature declares no decision point**, because it holds no opinion that could differ between two users
  who both use Waypoint correctly. There is no rule here to allow, warn, or block: a date range is a question,
  not a commitment. Feature 5's guard on the count stands unchanged at five.
- **The project history appears under the project filter, and this feature adds exactly one surface.** The
  moment the user narrows to a project is the moment they are asking "what happened with this one?", so the
  history has a natural place to be without a new destination or a change to a surface another feature owns.
  Adding it to the project view as well would be two renderings of the same read to keep in step, for a
  question the user asked about the retrospective; the core reader is where the reuse lives, and a later
  feature can render it without this one guessing where.
- **The result is never reduced, and rendering is never allowed to reduce it either.** A cap or a page would
  turn a wrong answer into one that looks complete, which is the specific failure a retrospective cannot
  afford — the user is going to paste it into a document and treat it as the record. Keeping the whole result
  also makes the export requirement trivially true rather than a three-way comparison between what the core
  returned, what was drawn, and what was written out. The cost, accepted, is that a client rendering a
  four-year range has real work to do; that work is the client's, and the performance criteria bound it by
  counting file reads rather than by shrinking the answer.
- **A retrospective is read once and held, rather than re-read on every change signal.** The roadmap's rule
  that an open view must reflect changes to its data is honoured by the notice, not by re-rendering: this
  view's output is something the user reads, copies, and pastes, and entries shifting mid-read would break
  both the copy in their clipboard and the promise that an export is what they were looking at. Holding also
  keeps the core a plain read that returns a value — a subscription that pushed updates would put view
  lifecycle into a module whose only job is to answer a question about files. The cost, accepted, is that a
  user can sit in front of a stale answer; the notice is what stops that being a silent failure, and the
  answer stays true about the moment it was read.
- **Nothing in this feature is a capture surface**, so Principle VI's latency budget does not apply; the
  performance criteria here are about a large read finishing promptly, which is why they count file reads
  rather than milliseconds.
- **Everything this view needs is already recorded**: the completion date a milestone gains when it is marked
  done, the one a project gains when it is completed, the one an outcome gains when it is finished, and the
  status history a project accumulates in its ledger. This feature is a reader over records Features 3, 4,
  and 5 already write, and adds no field to any of them. If something turns out to be missing, the honest
  place to add it is the writing feature that should have recorded it, not here.
