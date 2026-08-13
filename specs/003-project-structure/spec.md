# Feature Specification: Projects with Milestones

**Feature Branch**: `003-project-structure`

**Created**: 2026-08-12

**Status**: Draft

**Input**: User description: "I want projects to have real structure so I can drive them to completion, but structure is never forced up front.

A project has a title, an outcome that defines what done actually means, between two and four milestones, a single next action, a DRI (the directly responsible individual, which may be me), and a status of active, parked, waiting, or done. Each milestone has its own definition of done and a verifier — the person who confirms it's actually complete, which may also be me.

A project created during sort starts as a bare stub with only a title and a status. That is a valid state. I can add outcome, milestones, next action, and DRI whenever I choose, and I can fill them in partially.

Any project missing an outcome, milestones, or a next action is flagged as incomplete and needing structure. Incomplete projects are clearly visible when I view my projects, so nothing sits half-defined without me noticing. This flag is informational — it never blocks me from working with the project.

I can view a single project and see its full structure, edit any field, mark individual milestones done, and change the project's status. When every milestone is done and I mark the project done, it stops appearing in my active list.

When I mark a milestone done, it stays visible on the project rather than disappearing, so I can see both what's completed and what remains — for example, two of four done. Marking a milestone done records the date it was completed. Marking a project done records its completion date the same way. These dates are stored permanently so completed work can be reviewed later over any time range.

Areas are different from projects: they are ongoing responsibilities with no outcome, no milestones, and no completion. They have a title and a status only.

This feature does not include the weekly review ritual, the top-three or work-in-progress limit, the local API, or any AI-assisted structuring — those are later features."

## Clarifications

### Session 2026-08-12

- Q: Is the 2–4 milestone range enforced or advisory — must a fifth milestone be refused, and does a single milestone count as incomplete? → A: Hard ceiling, soft floor. A fifth milestone is refused with an explanation; a project with exactly one milestone is accepted and not flagged. Only zero milestones flags as incomplete.
- Q: Which statuses may an area have? → A: `active` and `parked` only. `done` is excluded because an area never completes; `waiting` describes work blocked on someone else's deliverable, which an ongoing responsibility does not have.
- Q: What happens if a project file is hand-edited in a text editor while the project is open in the app and the user then saves a field? → A: Verify the field being written. Cancel only if that field changed on disk; unrelated changes elsewhere in the file are accepted and folded in.
- Q: Is draining `## Unprocessed` — converting sort's raw items into structure — in scope for this feature? → A: Show and dismiss only. Unprocessed items are visible in the project view and can be dismissed individually once handled, but nothing converts them into a milestone, next action, or outcome; the user retypes into the field they want.
- Q: May a project be marked done while some of its milestones are still open? → A: Yes, with an explicit confirmation that names the still-open milestones. On confirmation they stay visible as never completed — never auto-completed, deleted, or hidden. Declining changes nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Give a Bare Project Real Structure, Partially, Whenever (Priority: P1)

A project exists as nothing but a title — sort created it in two seconds during a fast inbox pass, which is exactly what sort is for. Later, when the user has a minute to actually think, they open that project and start shaping it: they write the outcome that says what done means. They stop there. Two days later they come back and add three milestones, each with the person who will confirm it is genuinely finished. The next day they name the next action and set the DRI. At no point were they asked to supply everything at once, and at no point did a half-filled project misbehave.

**Why this priority**: This is the feature. A project that cannot hold an outcome, milestones, a next action, and a DRI is just a folder with a name — the whole point is turning captured intent into something drivable. And it must be addable in pieces, because forcing full structure at creation time is what makes people stop using the tool during a fast sort. Structure that can only be entered all-at-once is structure that never gets entered.

**Independent Test**: Starting from a title-only project created by sort, add outcome alone and confirm it persists and nothing else was demanded. Then add milestones with verifiers, then a next action, then a DRI — each in a separate session — and confirm each partial state was valid, saved, and readable in a plain-text editor at every step.

**Acceptance Scenarios**:

