# Feature Specification: Weekly Top Three and WIP Limit

**Feature Branch**: `004-top-three-wip-limit`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "I want a weekly top-three and a work-in-progress limit, so I focus on what matters and can tell when I'm overcommitted.

Each week I pick one to three outcomes that matter most for that week. I can view them, change them, and mark them done. Setting a new week's top three doesn't erase the previous week's — past weeks are kept so I can look back at what I committed to.

Separately, there's a limit on how many projects I'm actively driving at once. This counts only projects where I am the DRI. Projects where someone else is the DRI are ones I'm overseeing, not driving — I may have many of those as a manager, and they are never capped or counted. A project with no DRI at all does not count either: an unknown owner is not the same as me. When I try to make a project active beyond the limit, the system tells me, explains why, and names what I'd need to finish or park first.

The system needs to know which DRI refers to me. There's a configured canonical name for me, plus a list of aliases for the other ways my name already appears across existing projects. Both are stored with my data, not with the app, so any client reading my data resolves identity the same way. I maintain the alias list myself.

Matching a DRI to me handles formatting differences only, never guesses at identity. It ignores case, trims surrounding whitespace, and collapses repeated internal spaces. It may ignore a trailing period, so a name with or without one is the same. It must never treat a shorter name and a longer one as the same person — two different people on my team can share a first name, and quietly merging them would misattribute their work to me or count it against my limit. If I want two spellings treated as me, I add both to my alias list deliberately.

If a DRI matches one of my aliases but is also ambiguous against another distinct name that appears in my data, the system flags it as ambiguous rather than resolving it silently.

Projects that have no DRI are surfaced as needing one. This is its own separate signal — it is not part of the existing incomplete-structure flag, and a project missing only a DRI is not considered incomplete. Like the other flags, it is informational and never blocks me.

The limit itself is a rule, not a fact about my data, so it lives in the policy module rather than in core. Resolving who I am is a fact about my data and lives in core, so the weekly review, the retrospective view, and future features can use it without going through policy.

This feature does not include the weekly review ritual, the retrospective view, the local API, or any AI-assisted suggestions."

## Clarifications

### Session 2026-08-14

- Q: When the user edits or completes a weekly outcome, should the system first check that the entry still matches what was on screen, and refuse the write if the file changed underneath it? → A: Entry-level verify-before-write, mirroring Feature 3's FR-045a/b — cancel on mismatch, leave the file untouched, re-present the week as it now reads.
- Q: When deciding whether a DRI that matches one of the user's aliases is ambiguous, which names in the data count as evidence that a second person with that name exists? → A: DRI names plus milestone verifier names — the same project files already being read, no dependency on `waiting.md`.
- Q: Should opening a single project pay the cost of reading every project's names to answer "is this DRI ambiguous?", or should ambiguity appear only in the project list? → A: Every surface that reports resolution reports ambiguity; the name corpus is derived per read and never cached, within a stated performance budget.
- Q: Which week-numbering rule defines "the current week", and how are the first days of January handled? → A: ISO-8601 week date — Monday start, week 01 contains the first Thursday, labelled with the ISO week-numbering year, so 1 Jan 2027 may read `2026-W53`.
- Q: Is the "at most three" cap on weekly outcomes a configurable policy rule, or is three fixed in core as part of what "top three" means? → A: Policy, default 3 — the same test the constitution applied to the milestone cap. The feature ships three decision points.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Commit to One to Three Outcomes a Week, and Keep the Record (Priority: P1)

On Monday the user decides what actually matters this week and writes down three outcomes. Midweek one of
them turns out to be the wrong bet, so they change it. Thursday they finish another and mark it done. The
following Monday they set a new top three, and last week's is still there, unchanged, with its done marks
intact — so in three months they can page back and see what they said mattered, week by week, and how much
of it they actually finished.

**Why this priority**: This is the focus half of the feature and it stands entirely on its own. It needs no
identity resolution, no policy module, and no projects — a user with an empty vault gets value from it on
day one. It is also the artifact Feature 5's review ritual and Feature 6's retrospective will read, so it
has to exist before either can be built.

**Independent Test**: With no identity configured and no projects on disk, set a top three for the current
week, change one entry, mark another done, then advance to the next week and set a different top three.
Confirm both weeks are readable, that the earlier week is byte-for-byte unchanged apart from nothing, and
that every state is legible and hand-editable in a plain-text editor.

**Acceptance Scenarios**:

1. **Given** no top three has ever been set, **When** the user views the current week, **Then** an empty
   top three is shown with no error and an invitation to set one.
2. **Given** an empty current week, **When** the user adds one outcome, **Then** it is saved and the week
   is valid with a single entry — one is enough, two and three are not required.
3. **Given** a current week at the configured maximum, **When** the user attempts to add one more, **Then**
   the system refuses, states the maximum, and the existing outcomes are unchanged.
4. **Given** a current week with three outcomes, **When** the user edits the text of one, **Then** only
   that entry changes and the other two keep their text and their done state.
5. **Given** a current week with three outcomes, **When** the user removes one, **Then** two remain and the
   week is still valid.
6. **Given** an outcome that is not done, **When** the user marks it done, **Then** it is recorded as done
   with the local calendar date it was completed.