1. **Given** a project that has only a title and a status, **When** the user opens it, **Then** its full structure is shown with outcome, milestones, next action, and DRI each visibly not yet set, and no error, warning-of-invalidity, or forced entry prompt appears.
2. **Given** a project with no outcome, **When** the user sets an outcome and nothing else, **Then** the outcome is saved, every other field is still empty, and the project remains usable.
3. **Given** a project with no milestones, **When** the user adds a milestone with its definition of done and its verifier, **Then** that milestone appears on the project as not yet done, and the user is not required to add a second one in the same action.
4. **Given** a project being structured, **When** the user names a verifier for a milestone, **Then** the verifier may be the user themselves and is recorded exactly as entered.
5. **Given** a project with structure already entered, **When** the user edits any single field — outcome, a milestone's definition of done, its verifier, the next action, the DRI, or the title — **Then** only that field changes and no other field is cleared, reordered, or required to be re-entered.
6. **Given** a project with an outcome, **When** the user clears the outcome back to empty, **Then** that is accepted as a valid partial state rather than rejected.
7. **Given** any edit is made, **When** the user leaves the project view or closes the application, **Then** the edit is already saved with no explicit save, commit, or confirm step.
8. **Given** a project is created during sort, **When** it is created, **Then** it has a title and a status and nothing else, and no outcome, milestone, next action, or DRI is requested.
9. **Given** a project with exactly one milestone, **When** the user views it, **Then** it is not flagged or warned about for having fewer than two, and the user may leave it that way indefinitely.
10. **Given** a project that already has four milestones, **When** the user tries to add a fifth, **Then** it is refused with an explanation that four is the cap, all four existing milestones are unchanged, and removing one first is the way forward.
11. **Given** a project with three items under `## Unprocessed` left by sort, **When** the user opens it to add structure, **Then** all three items are visible alongside the fields, and none is auto-filled into an outcome, milestone, or next action.
12. **Given** the user has read an unprocessed item and typed what it meant into a milestone, **When** they dismiss that item, **Then** it is removed from the project, the other two remain in order, and the dismissed item is still findable in the discard list.

---

### User Story 2 - Drive a Project to Done and Keep the Record (Priority: P2)

The user works a project over several weeks. As each milestone is genuinely finished — confirmed by whoever verifies it — they mark it done. It does not vanish: it stays on the project with the date it was completed, so the project reads as "two of four done" and the remaining two are obvious. When the last one is done, the user marks the project itself done. It drops out of the active list, its completion date is recorded, and months later they can still ask what got finished in March and get a real answer.

**Why this priority**: Structure without completion is a filing system. Marking progress is what makes a project drivable, and recording the dates is what makes finished work reviewable instead of merely gone. It ranks second only because there must be structure before there is anything to complete.

**Independent Test**: On a project with four milestones, mark two done and confirm both remain visible with their completion dates and the project reports two of four. Mark the remaining two, mark the project done, and confirm it leaves the active list, carries a completion date, and that all five dates are readable in a plain-text editor with no application running.

**Acceptance Scenarios**:

1. **Given** a project with four milestones and none done, **When** the user marks two of them done, **Then** both remain visible on the project, each shows the date it was completed, and the project reports two of four done.
2. **Given** a milestone is marked done, **When** the completion is recorded, **Then** the date is filled in automatically with no prompt for a date.
3. **Given** all milestones on a project are done, **When** the user marks the project done, **Then** the project's completion date is recorded and the project no longer appears in the active list.
4. **Given** a project has been marked done, **When** the user later views their projects, **Then** the done project is not shown among the active ones but its record — including its completion date and every milestone completion date — still exists and is retrievable.
5. **Given** projects and milestones completed across several months, **When** the user asks what was completed within any given date range, **Then** the answer is derivable from the stored data alone, with no application running and no separate history file to consult.
6. **Given** a milestone was marked done in error, **When** the user un-marks it, **Then** the milestone returns to not-done, its completion date is removed, and the project's progress count updates accordingly.
7. **Given** a project's status, **When** the user changes it, **Then** it may be set to exactly one of active, parked, waiting, or done, and the change takes effect immediately.
8. **Given** a done project, **When** the user sets its status back to active, **Then** it reappears in the active list, and its milestones' completion dates are left untouched.
9. **Given** a project with two of four milestones done, **When** the user marks the project done, **Then** the system names the two still-open milestones and asks for confirmation rather than refusing.
10. **Given** that confirmation is shown, **When** the user confirms, **Then** the project is marked done with its completion date, and the two open milestones remain visible on it as never completed with no completion date invented for them.
11. **Given** that confirmation is shown, **When** the user declines, **Then** the project's status is unchanged, no completion date is recorded, and no milestone is altered.
12. **Given** a project whose milestones are all done, or a project with no milestones at all, **When** the user marks it done, **Then** it is marked done immediately with no confirmation step.

---

### User Story 3 - See at a Glance Which Projects Still Need Structure (Priority: P3)

The user has eleven projects. Four of them are stubs sort dropped in last week and one has milestones but no next action, which is the sneaky one — it looks finished but cannot actually be worked. When they view their projects, all five are visibly flagged as needing structure, and the flag says nothing more than that. Nothing is blocked. They fix two, ignore the rest, and get on with their day.

**Why this priority**: The escape hatch that makes User Story 1 safe. If structure is never forced, half-defined projects will accumulate — the flag is what keeps that from happening silently. It is informational and derived, so it ranks below the ability to add structure and to complete work.

**Independent Test**: Create projects in each partial state — no outcome, no milestones, no next action, several missing at once, and one fully structured — then view the project list and confirm exactly the incomplete ones are flagged, the complete one is not, and every project can still be opened, edited, completed, and status-changed regardless of its flag.

**Acceptance Scenarios**:

1. **Given** a project with no outcome, **When** the user views their projects, **Then** that project is flagged as incomplete and needing structure.
2. **Given** a project with no milestones, **When** the user views their projects, **Then** it is flagged as incomplete.
3. **Given** a project with no next action, **When** the user views their projects, **Then** it is flagged as incomplete.
4. **Given** a project with an outcome, at least one milestone, and a next action, **When** the user views their projects, **Then** it is not flagged, whether or not it has a DRI.
5. **Given** a flagged project, **When** the user opens it, **Then** it states specifically which of outcome, milestones, and next action are missing rather than only that something is.
6. **Given** a flagged project, **When** the user edits it, marks a milestone done, or changes its status, **Then** every one of those operations succeeds exactly as it would for an unflagged project — the flag blocks nothing.
7. **Given** a flagged project, **When** the user supplies the last missing piece, **Then** the flag clears immediately with no separate action to dismiss it.
8. **Given** a mix of flagged and unflagged projects, **When** the project list is shown, **Then** the flagged ones are distinguishable at a glance without opening any of them.

---

### User Story 4 - Keep Areas Ongoing and Unstructured (Priority: P4)

The user's "Home maintenance" is not a project. It will never be done, it has no outcome, and pretending it needs four milestones would be a lie the tool tells them every time they open it. An area holds a title and a status, and it is never nagged for structure it is not supposed to have.

**Why this priority**: Small in scope but essential to the model's honesty — without it, every ongoing responsibility gets permanently flagged as incomplete and the flag becomes noise the user learns to ignore, which would undo User Story 3. It ranks last because areas already exist as titled containers; this story is mainly about what they must *not* acquire.

**Independent Test**: Create an area, confirm it accepts a title and a status and offers no outcome, milestone, next action, DRI, or completion affordance anywhere, and confirm it is never flagged as needing structure no matter how long it exists.

**Acceptance Scenarios**:

1. **Given** an area, **When** the user views it, **Then** it shows a title and a status and no outcome, milestones, next action, or DRI.
2. **Given** an area, **When** the user changes its status, **Then** exactly two choices are offered — active and parked — and neither done nor waiting appears anywhere.
3. **Given** an area with only a title, **When** the user views their areas, **Then** it is never flagged as incomplete or needing structure.
4. **Given** both projects and areas exist, **When** the user views them, **Then** projects and areas are distinguishable, and the structure and completion affordances appear only on projects.

---

### Edge Cases