7. **Given** an outcome marked done, **When** the user unmarks it, **Then** it returns to not done and its
   completion date is removed.
8. **Given** a week that already has a top three, **When** a new week begins and the user sets that week's
   top three, **Then** the new week is recorded alongside the previous one and no previous week's entries,
   text, done marks, or completion dates are altered or removed.
9. **Given** several weeks of history, **When** the user views past weeks, **Then** each week is shown with
   its own outcomes and done state, identified by the week it belongs to, most recent first.
10. **Given** a past week, **When** the user views it in the application, **Then** it is presented as a
    record and offers no edit affordance, while remaining editable by hand in a text editor.
11. **Given** the current week is open and an outcome is reworded in a text editor, **When** the user saves
    an edit to that same outcome, **Then** the write is cancelled, the file is left byte-for-byte
    unchanged, and the week is re-presented as it now reads on disk.
12. **Given** the current week is open and a *different* outcome is reworded in a text editor, **When** the
    user saves an edit to the outcome they were editing, **Then** the write proceeds and the hand-edit to
    the other outcome survives.

---

### User Story 2 - Know Which Projects Are Mine (Priority: P2)

The user's vault already has thirty projects, and their own name appears on them three different ways
because they were typed by hand over months. They write a canonical name and those spellings into their
identity file. Now every project view can say plainly whether they are the DRI, someone else is, or nobody
is. Two projects show a "needs a DRI" note, because sort created them as stubs and nobody was ever named.
One project shows "ambiguous", because it says `Scott` and there is a distinct `Scott R.` elsewhere in the
vault — the system will not guess which human that is.

**Why this priority**: Identity resolution is a fact about the data, and it is the prerequisite for the WIP
limit, the weekly review, and the retrospective view. It is independently valuable before any limit exists:
knowing which projects are yours and which need an owner is useful on its own. It ranks after the top three
because the top three delivers value with no configuration at all.

**Independent Test**: With no policy module and no limit in play, configure a canonical name and two
aliases, then list projects and confirm each one reports exactly one of mine / someone else's /
unassigned / ambiguous, that the classification is correct against a fixture covering every normalization
rule, and that a project missing only a DRI is surfaced as needing one while still not being flagged as
incomplete.

**Acceptance Scenarios**:

1. **Given** an identity file naming a canonical `me` value, **When** a project's DRI equals that value,
   **Then** the project is reported as the user's.
2. **Given** an alias list, **When** a project's DRI equals one of the aliases, **Then** the project is
   reported as the user's, exactly as if it had matched the canonical value.
3. **Given** a canonical value of `Scott Rodgers`, **When** projects carry DRIs of `scott rodgers`,
   `  Scott Rodgers  `, `Scott   Rodgers`, and `Scott Rodgers.`, **Then** all four are reported as the
   user's, because case, surrounding whitespace, repeated internal spaces, and a trailing period are
   formatting differences rather than differences of identity.
4. **Given** a canonical value of `Scott`, **When** a project's DRI is `Scott Rodgers`, **Then** it is
   **not** reported as the user's — a longer name is a different name until the user says otherwise.
5. **Given** a canonical value of `Scott Rodgers`, **When** a project's DRI is `Scott`, **Then** it is
   **not** reported as the user's, for the same reason in the other direction.
6. **Given** a project whose DRI is a name that matches nothing in the identity file, **When** it is read,
   **Then** it is reported as someone else's and is never counted as the user's.
7. **Given** a project with no DRI at all, **When** it is read, **Then** it is reported as unassigned —
   distinct from both the user's and someone else's — and is surfaced as needing a DRI.
8. **Given** a project that is missing only a DRI and has an outcome, milestones, and a next action,
   **When** the user views their projects, **Then** it is surfaced as needing a DRI and is **not** flagged
   as needing structure.
9. **Given** an alias of `Scott` and a distinct DRI `Scott R.` present elsewhere in the vault, **When** a
   project whose DRI is `Scott` is read, **Then** it is reported as ambiguous rather than as the user's,
   and the reason names the other name it collides with.
9a. **Given** an alias of `Scott` and a milestone verified by `Scott R.` — with `Scott R.` never appearing
    as a DRI anywhere — **When** a project whose DRI is `Scott` is read, **Then** it is reported as
    ambiguous, because a verifier is a teammate and evidence of a second person by that name.
9b. **Given** an alias of `Scott` and the user themselves named as a verifier as `Scott`, **When** a
    project whose DRI is `Scott` is read, **Then** it is reported as the user's and not as ambiguous — a
    name matching an identity value is not evidence of a second person.
9c. **Given** an alias of `Scott` and a waiting-for item owned by `Scott R.` in `waiting.md`, **When** a
    project whose DRI is `Scott` is read, **Then** it is reported as the user's, because identity
    resolution does not read that file.
10. **Given** no identity file exists, **When** projects are read, **Then** no project is reported as the
    user's, nothing errors, and the absence of configuration is surfaced plainly rather than silently
    treated as "no projects are mine".
11. **Given** an identity file, **When** the application runs for any length of time and the user works
    normally, **Then** no alias is ever added, suggested, inferred, or learned by the system.

---

### User Story 3 - Be Told When I Am Overcommitting (Priority: P3)