- A project file was hand-edited to change the outcome while the project view was open, and the user then saves an outcome edit — the write is cancelled, the file is left untouched, and the project is re-presented as it now reads (FR-045b).
- A project file was hand-edited to change the DRI while the user was editing the outcome — the outcome write proceeds and the new DRI survives (FR-045c).
- Two different milestones on the same project are edited at once, one in the app and one in a text editor — neither cancels the other (FR-045d).
- The project file is deleted in a text editor while its view is open and the user then saves a field.
- A project file was hand-edited into a shape the system did not write — an unrecognized heading, a reordered section, a milestone written by hand in a slightly different form. Unrecognized content must survive untouched, and anything unparseable must read as "not set" rather than as an error or a reason to rewrite the file.
- A project still has items under `## Unprocessed` from sort while the user is adding structure — those items remain intact and are shown alongside the fields (FR-046a).
- The user dismisses an unprocessed item they never actually incorporated into any field — nothing checks that they did, and the item is recoverable from the discard list.
- The `## Unprocessed` section is emptied to nothing by dismissals, or the heading is removed by hand — neither is an error, and neither affects the structure flag (FR-046e).
- An unprocessed item spans multiple lines — dismissing it removes the whole item, not just its first line.
- A project is marked done while it still has unprocessed items or an empty outcome — neither triggers a confirmation; only open milestones do (FR-034a, FR-034e).
- A project is marked done with open milestones, then reopened and marked done again — the milestones that were never completed are still never completed, and the confirmation appears again.
- A project has one open milestone and the user deletes it rather than confirming past it — the completion then proceeds with no confirmation, and that milestone's record is gone by the user's own explicit act.
- A stub project with no milestones at all: "0 of 0 done" is a meaningless progress reading, so progress must not imply a project with no milestones is complete.
- The user adds a fifth milestone to a project that already has four — refused with an explanation, existing milestones untouched (FR-013).
- The user has exactly one milestone, below the stated minimum of two — accepted as an honest in-progress state, not flagged (FR-013a).
- A project file was hand-edited to hold six milestones — all six are shown and none is deleted; only adding a seventh through the application is refused (FR-013b).
- The user is at four milestones and wants a different fifth — deleting one first is the path, and the refusal message should not leave that unclear (FR-013).
- The user deletes a milestone that was already marked done, discarding its completion date.
- The user marks a project done, then reopens it (done → active), then completes it again on a different date.
- The system clock is wrong, or the user completes a milestone just after midnight, so the recorded date is not the day they feel they finished it.
- Two projects have the same title, or a project and an area share a title.
- A project's title is edited after creation, so the title no longer matches the filename derived from it during sort.
- The user asks for completed work in a date range that predates the feature, where projects finished before completion dates were ever recorded.
- An area file is hand-edited to contain milestones — the system must not start treating it as a project.
- An area file is hand-edited to `status: done` or `status: waiting` — the value is shown as recorded, not silently rewritten, and the application still offers only active and parked (FR-041c).

## Requirements *(mandatory)*

### Functional Requirements

#### Project fields

- **FR-001**: A project MUST be able to hold a title, an outcome, milestones, a single next action, a DRI, and a status.
- **FR-002**: A project's status MUST be exactly one of: active, parked, waiting, done.
- **FR-003**: A project MUST always have a non-empty title and exactly one status. These are the only two fields that are always present.
- **FR-004**: Every other field — outcome, milestones, next action, DRI — MUST be permitted to be absent. Absence is a valid state, not an error, and MUST NOT prevent any operation in this feature.
- **FR-005**: A newly created project MUST start with a title and a status of active and nothing else, and the system MUST NOT request or require any further field at creation. This preserves the sort-time behavior established in Feature 2.
- **FR-006**: The outcome MUST be free text stating what done actually means for that project. The system MUST NOT impose a format, template, or length on it.
- **FR-007**: A project MUST have at most one next action, recorded as free text.
- **FR-008**: A project MUST have at most one DRI, recorded as a person's name in free text. The DRI MAY be the user themselves, recorded the same way as anyone else.
- **FR-009**: A missing DRI MUST NOT contribute to the incomplete flag (FR-018).

#### Milestones

- **FR-010**: A milestone MUST hold its own definition of done, a verifier, a done/not-done state, and — once done — the date it was completed.
- **FR-011**: A milestone's definition of done MUST be free text describing what finishing it means. It MUST NOT be inferred from the project's outcome.
- **FR-012**: A milestone's verifier MUST be a person recorded as free text, and MAY be the user themselves.
- **FR-013**: A project MUST NOT hold more than four milestones. An attempt to add a fifth MUST be refused, with an explanation that a project is capped at four, and MUST leave the existing four unchanged.
- **FR-013a**: A project with exactly one milestone MUST be accepted as a valid state and MUST NOT be flagged, warned about, or otherwise reported as having too few. The minimum of two is a target the user works toward, not a rule the system enforces.
- **FR-013b**: If a project file already holds more than four milestones because the user wrote them by hand, the system MUST display all of them and MUST NOT delete, hide, or truncate any. It refuses only the act of adding another through the application.
- **FR-014**: A project MUST be permitted to have zero milestones. That state is flagged as incomplete (FR-018) but MUST NOT be blocked. Zero is the only milestone count that contributes to the flag.
- **FR-015**: Milestones MUST retain a stable order — the order in which the user entered them — and editing, completing, or un-completing a milestone MUST NOT reorder the others.
- **FR-016**: Users MUST be able to add a milestone, edit its definition of done, edit its verifier, and remove it.
- **FR-017**: The system MUST report a project's milestone progress as the number done out of the total (for example, "2 of 4 done"). A project with no milestones MUST NOT be reported as fully complete by that measure.

#### The incomplete flag

- **FR-018**: A project MUST be flagged as incomplete and needing structure when it is missing any of: an outcome, milestones, or a next action.
- **FR-019**: The flag MUST be purely informational. It MUST NOT block, gate, warn-on-exit, or otherwise interfere with viewing, editing, completing milestones, changing status, or marking the project done.
- **FR-020**: The flag MUST be derived from the project's current fields at the time it is read, never stored as its own separate state that could drift from the fields it describes.
- **FR-021**: A project's status MUST have no effect on whether it is flagged. A parked or done project missing an outcome is still missing an outcome.
- **FR-022**: When viewing a single project, the system MUST state specifically which of outcome, milestones, and next action are missing, not merely that the project is incomplete.
- **FR-023**: When the last missing element is supplied, the flag MUST clear with no separate dismiss, acknowledge, or re-validate action.
- **FR-024**: Areas MUST NEVER be flagged as incomplete or needing structure (FR-040).

#### Viewing and editing

- **FR-025**: Users MUST be able to view a single project showing its complete structure: title, outcome, every milestone with its definition of done, verifier, done state and completion date, next action, DRI, and status.
- **FR-026**: Fields that are not set MUST be shown as not yet set rather than hidden, so the user can see what is missing without consulting the flag.
- **FR-027**: Users MUST be able to edit any field individually without supplying, re-entering, or confirming any other field.
- **FR-028**: Users MUST be able to clear any optional field back to empty; the resulting partial state MUST be accepted.
- **FR-029**: Users MUST be able to change a project's status to any of the four values at any time, from any other value, including reversing a completion.
- **FR-030**: Every edit MUST persist immediately with no explicit save, commit, or confirm step, and MUST survive closing the application.
- **FR-031**: Users MUST be able to view their projects as a list showing, for each project, at minimum its title, its status, its milestone progress, and whether it is flagged as incomplete — without opening any of them.
- **FR-032**: The active list MUST exclude projects whose status is done and MUST include projects that are active, parked, or waiting, with their status visible.

#### Completion and dates

- **FR-033**: Marking a milestone done MUST record the date it was completed, filled in automatically with no prompt for a date.
- **FR-033a**: A completion date MUST be the calendar date in the user's local timezone at the moment the completion was recorded, at day granularity. The system MUST NOT record a time of day, and MUST NOT adjust a recorded date afterwards — a milestone completed at 00:30 on Tuesday is recorded as Tuesday, which is the day the user means.
- **FR-034**: Marking a project done MUST record its completion date the same way — filled in automatically, with no prompt for a date.
- **FR-034a**: If any milestone is still open when the user marks the project done, the system MUST name the still-open milestones and require an explicit confirmation before proceeding. It MUST NOT refuse the completion.
- **FR-034b**: On confirmation, the project MUST be marked done and the still-open milestones MUST remain visible on it as never completed, with no completion date. The system MUST NOT auto-complete, delete, hide, or alter them.
- **FR-034c**: If the user declines that confirmation, nothing MUST change — the status stays as it was and no completion date is recorded.
- **FR-034d**: When every milestone is already done, or the project has no milestones at all, marking it done MUST require no confirmation.
- **FR-034e**: The incomplete-structure flag (FR-018) MUST NOT trigger a confirmation or any other gate when marking a project done. A project missing its outcome or next action closes as freely as a fully structured one (FR-019).
- **FR-035**: A milestone marked done MUST remain visible on the project alongside the ones that remain, together with its completion date. It MUST NOT be hidden, collapsed away by default, moved to a separate list, or deleted.
- **FR-036**: Un-marking a done milestone MUST return it to not-done and remove its completion date. Reopening a done project MUST clear the project's completion date and MUST leave every milestone's completion date untouched.
- **FR-037**: Apart from explicitly reversing that completion (FR-036), no edit to any other field MUST alter or remove a recorded completion date. Editing a milestone's text or verifier after it is done MUST NOT reset its date.
- **FR-038**: Completion dates MUST be stored durably in plain text, such that every project and milestone completed within any given date range is derivable by reading the stored data alone — with no application running, and with no separate index or history file that could fall out of step with the projects themselves.
- **FR-039**: Re-completing a project that was reopened MUST record the new completion date, replacing the cleared one.

#### Areas

- **FR-040**: An area MUST hold a title and a status and nothing else. The system MUST NOT offer, request, store, or display an outcome, milestones, a next action, a DRI, or a completion date for an area.
- **FR-041**: An area's status MUST be exactly one of: active, parked. The system MUST NOT offer done or waiting as a choice for an area.
- **FR-041a**: An area MUST NOT be markable as done and MUST have no completion date, because an area is an ongoing responsibility with no end state.
- **FR-041b**: Users MUST be able to change an area's status between active and parked at any time.
- **FR-041c**: If an area's stored status is a value outside that set because the file was hand-edited, the system MUST show it as recorded and MUST NOT silently rewrite it. Changing it through the application offers active and parked only.
- **FR-042**: Projects and areas MUST be distinguishable when viewed, and the structure and completion affordances MUST appear only on projects.
- **FR-043**: If an area's stored file has been hand-edited to contain project-shaped structure, the system MUST continue to treat it as an area and MUST leave that content untouched rather than adopting or deleting it.