The user is the DRI on three active projects and that is their limit. A new piece of work arrives and they
try to set its status to active. The system refuses, says they are already driving three projects when the
limit is three, and lists those three by name so they can see exactly what they would have to finish or park
to make room. They park the least urgent one and the new project goes active. Meanwhile, the eleven projects
they oversee — where a report is the DRI — sit untouched by any of this, because overseeing is not driving.

**Why this priority**: This is the overcommitment half of the feature and the reason the policy seam exists.
It ranks third because it is meaningless without identity resolution (P2) beneath it, and because the top
three already delivers the focus benefit on its own.

**Independent Test**: With a limit of three configured and identity set, take three projects the user is
DRI on to active, then attempt a fourth and confirm the refusal, its explanation, and the named remediation
candidates. Then confirm that ten projects with other people as DRI and five with no DRI can all be active
simultaneously without ever triggering the limit.

**Acceptance Scenarios**:

1. **Given** the user is DRI on projects at the limit and all are active, **When** the user tries to set
   another project where they are the DRI to active, **Then** the change is refused, the user is told the
   limit and the current count, and the refusal names the active projects they would need to finish or park.
2. **Given** the same state, **When** the user parks one of the named projects and retries, **Then** the
   change succeeds.
3. **Given** the same state, **When** the user marks one of the named projects done and retries, **Then**
   the change succeeds.
4. **Given** the user is at the limit, **When** they set a project whose DRI is someone else to active,
   **Then** it succeeds, regardless of how many such projects are already active.
5. **Given** the user is at the limit, **When** they set a project with no DRI to active, **Then** it
   succeeds, because an unknown owner is not the user.
6. **Given** the user is at the limit, **When** they set a project with an ambiguous DRI to active, **Then**
   it succeeds, because an unresolved identity is not the user's identity.
7. **Given** the user is below the limit, **When** they set one of their own projects to active, **Then** it
   succeeds with no message, warning, or interruption.
8. **Given** the user is at the limit, **When** they change one of their own active projects to parked,
   waiting, or done, **Then** it succeeds — the limit only ever guards becoming active.
9. **Given** no identity is configured, **When** the user sets any project to active, **Then** it succeeds,
   because with no identity the system cannot know any project is the user's.
10. **Given** more of the user's projects are active than the limit allows because the files were edited by
    hand, **When** the user views their projects, **Then** the over-limit state is shown plainly and nothing
    is blocked, refused, or automatically changed.
11. **Given** a refusal has occurred, **When** the user reads it, **Then** it states the rule, the current
    count against the limit, and the specific projects involved — never a bare rejection.

---

### User Story 4 - Rules Live With My Data, Not With the App (Priority: P4)

The user opens their data directory in a text editor and changes the WIP limit from three to two, because
they have decided they were still overcommitting. Every client that opens that directory now enforces two.
Alongside it, the rules that already shipped — at most four milestones, and the confirmation when marking a
project done with milestones still open — read their values from the same place and behave exactly as they
did before.

**Why this priority**: No new user-facing capability, which is why it ranks last, but it is what makes the
first three stories honest: rules that are configurable, that travel with the data, and that no client can
disagree about. The constitution requires the two rules already shipped in Feature 3 to move behind this
seam as part of this feature.

**Independent Test**: Change the configured WIP limit and confirm the enforced behavior changes with no
application change. Then run Feature 3's existing milestone-cap and open-milestone test suites unchanged and
confirm they still pass with the rules now sourced from configuration.

**Acceptance Scenarios**:

1. **Given** the configured WIP limit is three, **When** the user edits it to two and reopens, **Then** the
   refusal fires at the third project instead of the fourth.
2. **Given** no policy configuration file exists, **When** the system runs, **Then** documented default
   values apply, nothing errors, and no file is silently created behind the user's back.
3. **Given** a project with four milestones, **When** the user adds a fifth, **Then** it is refused with the
   same behavior and the same user-visible outcome as before this feature.
4. **Given** a project with open milestones, **When** the user marks it done, **Then** they are asked to
   confirm, with the still-open milestones named, exactly as before this feature.
5. **Given** a policy configuration value that is missing, malformed, or out of range, **When** it is read,
   **Then** the documented default is used, the problem is surfaced to the user, and no operation is
   blocked by the configuration error itself.
6. **Given** two different clients opening the same data directory, **When** each evaluates the same action,
   **Then** both receive the same decision, because both loaded the same rules from the data.
6a. **Given** the configured weekly outcome cap is two, **When** the user adds a third outcome to a week,
    **Then** it is refused, and the feature is still called the top three.
7. **Given** a project with three milestones, **When** the user adds a fourth, **Then** it is accepted
   silently — the relocated cap must stay quiet on exactly the inputs it stayed quiet on before.
8. **Given** a project whose milestones are all complete, **When** the user marks it done, **Then** no
   confirmation is asked for, because the relocated rule fires on the same conditions as before.

---

### Edge Cases

- The user's top three is set, and then the file is hand-edited to contain four entries. The system shows
  all four as they are on disk rather than silently deleting one; the cap governs what the system will
  write, not what it will read.
- A week is set, then the same week is opened again after the calendar has moved into the next week. The
  earlier week remains a past week and remains read-only in the application.