#### Storage and boundaries

- **FR-044**: All project and area structure — including completion dates — MUST be stored as human-readable, hand-editable plain text that the user can open, read, search, and edit with an ordinary text editor and no application running.
- **FR-045**: The system MUST read project and area files as they are found on disk. Content it does not recognize MUST be preserved verbatim, and a field that is absent or unparseable MUST read as not set rather than raising an error or triggering a rewrite of the file.
- **FR-045a**: Immediately before writing a field, the system MUST verify that the field's stored value still matches what the view was showing. It MUST NOT rely on a copy of the file read when the view opened.
- **FR-045b**: If that verification fails — the field was changed in a text editor while the view was open — the system MUST cancel the write, leave the file byte-for-byte unchanged, tell the user what the field now says, and re-present the project as it currently reads on disk.
- **FR-045c**: Changes to any other part of the file MUST NOT cancel the write. Unrelated hand-edits are preserved and folded into the view, so editing an outcome is not blocked by someone having changed the DRI.
- **FR-045d**: The unit of verification is the field being written. Each milestone is its own unit: writing to one milestone MUST NOT be cancelled by a hand-edit to a different one.
- **FR-045e**: A cancelled write MUST NOT be an error state, queued, retried, or held pending. The user re-decides against the field as it now reads.
- **FR-046**: The system MUST preserve any `## Unprocessed` section written by sort, along with every item in it, and MUST NOT delete, reorder, or reinterpret those items as a side effect of adding structure, completing a milestone, or changing status.
- **FR-046a**: The single-project view MUST show the items currently under `## Unprocessed`, alongside the project's structure, so the user can see the raw material while shaping the fields.
- **FR-046b**: Users MUST be able to dismiss an individual unprocessed item once they have handled it. Dismissing MUST remove only that item and MUST leave the remaining items in their existing order.
- **FR-046c**: The system MUST NOT convert, promote, or copy an unprocessed item into an outcome, milestone, next action, or DRI — automatically or on request. The user reads the item and types what they want into the field they want. Automatic conversion is deferred to a later feature.
- **FR-046d**: A dismissed item MUST be recorded in the existing plain-text discard list rather than deleted outright, preserving its text verbatim and its capture timestamp, matching how sort's trash destination already behaves.
- **FR-046e**: When the last item is dismissed, the empty `## Unprocessed` section MUST NOT be treated as an error, and its presence or absence MUST have no effect on the incomplete-structure flag (FR-018).
- **FR-047**: Every operation in this feature MUST work with no network connection available.
- **FR-048**: The system MUST NOT generate, suggest, pre-fill, or rank an outcome, milestone, next action, DRI, or verifier. Every value MUST originate from an explicit user entry.
- **FR-049**: This feature MUST NOT introduce a limit on how many projects may be active, a top-three selection, a weekly review ritual, or a programmatic interface for other clients — those belong to later features.

### Key Entities