- A top three is set on Sunday and the user returns on Monday. It is now a past week, because the week
  turned over on Monday morning rather than at the weekend.
- A top three is set on 31 December and the user returns on 1 January. Whether the week turned over depends
  on the ISO week, not on the calendar year — both days may sit in the same week, carrying the same
  identifier, and that week is still the current one.
- The user skips several weeks entirely. The absent weeks simply do not exist in the file; they are not
  materialised as empty, and reading a week with no entry yields an empty top three rather than an error.
- A top-three outcome is empty or whitespace-only. It is refused on write, the same way a milestone with no
  definition of done is.
- The identity file exists but names no canonical value, or names an empty one. No project resolves to the
  user, and the missing configuration is surfaced.
- An alias duplicates the canonical value, or two aliases normalize to the same string. The duplicate is
  harmless and the resolution is unchanged.
- An alias is a formatting variant that the normalization rules already cover, e.g. `scott rodgers` when
  the canonical value is `Scott Rodgers`. It is redundant, not an error.
- A DRI is a name that is a strict extension of an alias — `Scott R.` against alias `Scott` — and the user
  genuinely wants both to mean them. Nothing resolves it automatically; the user adds `Scott R.` to the
  alias list, and only then does it count.
- A DRI matches an alias and collides with more than one other distinct name in the vault. It is ambiguous,
  and the reason can name more than one collision.
- Every project in the vault is unassigned. The needs-a-DRI signal fires on all of them and blocks nothing.
- A project is made active while it is at the limit, and simultaneously another window parks one of the
  counted projects. The count is evaluated against the state on disk at the moment the decision is made,
  and the user is never shown a refusal naming a project that is no longer active.
- The vault contains no projects at all. The count is zero, the limit never fires, no name corpus exists,
  nothing resolves as ambiguous, and no view errors.
- A single project is opened in a vault where every other project file is unreadable or malformed. The
  corpus is built from what could be read, the project still resolves, and one bad file does not make
  opening an unrelated project fail.
- The WIP limit is configured to zero. Every attempt to make one of the user's projects active is refused,
  which is a coherent configuration and is not corrected.
- A project's DRI is literally the word `me`, as Feature 3's format contract permits. It resolves to the
  user only if `me` is in the alias list — no sentinel value is reserved.

## Requirements *(mandatory)*

### Functional Requirements

#### Weekly top three

- **FR-001**: The system MUST allow the user to record between one outcome and the configured maximum
  (three by default) for a given week. One is a valid, complete top three; the count is never required to
  reach the maximum.
- **FR-002**: Each outcome MUST be free text supplied by the user, and MUST NOT be linked to, derived
  from, or required to correspond to a project, milestone, or any other record.
- **FR-003**: A week MUST be identified by the ISO-8601 week date: weeks begin on Monday, week 01 is the
  week containing the first Thursday of the year, and the identifier carries the ISO week-numbering year
  rather than the calendar year of any particular day in it.
- **FR-003a**: The identifier MUST be written `YYYY-Www` — for example `2026-W33` — zero-padded to two
  digits, so identifiers sort chronologically as plain text.
- **FR-003b**: Days in early January belonging to the previous ISO year MUST be labelled with that previous
  year, and days in late December belonging to the next ISO year MUST be labelled with the next year. No
  week may belong to two identifiers, and no week may be skipped.
- **FR-003c**: This is the definition of a week for the whole system. Feature 5's weekly log files MUST use
  the same computation, so that a week's top three and that week's log refer to the same seven days.
- **FR-004**: The system MUST refuse to record an outcome beyond the configured maximum for a week, stating
  that maximum, and MUST leave the existing outcomes unchanged when it refuses. The maximum is a policy
  value defaulting to three (FR-063).
- **FR-005**: The system MUST refuse to record an outcome whose text is empty or whitespace-only.
- **FR-006**: Users MUST be able to view the current week's top three, including when it is empty.
- **FR-007**: Users MUST be able to change the text of an individual outcome without altering the text or
  done state of the others.
- **FR-008**: Users MUST be able to remove an individual outcome, leaving a valid week with fewer outcomes,
  including an empty one.
- **FR-009**: Users MUST be able to mark an outcome done, and the system MUST record the local calendar
  date on which it was marked.
- **FR-010**: Users MUST be able to unmark a done outcome, and doing so MUST remove its completion date.
- **FR-011**: Recording a new week's top three MUST NOT alter, remove, overwrite, or reorder any previous
  week's outcomes, done states, or completion dates.
- **FR-012**: Users MUST be able to view previous weeks' top threes, each identified by its week, ordered
  most recent first.
- **FR-013**: The application MUST present past weeks as a read-only record, offering no edit, completion,
  or removal affordance for a week other than the current one.
- **FR-014**: The top three MUST be stored at rest as human-readable, hand-editable plain text in the
  git-tracked data directory, in a location and format that Feature 5's review and Feature 6's
  retrospective can read without the application running.
- **FR-015**: The system MUST display a week exactly as it is stored, including a hand-edited state that
  exceeds three outcomes, and MUST NOT silently repair, truncate, or reorder it on read.
- **FR-015a**: Immediately before writing an outcome — its text, its done state, or its removal — the
  system MUST verify that that entry still reads on disk as the view was showing it. It MUST NOT rely on a
  copy read when the view opened.
- **FR-015b**: If that verification fails, the system MUST cancel the write, leave the file byte-for-byte
  unchanged, tell the user what the entry now says, and re-present the week as it currently reads on disk.
- **FR-015c**: Verification MUST be scoped to the individual entry being written, not to the week as a
  whole. An unrelated hand-edit to a different outcome in the same week MUST NOT cancel the write.
- **FR-016**: The system MUST NOT generate, suggest, pre-fill, or rank a weekly outcome. Every outcome
  originates from an explicit user entry.

#### Identity resolution

- **FR-017**: The system MUST store a single canonical name for the user and a list of aliases naming the
  other ways the user's name appears in their data.
- **FR-018**: Identity configuration MUST live in the git-tracked data directory alongside projects, areas,
  and the inbox — not in application configuration — so that any client opening that directory resolves
  identity identically.
- **FR-019**: Identity configuration MUST be stored in a file separate from policy configuration.
- **FR-020**: The system MUST expose, as a fact about the data rather than as a rule, the answer to
  "does this DRI refer to the user?", available to any consumer without depending on the policy module.
- **FR-020a**: Every surface that reports a resolution MUST report the same four-way answer, ambiguity
  included. A single-project view and the project list MUST NOT give different answers for the same
  project, which means opening one project resolves against the whole vault's names.
- **FR-020b**: The name corpus MUST be derived on each read and MUST NOT be cached, stored, or persisted.
  As with Feature 3's structure flag, stored derived state would drift the first time the user edited a
  project in a text editor.
- **FR-020c**: Resolution MUST read each project file at most once per read operation. A per-project
  implementation that rebuilds the corpus for every project is a defect, not an optimization target.
- **FR-021**: The answer MUST be exactly one of: the user's, someone else's, unassigned, or ambiguous.
- **FR-022**: Matching MUST be case-insensitive.
- **FR-023**: Matching MUST ignore whitespace surrounding the name.
- **FR-024**: Matching MUST treat repeated internal whitespace as a single space.
- **FR-025**: Matching MUST treat a name with a trailing period and the same name without one as the same
  name.
- **FR-026**: Matching MUST NOT treat a shorter name and a longer name as the same person under any
  circumstances — no prefix matching, no initial expansion, no first-name matching, no fuzzy or
  edit-distance matching, and no substring containment.
- **FR-027**: The only way for a second spelling to resolve to the user MUST be the user adding it to the
  alias list explicitly.
- **FR-028**: A DRI that matches the canonical value or an alias MUST be reported as ambiguous, rather than
  as the user's, when the user's data also contains a distinct person name of which the matched value is a
  strict leading-word subsequence — that is, another person's name that could plausibly have been written
  the shorter way.
- **FR-028a**: The names counted as evidence under FR-028 MUST be the DRI values and the milestone verifier
  values present in the project files. A verifier is a teammate, so a second person sharing the user's
  first name is evidence of ambiguity wherever in a project they are named.
- **FR-028b**: Names appearing outside the project files — waiting-for owners in particular — MUST NOT be
  counted. Identity resolution reads the project files and the identity configuration, and MUST NOT take a
  dependency on `waiting.md`, the inbox, or any other file.
- **FR-028c**: A name that matches an identity value MUST NOT count as evidence against itself. The user
  appearing as a verifier on their own project is not evidence of a second person.
- **FR-029**: An ambiguous result MUST name the other DRI value or values it collides with, so the user can
  resolve it by editing the alias list or the project.
- **FR-030**: The system MUST NOT add, infer, suggest, learn, or auto-populate an alias. The alias list is
  maintained by the user.
- **FR-031**: When no identity configuration exists, or it names no canonical value, the system MUST report
  no project as the user's, MUST surface that identity is not configured, and MUST NOT error or treat the
  absence as a meaningful "none of these are mine".

#### The needs-a-DRI signal

- **FR-032**: The system MUST surface, per project, whether the project has no DRI.
- **FR-033**: This signal MUST be distinct from the existing incomplete-structure flag and MUST NOT be
  expressed as an additional structure gap.
- **FR-034**: A project that has an outcome, at least one milestone, and a next action, and is missing only
  a DRI, MUST NOT be flagged as needing structure. Feature 3's FR-009 is preserved unchanged.
- **FR-035**: The needs-a-DRI signal MUST be informational and MUST NOT block, refuse, gate, or delay any
  operation.
- **FR-036**: The signal MUST be derived from the project's current DRI field each time it is read, never
  stored as separate state.
- **FR-037**: Areas MUST NOT carry, display, or be evaluated for this signal, since an area has no DRI.

#### The work-in-progress limit

- **FR-038**: The system MUST enforce a limit on the number of projects that are simultaneously active and
  have the user as DRI.
- **FR-039**: The limit MUST count only projects whose status is active and whose DRI resolves to the user.
- **FR-040**: Projects whose DRI resolves to someone else MUST NOT be counted or capped, in any number.
- **FR-041**: Projects with no DRI MUST NOT be counted or capped.
- **FR-042**: Projects whose DRI is ambiguous MUST NOT be counted or capped.
- **FR-043**: Projects whose status is parked, waiting, or done MUST NOT be counted, whoever the DRI is.
- **FR-044**: The system MUST refuse a change that would take a project the user is DRI on to active while
  the count is already at or above the limit.