- **Project**: A named container of work with a finite end state. Carries a title and a status always, and an outcome, milestones, a next action, and a DRI as the user supplies them. Any of those four may be absent at any time; the project reports itself as needing structure when the outcome, the milestones, or the next action is missing. Records its completion date when marked done. Extends — never replaces — the title-and-status stub that sort creates.
- **Milestone**: One verifiable step toward a project's outcome, belonging to exactly one project. Carries its own definition of done, a verifier who confirms it is genuinely complete, a done/not-done state, and a completion date once done. Stays visible on the project after completion so the finished and the remaining are seen together.
- **Outcome**: The statement of what done actually means for a project — the thing a milestone can be checked against. Free text, and absent until the user writes it.
- **Next Action**: The single next physical step on a project. Exactly one or none; a project with none cannot actually be worked, which is why its absence is flagged.
- **DRI**: The one person accountable for a project, possibly the user. Distinct from a verifier: the DRI drives the work, a verifier confirms a milestone is finished.
- **Verifier**: The person who confirms a specific milestone is actually complete, possibly the user. Belongs to a milestone, not to the project.
- **Status**: Which of active, parked, waiting, or done a project currently is; determines whether it appears in the active list. An area carries a status too, but only active or parked — it has no end state to reach and no deliverable to be blocked on.
- **Area**: A named container of ongoing responsibility with no end state — a title and a status only. Never has an outcome, milestones, a next action, a DRI, or a completion date, and is never flagged as needing structure.
- **Completion Date**: The date a milestone or a project was finished, recorded automatically at the moment it is marked done. Durable and stored with the thing it describes, so completed work can be reviewed over any time range without a separate history to keep in sync.
- **Structure Flag**: The derived signal that a project is missing its outcome, its milestones, or its next action. Computed on read from the fields themselves, never stored, and never a gate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can take a title-only project to fully structured — outcome, milestones with verifiers, next action, DRI — across at least four separate sessions, adding one field per session, with every intermediate state saved and valid and no session demanding a field the user did not choose to supply.
- **SC-002**: 100% of project and area structure, including every completion date, is readable and hand-editable by opening a plain-text file in an ordinary editor with no application running.
- **SC-003**: Adding structure to a project that contains items under `## Unprocessed` leaves every one of those items byte-for-byte unchanged unless the user explicitly dismissed it, and leaves any other content the system did not write byte-for-byte unchanged.
- **SC-003a**: Every dismissed unprocessed item is findable in the discard list with its original text and capture timestamp intact, in 100% of dismissals — and 0 items are converted into a field without the user typing them.
- **SC-004**: Given a mixed set of projects, the project list identifies exactly those missing an outcome, milestones, or a next action — no false flags on fully structured projects, and no missed flags — verified for every combination of the three missing elements.
- **SC-005**: A missing DRI produces no flag, in 100% of tested projects that are otherwise complete.
- **SC-006**: Every operation available on a fully structured project — open, edit any field, add or complete a milestone, change status, mark done — succeeds identically on a flagged project, with 0 operations blocked, gated, or delayed by a confirmation the unflagged project does not also require.
- **SC-007**: A user can tell which projects need attention by looking at the project list alone, without opening any project, in a set of at least ten projects.
- **SC-008**: On a project with four milestones and two done, the project reports two of four done, and both completed milestones remain visible alongside both remaining ones — never hidden, moved, or removed.
- **SC-008a**: A project accepts its first, second, third, and fourth milestone without objection, refuses the fifth with an explanation, and is flagged for milestone count only when it has zero — verified at every count from 0 through 5.
- **SC-009**: Marking a milestone done, or marking a project done whose milestones are all complete, requires exactly one user input — the mark itself — and never prompts for a date.
- **SC-009a**: Marking a project done with open milestones adds exactly one input — a confirmation naming those milestones — and is never refused. Declining leaves the project and every milestone byte-for-byte unchanged; confirming leaves the open milestones open, with 0 dates invented for them.
- **SC-010**: After completing milestones and projects across at least three distinct months, a query for any date range returns exactly the completions that fall inside it, derived from the stored files alone with no application running and no separate history file.
- **SC-011**: Editing any field of a completed milestone or project leaves its recorded completion date unchanged, in 100% of tested edits that are not an explicit reversal of that completion.
- **SC-012**: A project marked done disappears from the active list immediately, and reappears immediately when its status is set back to active, with its milestone completion dates intact in both directions.
- **SC-013**: Areas offer no outcome, milestone, next action, DRI, or completion affordance at any point, offer exactly two statuses (active and parked), and are never flagged — verified across every area view and edit path.
- **SC-014**: A project file hand-edited in a text editor — fields removed, reordered, or written in an unexpected shape — opens without error, shows absent fields as not set, and loses no content the system did not write.
- **SC-014a**: In tests where a project file is edited in a text editor mid-session, 0 writes are made from stale state: every write to a field that changed on disk is cancelled with the file left byte-for-byte unchanged and the user told what it now says, and every write to a field that did not change succeeds while preserving the unrelated edit.
- **SC-015**: Every structure operation completes with no network connection available, in 100% of tested offline sessions.
- **SC-016**: 100% of stored outcomes, milestones, next actions, DRIs, and verifiers are traceable to an explicit user entry; no generated, suggested, or pre-filled value appears at any point in testing.
- **SC-017**: The project list — every project's status, milestone progress, and structure flag — is available within 100 milliseconds for a vault of 100 projects, so seeing what needs attention never becomes a reason to cache what the files already say.

## Assumptions