- **FR-045**: The refusal MUST state the rule, the current count, and the configured limit.
- **FR-046**: The refusal MUST name the specific active projects the user is DRI on, as the set from which
  one must be finished or parked to make room.
- **FR-047**: The refusal MUST be evaluated against the state of the data at the moment of the decision,
  and MUST NOT name a project that is no longer active.
- **FR-048**: The limit MUST NOT be triggered by, and MUST NOT interfere with, a change from active to
  parked, waiting, or done.
- **FR-049**: When identity is not configured, the limit MUST NOT fire, because no project can be known to
  be the user's.
- **FR-050**: When the data already exceeds the limit — reached by hand-editing files outside the
  application — the system MUST surface the over-limit state informationally and MUST NOT retroactively
  block, refuse, or alter anything.
- **FR-051**: The system MUST NOT change a project's status, DRI, or existence on the user's behalf to
  bring the data within the limit.

#### Policy placement and configuration

- **FR-052**: The work-in-progress limit MUST be implemented in the policy module, not in core, because it
  is a rule about how the user chooses to work rather than a fact about their data.
- **FR-053**: Identity resolution MUST be implemented in core, not in policy, and MUST be usable by the
  weekly review, the retrospective view, and future features without depending on the policy module.
- **FR-054**: Core MUST declare the named decision points at which policy is consulted, and MUST NOT
  contain the rules themselves.
- **FR-055**: A policy decision MUST return exactly one of allow, warn, or block, together with a reason a
  client can display.
- **FR-056**: Enforcement MUST occur at core's decision points, so that no client can bypass a rule another
  client enforces, and every client receives the same decision for the same action.
- **FR-057**: Policy configuration MUST live in the git-tracked data directory alongside projects, areas,
  and the inbox, in human-readable, hand-editable plain text.
- **FR-058**: The configured WIP limit MUST be changeable by editing that file alone, with no application
  change, and the new value MUST take effect for every client opening that directory.
- **FR-059**: When policy configuration is absent, the system MUST apply documented default values, MUST
  NOT error, and MUST NOT create the file without the user asking.
- **FR-060**: When a configuration value is malformed or out of range, the system MUST apply the documented
  default, surface the problem, and MUST NOT block any operation because of the configuration error.
- **FR-061**: Feature 3's milestone cap MUST be relocated behind a decision point as a block decision, with
  its user-visible behavior unchanged.
- **FR-062**: Feature 3's confirmation when marking a project done with open milestones MUST be relocated
  behind a decision point as a warn decision, with its user-visible behavior unchanged, including naming
  the still-open milestones.
- **FR-062a**: For both relocated rules, "unchanged" MUST cover **when the rule fires**, not only what it
  says when it does. The conditions under which each rule triggers and stays silent MUST be identical
  before and after the move, at the boundaries in particular: the fourth milestone is accepted and the
  fifth refused; marking done with every milestone complete does not ask for confirmation, and with one or
  more still open it does.
- **FR-062b**: The equivalence in FR-062a MUST be asserted by tests written against the pre-move behavior
  and run unmodified against the post-move implementation. Rewriting a test to match what the relocated
  rule does is a failure of the migration, not a fix to the test.
- **FR-063**: The cap on the number of weekly outcomes MUST be a policy decision at a decision point, for
  the same reason the milestone cap is, with a documented default of three.
- **FR-063a**: This feature MUST therefore ship exactly three decision points — one before a project's
  status changes, one before a milestone is added, and one before a weekly outcome is recorded — and no
  others. A decision point with no rule registered against it MUST NOT be declared speculatively.
- **FR-063b**: The name "top three" is core vocabulary and MUST NOT change with the configured cap. A user
  who configures a different maximum has changed a rule, not renamed the concept — the same way the
  milestone cap being configurable does not rename milestones.
- **FR-064**: Exactly one default policy module MUST ship. A plugin loader, module discovery mechanism, or
  public extension API MUST NOT be built.
- **FR-065**: All of this feature's capabilities MUST function with no network connection.

### Key Entities

- **Weekly top three**: The outcomes the user committed to for a specific ISO week — at least one, at most
  the configured maximum, three by default. Each
  outcome carries free text, a done state, and a completion date present only when done. Weeks accumulate;
  a new week never displaces an old one. Identified by its week, not by position.
- **Identity**: The canonical name for the user plus the list of aliases covering the other spellings of
  that name in the user's data. A fact about a data directory, stored with the data, read by core, and
  maintained by hand.
- **DRI resolution**: The answer to whether a given DRI value refers to the user — the user's, someone
  else's, unassigned, or ambiguous. Derived on read from the DRI value, the identity configuration, and the
  set of distinct person names — DRIs and milestone verifiers — present in the project files. Never stored.
- **Needs-a-DRI signal**: A derived, informational, per-project indication that no DRI is named. Separate
  from the incomplete-structure flag, and never blocking.
- **Policy configuration**: The values the default policy module enforces — the WIP limit, the milestone
  cap, the weekly outcome cap. Stored with the data, in a file separate from identity, so every client
  loads the same rules.
- **Decision point**: A named place in core where policy is consulted before an action proceeds. Returns
  allow, warn, or block, with a displayable reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can set, change, and complete a top three across four consecutive weeks, and at the
  end all four weeks are readable with their original text and done marks intact — zero prior-week entries
  lost or altered.
- **SC-002**: Setting a week's top three from an empty state takes under 60 seconds for three outcomes.
- **SC-002a**: Week identification is correct for 100% of a fixture spanning at least three year boundaries,
  including a 53-week year, a 1 January that belongs to the previous ISO year, and a 31 December that
  belongs to the next — with every week mapping to exactly one identifier and no week unreachable.
- **SC-002b**: Week identifiers sort chronologically as plain text across a year boundary, verified over a
  fixture of at least 60 consecutive weeks.
- **SC-003**: An outcome beyond the configured maximum is refused in 100% of attempts, with the existing
  outcomes left unchanged — verified at the default of three and at one other configured value.
- **SC-004**: Every top three ever recorded is readable and editable in a plain-text editor with no
  application running, verified for 100% of stored weeks.
- **SC-004a**: A hand-edit made to an outcome while the week is open is never overwritten — 100% of writes
  against a changed entry are cancelled with the file left byte-for-byte unchanged, and 100% of writes
  against an unchanged entry succeed despite unrelated hand-edits elsewhere in the same week.
- **SC-005**: Across a fixture covering case differences, leading and trailing whitespace, repeated internal
  spaces, and trailing periods, 100% of formatting variants of a configured name resolve to the user.
- **SC-006**: Across a fixture of shorter-versus-longer name pairs, 0% are resolved to the user by the
  matching rules alone — no prefix, initial, first-name, substring, or fuzzy match ever succeeds.
- **SC-007**: For a vault of 30 projects with three spellings of the user's name, every project reports
  exactly one of the four resolution results, with 100% agreement against a hand-checked expected mapping.
- **SC-008**: Every DRI that both matches an identity value and collides with a distinct longer name in the
  data is reported as ambiguous, in 100% of tested cases, and never as the user's — verified with the
  colliding name appearing as a DRI, and again with it appearing only as a milestone verifier.
- **SC-008a**: A colliding name that appears only outside the project files produces zero ambiguity flags,
  and identity resolution reads zero files other than the project files and the identity configuration.
- **SC-009**: A project missing only a DRI produces the needs-a-DRI signal and produces no
  needs-structure flag, in 100% of tested projects.
- **SC-010**: With the limit set to three, the user can hold at most three of their own active projects,
  and the fourth attempt is refused in 100% of attempts.
- **SC-011**: With the limit set to three, 10 projects owned by other people and 5 projects with no DRI can
  all be active at once and produce zero refusals and zero warnings.
- **SC-012**: 100% of limit refusals name at least one specific project the user could finish or park, and
  every named project is verifiably active and the user's at the moment of refusal.
- **SC-013**: Changing the limit in the configuration file alone changes the enforced behavior on the next
  read, with no application change, verified for at least two different values.
- **SC-014**: Feature 3's existing milestone-cap and open-milestone test suites pass unchanged after the
  rules move behind decision points — zero user-visible behavior differences, and zero test files edited
  to accommodate the move.
- **SC-014a**: Both relocated rules fire on exactly the same inputs before and after the move, verified at
  the trigger boundaries — third, fourth, and fifth milestone; done with zero, one, and several open
  milestones — with 100% agreement between pre-move and post-move results.
- **SC-015**: No operation in this feature is blocked, refused, or delayed by the needs-a-DRI signal, by an
  ambiguous resolution, or by missing identity or policy configuration, in 100% of tested paths.
- **SC-016**: Every capability in this feature works with the network disabled, verified across the full
  test suite.
- **SC-016a**: A project list of 100 projects, with identity resolved and ambiguity determined for every
  one, is available within Feature 3's existing 100 ms budget — the budget does not move to accommodate
  this feature.
- **SC-016b**: Opening a single project in a vault of 100 projects resolves its DRI, ambiguity included,
  within 100 ms.
- **SC-016c**: Producing a 100-project list reads each project file at most once — verified by counting
  reads, not by timing, so the quadratic implementation fails even on hardware fast enough to hide it.
- **SC-017**: 100% of stored weekly outcomes and aliases are traceable to an explicit user entry; no
  generated, suggested, inferred, or auto-learned value appears at any point in testing.

## Out of Scope

Explicitly excluded, and named here so a later feature can claim them rather than this one growing into
them:

- **The weekly review ritual** (Feature 5). This feature stores a top three and can display it; it does not
  script a review, does not gate on inbox zero, does not walk projects for status updates, and does not
  write weekly log files.
- **The retrospective view** (Feature 6). Past weeks are readable, but no cross-project achievement view
  over a date range is built here.
- **The local HTTP/JSON API** (Feature 7).
- **Any AI-assisted suggestion** (Feature 8) — no suggested outcomes, no suggested DRIs, no inferred
  aliases, no ranking.
- **A plugin loader, policy module discovery, or a public extension API.** The seam and one default module
  only; the interface stays internal.
- **A person or contact entity.** DRIs and verifiers remain free-text names, as Feature 3 established.
  Identity resolution answers one question about one person — the user — and builds no directory of others.