- **Feature 2's stub is the starting point, and this feature extends it rather than replacing it.** A project file already carries a title (`#` heading), `status: active`, and possibly an `## Unprocessed` section. Outcome, milestones, next action, and DRI are added as siblings; nothing sort wrote is renamed, reordered, or absorbed. This was the explicit contract set in `specs/002-inbox-view-sort/contracts/vault-format.md`.
- **One file per project and per area**, following the existing data model (`projects/<slug>.md`, `areas/<slug>.md`). Completion dates live inside those files, which is what makes FR-038's date-range review possible without a separate index — the set of project files *is* the history.
- **The "active list" means every project whose status is not done**, so parked and waiting projects stay visible with their status shown rather than disappearing. Only done removes a project from view. Hiding parked work would recreate the half-defined-and-forgotten problem the structure flag exists to prevent.
- **Done projects are not moved, archived, or deleted.** Their files stay where they are; status alone determines list membership. Nothing in this feature deletes a project or an area.
- **Areas carry the statuses active and parked only.** Done is excluded by definition (FR-041a), and waiting describes work blocked on another person's deliverable, which an ongoing responsibility does not have. Two states — tending it, or set aside — is the smallest set that stays honest, and it means the status field on an area never implies an end state it cannot have.
- **The status value `waiting` on a project is distinct from the waiting-for list Feature 2 writes to `waiting.md`.** One is a project's state, the other is a delegated item. They are deliberately not linked in this feature, and the shared word is noted here so a later feature does not conflate them.
- **Completion dates are calendar dates (`YYYY-MM-DD`) in the user's local timezone** (FR-033a), matching how `waiting.md`, `calendar.md`, and `trash.md` already record dates. Date-level granularity is enough to review completed work over a range, and a wall-clock date is what the user means by "the day I finished it." A wrong system clock therefore records a wrong date, which the user can correct by editing the file — the same exposure every date in the vault already has.
- **Dismissing an unprocessed item is a soft delete**, appended to the existing `trash.md` discard list rather than removed outright. This follows the decision Feature 2 already recorded: a captured thought is never destroyed by a single click. The user has usually already retyped the item into a field by then, so the discard line is harmless noise — whereas losing a thought they only *thought* they had transferred is not recoverable. No in-application restore is provided; recovery is by hand-editing, exactly as in Feature 2.
- **Draining `## Unprocessed` is closed as a loop, not automated.** ROADMAP.md assigns Feature 3 the job of turning sort's raw items into structure; this feature satisfies that by putting the items in front of the user while they type and letting them clear each one, and deliberately stops short of a promote-to-milestone converter. Reading an item and deciding what it means is the thinking the structure is for; a converter would mostly move text.
- **The milestone cap is enforced, the floor is not.** Four is where the scope-creep discipline actually lives, so the core refuses a fifth (Principle V). One milestone is just a project mid-typing, so nothing objects to it. Zero remains the only count that flags, which keeps the structure flag meaning "nothing here yet" rather than "not shaped the way we prefer."
- **"Done" is your claim; the system makes sure you meant it.** A hard refusal on open milestones would be routed around by deleting the milestone, which destroys its record — so the confirmation is the honest version of the same guardrail. A project that closes with a milestone that stopped mattering keeps that fact visible, which is more truthful than a project whose history was edited to look tidy.
- **A verifier and a DRI are free-text names, not records in a contact system.** There is no person entity, no validation, and no linkage between a verifier named on one project and the same name on another. "Me" is written the same as any other name.
- **Titles are not unique keys.** Two projects may share a title; they remain distinct projects. Editing a title changes the heading in the file and does not rename the file, so the sort-time slug may drift from the title — an accepted consequence of the existing filename rule rather than something this feature repairs.
- **Milestone deletion discards its completion date along with it.** Deleting a done milestone is an explicit destructive edit of that milestone, not a violation of FR-037's durability guarantee, which protects dates against incidental edits rather than against deliberate removal.
- **Projects completed before this feature existed have no completion date** and will not appear in date-range results. There is no backfill, and no date is fabricated for them — the same principle Feature 2 applied to hand-written items with no capture timestamp.
- **The single-project view re-reads from disk when opened and writes only the field being edited**, verifying that one field against disk immediately before writing (FR-045a). This is Feature 2's verify-before-write precedent narrowed from a whole item to a single field: a project holds many independent fields, so cancelling an outcome edit because the DRI changed would be a refusal the user cannot act on. Field-level granularity keeps the guarantee where it matters — never overwriting a hand-edit the user made deliberately — without inventing conflicts.
- Explicitly out of scope and deferred: the top-three / WIP limit (Feature 4), the weekly review ritual (Feature 5), the local HTTP/JSON API (Feature 7), and any AI-assisted structuring, splitting, or suggestion (Feature 8) — including automatic conversion of an unprocessed item into a milestone or next action (FR-046c).