- **Linking top-three outcomes to projects or milestones.**
- **Any migration of existing project files.** No `dri` value on disk is rewritten, and no sentinel value
  is introduced.

## Assumptions

- **Only the `active` status counts toward the limit.** "Actively driving" is read as status `active`; a
  project in `waiting` is blocked on someone else and is not being driven, and `parked` and `done` are
  plainly not. This follows the user's own framing — the limit fires when making a project *active*, and
  the remediation is to *finish or park*.
  - **Known consequence, accepted:** `waiting` therefore becomes a pressure valve. A user at the cap can
    move a project to `waiting` that is not genuinely blocked, and the limit stops meaning anything. This
    is deliberately **not** solved here — tightening the limit to catch it would require the system to
    judge whether a block is real, which it cannot do and should not guess at. The natural place it gets
    caught is Feature 5's stale waiting-for check, which already surfaces things that have sat waiting too
    long. Recorded so that the gap is a known one rather than an oversight.
- **The default limit is three**, matching the roadmap's "refuses a 4th active project" and the top three's
  symmetry. It is configurable, and a configured zero is honored rather than corrected.
- **The limit is a `block` decision, not a `warn`.** The roadmap says the system refuses; a refusal that can
  be clicked through is not the guardrail described.
- **An ambiguous DRI does not count toward the limit.** An unresolved identity is unknown, and the
  established principle is that unknown is not the user's. Counting it would reintroduce exactly the
  false-alarm failure mode that scoping the limit to the user's own projects exists to avoid.
- **Ambiguity is defined as a leading-word collision** — a matched identity value that is a strict leading
  subsequence of the words of another distinct DRI name in the data, e.g. `Scott` against `Scott R.`. This
  is the concrete, testable form of "two people on my team share a first name". A value that merely shares
  characters with another name is not ambiguous.
  - **Known limit, accepted:** this catches the collision that actually misfires — a bare `Scott` that
    could be the user or `Scott R.` — and not every real-world one. Two other people written `Scott K.`
    and `Scott R.`, where the user is neither and no plain `Scott` is configured, produce no ambiguity
    flag, correctly: neither name matches an identity value, so nothing is being resolved to the user and
    there is nothing to warn about. Detecting that those two are distinct people would be inferring
    identity, which is the line this feature refuses to cross.
- **Ambiguity is evaluated over the person names in the project files — DRIs and milestone verifiers** — so
  it is a property of the vault as a whole rather than of a single project read in isolation. Verifiers are
  included because a teammate who shares the user's first name is evidence of a second person wherever on a
  project they are named, and the project files are already being read to build the corpus. The boundary is
  drawn at the project files deliberately: widening it to `waiting.md` would make core identity resolution
  depend on a file it otherwise has no reason to open, and every added source widens the net in a direction
  that weakens the WIP limit, since an ambiguous DRI stops counting.
- **Only the current week is editable in the application.** Past weeks are a record. The files stay
  hand-editable, which is the escape hatch for correcting history deliberately.
- **The week identifier is the ISO-8601 week date, written `YYYY-Www`.** This feature defines it rather
  than inheriting it: the roadmap points at a `log/YYYY-WW.md` convention, but Feature 5 is unbuilt and no
  such computation exists in the code yet, so there was nothing to inherit. Feature 5 must adopt this
  definition rather than the reverse. Reconciling the log *filename* spelling with the `YYYY-Www`
  identifier is Feature 5's to settle; what matters here is that both derive the week the same way.
- **A January date may carry the previous year's label**, which looks wrong at a glance and is correct.
  It is the price of every week having exactly one identifier, and the alternative conventions all buy a
  friendlier-looking January with either a partial week or a duplicated week number.
- **The top three is stored in one file holding all weeks**, keeping history together, greppable, and
  trivially reviewable by hand. Its growth is bounded at roughly 52 short sections a year.
- **Identity and policy configuration files follow the existing plain-text conventions on disk** — the same
  `key: value` preamble and `##` section shapes projects and areas already use — so a user reads them with
  the mental model they already have.
- **Alias maintenance is hand-editing.** The application reads identity and may display it; it offers no
  alias editor, which follows directly from the requirement that the system never infer an alias.
- **Feature 3's format contract stands unchanged.** A `dri` value of `me` remains ordinary free text; it
  resolves to the user only if the user puts `me` in their alias list.
- **The weekly outcome cap is policy, not core**, applying the project's own test — a rule two users could
  set differently while both still using Waypoint correctly. The constitution applied that same test to the
  milestone cap, which was equally baked into Feature 3's "2–4 milestones" phrasing, and reclassified it;
  treating the near-identical rule differently one feature later would make the seam harder to reason
  about than either answer on its own. The cost is a third decision point, accepted deliberately.
- **The policy seam is in scope for this feature**, and the migration of Feature 3's milestone cap and
  open-milestone confirmation with it. The constitution's amendment to Principle V assigns both to this
  feature explicitly, and the seam has to be built here regardless for the WIP limit to have anywhere to
  live.
- **The over-limit-by-hand-edit state is displayed, never corrected.** In a plain-text system the user can
  always reach a state the rules would have refused; the honest response is to show it, since silently
  rewriting the user's files would violate the guarantee the format exists to provide.
