# Feature Specification: Inbox View & Sort

**Feature Branch**: `002-inbox-view-sort`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "I want an inbox view and sort feature. It shows me each captured item in my inbox one at a time, in the order they were captured, and lets me decide where it goes before moving to the next one.

For each item, I choose one of five destinations: an existing project, an existing area, the waiting-for list, trash, or calendar. If I choose project or area and the one I want doesn't exist yet, I can create it on the spot with just a title — it doesn't need full details yet, those come later. If I choose waiting-for, I record who it's waiting on and today's date, so staleness can be tracked later. If I choose trash, the item is discarded. If I choose calendar, the item is flagged as needing a calendar entry — this feature does not integrate with an actual calendar, it just marks the item as belonging there for now.

Once I've made a decision for an item, it's removed from the inbox and placed in its destination immediately — I don't have to sort the whole inbox in one sitting, and progress is saved as I go.

When there are no items left, the inbox is empty, which is the state my weekly review depends on.

This feature does not include the full project structure — outcome, milestones, next action, DRI — that's a later feature. It also does not include any AI-assisted or automatic sorting suggestions — every decision here is made by me, manually. This feature is sort only, one item at a time, five destinations, done."

## Clarifications

### Session 2026-08-11

- Q: When an item is sent to trash, is its text recoverable or gone for good? → A: Soft delete — the item is appended to a plain-text discard list and removed from the inbox; recoverable by hand, with no automatic purge in this feature.
- Q: Should hand-written lines in the inbox that don't match the capture format be presented as sortable items? → A: Yes — any line containing text is a sortable item, shown without a timestamp, and counts toward inbox zero. Blank lines are not items.
- Q: Where do calendar-flagged items go, given the roadmap has no calendar file? → A: A dedicated append-only `calendar.md` list holding the capture timestamp, the item text, and the date it was flagged — the flag date recorded automatically with no prompt, so a later feature can detect items left unscheduled too long.
- Q: What happens if the inbox is hand-edited while the sort view is open and the item on screen no longer matches disk? → A: Verify the item is unchanged on disk immediately before writing; on any mismatch, cancel that decision, report why, and re-present from the current file. Never write from stale state.
- Q: Where inside a project or area file does a routed item land? → A: Under a fixed `## Unprocessed` heading, as a list entry with its capture timestamp — explicitly marking it as raw material still awaiting the structure Feature 3 adds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sort One Item at a Time to an Existing Destination (Priority: P1)

A user opens their inbox to process what they captured. The oldest unsorted item is shown on its own — full text, and when it was captured — with nothing else competing for attention. The user picks one of five destinations: an existing project, an existing area, the waiting-for list, trash, or calendar. The moment they decide, that item leaves the inbox and lands in its destination, and the next-oldest item takes its place. They keep going until they stop or run out.

**Why this priority**: This is the feature. Everything else is a branch off this loop. Without one-at-a-time routing to destinations that already exist, there is no way to move a captured thought out of the inbox at all, and the inbox-zero state that the weekly review depends on is unreachable.

**Independent Test**: With an inbox containing several captured items and at least one existing project and one existing area, walk the inbox and route items to each of the five destinations. Verify each item appears in its destination and disappears from the inbox, in capture order, with no destination creation involved.

**Acceptance Scenarios**:

1. **Given** an inbox with three captured items, **When** the user opens the inbox view, **Then** exactly one item is shown — the oldest by capture time — with its full text and capture timestamp.
2. **Given** an item is shown, **When** the user views the available choices, **Then** exactly five destinations are offered: project, area, waiting-for, trash, and calendar.
3. **Given** an item is shown and at least one project exists, **When** the user routes it to that project, **Then** the item appears under that project's `## Unprocessed` section with its capture timestamp, is no longer in the inbox, and the next-oldest item is shown.
4. **Given** an item is shown, **When** the user routes it to waiting-for and names who it is waiting on, **Then** a waiting-for entry is recorded with the item text, that person, and today's date.
5. **Given** an item is shown, **When** the user routes it to calendar, **Then** the item is recorded in the calendar list with its text, its capture timestamp, and today's date as the flag date — with no prompt for a date or time — and no external calendar system is contacted or written to.
6. **Given** an item is shown, **When** the user routes it to trash, **Then** the item is no longer in the inbox and does not appear in any active destination, but its text and capture timestamp are still findable in the discard list.
7. **Given** an item is shown, **When** the user has not chosen a destination, **Then** the next item is not shown and the current item remains the one under decision.
8. **Given** an item spans multiple lines (a long dictated thought), **When** it is shown and then routed, **Then** the entire item — every line of it — moves to the destination as one item, with its text unchanged.

---

### User Story 2 - Create a Project or Area on the Spot (Priority: P2)

Mid-sort, the user hits an item that clearly belongs to a project or area that doesn't exist yet. Rather than abandoning the sort to go set one up, they create it right there by typing a title — nothing else. The new project or area exists immediately, the item lands in it, and the sort continues without a detour.

**Why this priority**: Without this, a sort session stalls the first time reality outruns the existing structure, and the user is pushed to either mis-file the item or quit. It is additive to User Story 1 — sorting works without it whenever a suitable destination already exists — so it ranks second.

**Independent Test**: With an inbox item and no matching project, create a project during sort by supplying only a title, and confirm the project now exists, the item is in it, and at no point was any other field requested.

**Acceptance Scenarios**:

1. **Given** an item is being routed to a project and no suitable project exists, **When** the user chooses to create one and supplies a title, **Then** the project is created with that title alone and the item is placed in it in the same action.
2. **Given** the user is creating a project or area during sort, **When** the creation form is presented, **Then** no outcome, milestone, next action, DRI, status, or any other field beyond the title is requested or required.
3. **Given** the user is creating a project or area, **When** they supply an empty or whitespace-only title, **Then** nothing is created, the item stays in the inbox, and the user can correct the title or choose a different destination.
4. **Given** a project titled "Roof repair" already exists, **When** the user creates a project with that same title, **Then** the existing project is used rather than a second one with a duplicate title being created.
5. **Given** a project or area was created during a sort session, **When** the user reaches a later item, **Then** that newly created destination appears among the existing choices for that item.

---

### User Story 3 - Stop Anytime, Resume Where You Left Off, Reach Inbox Zero (Priority: P3)

The user has fifteen minutes, not an hour. They sort six items, close the app, and come back later. The six are still where they put them, and the seventh — the oldest of what's left — is waiting. When the last item is decided, the inbox is empty, and that emptiness is a state the rest of the system can rely on.

**Why this priority**: Sorting is only trustworthy if partial work survives. This falls out of the per-item immediacy in User Story 1, so it is verified rather than built separately — but it is what makes inbox zero reachable in real life rather than only in one long sitting.

**Independent Test**: Sort part of an inbox, quit the application entirely, reopen it, and confirm the sorted items are in their destinations, the remaining items are intact and still in capture order, and sorting resumes at the oldest remaining item. Continue to the end and confirm the empty state.

**Acceptance Scenarios**:

1. **Given** the user has sorted several items, **When** they exit the sort session or close the application, **Then** every decision already made remains in effect with no confirmation or save step required.
2. **Given** a partially sorted inbox, **When** the user reopens the inbox view, **Then** the oldest remaining unsorted item is shown and previously sorted items are not shown again.
3. **Given** the last remaining item is decided, **When** the decision completes, **Then** the inbox contains no unsorted items and an empty state is shown.
4. **Given** the inbox is empty, **When** the user opens the inbox view, **Then** the empty state is shown immediately and no destination choices are offered.
5. **Given** the inbox is empty, **When** another part of the system asks whether the inbox is at zero, **Then** the answer is yes and is derivable from the stored data alone, with no sort session in progress.

---

### Edge Cases

- The inbox is already empty when the user opens the view — the empty state is shown rather than an error or a blank prompt (US3 AS4).
- The inbox file does not exist yet (nothing has ever been captured) — treated as an empty inbox, not a failure.
- The inbox file contains lines that are not well-formed captured items, because the user hand-edited it — each such line with text becomes a sortable item shown without a timestamp; blank lines are ignored (FR-027 through FR-027d).
- The user has hand-organized the inbox with markdown headings — those headings are presented as items to route, since sort cannot distinguish a heading the user wants kept from a thought they typed without a timestamp.
- A hand-written entry spans several lines — indented continuation lines group with the line above, matching the capture grammar; consecutive unindented lines are separate items.
- The user hand-edits or deletes the inbox file in a text editor while a sort session is open, so the item on screen no longer exists on disk — the decision is cancelled and the inbox re-presented rather than written from stale state (FR-020a, FR-020b).
- The inbox file is deleted entirely mid-session — treated as an empty inbox on the next verification, with no decision written.
- A decision is interrupted partway — power loss, crash, or force-quit between writing to the destination and removing from the inbox (FR-016).
- The user routes an item to waiting-for but leaves the "who" blank.
- The user creates a project whose title contains characters that cannot be used in a filename, or whose title differs from an existing one only by case or surrounding whitespace.
- Two inbox items have identical text and the same capture timestamp — both must be sortable independently, and sorting one must not remove the other.
- A single item is an extremely long dictated stream containing several unrelated thoughts — it is one item and is routed as one item; splitting it is explicitly out of scope (Feature 7).
- The destination store (a project file, the waiting-for list) has been hand-edited into an unexpected shape before the sort writes to it.
- The user chooses a project or area that existed when the session started but was deleted on disk before the decision was made — the decision is cancelled and reported, not silently recreated (FR-020c).

## Requirements *(mandatory)*

### Functional Requirements

#### Presenting items

- **FR-001**: The system MUST present unsorted inbox items one at a time, in the order they were captured, oldest first.
- **FR-002**: The system MUST NOT advance to the next item until a destination decision has been completed for the current item. The user MAY end the sort session at any point without deciding.
- **FR-003**: The system MUST show the item's complete text — including every continuation line of a multi-line item — together with the time it was captured, where the item has one (see FR-027a).
- **FR-004**: The system MUST NOT display more than one unsorted item at a time during sort.

#### Destinations

- **FR-005**: The system MUST offer exactly five destinations for every item: an existing project, an existing area, the waiting-for list, trash, and calendar.
- **FR-006**: The system MUST let the user choose from the projects that currently exist.
- **FR-007**: The system MUST let the user choose from the areas that currently exist.
- **FR-008**: When routing to a project or area, the system MUST allow the user to create a new one without leaving the sort, supplying only a title.
- **FR-009**: The system MUST NOT request or require any field other than a title when creating a project or area during sort — specifically not outcome, milestones, next action, DRI, or status.
- **FR-010**: A project or area created during sort MUST be usable as the destination for the current item in the same action, and MUST appear among the existing choices for all subsequent items.
- **FR-011**: The system MUST reject an empty or whitespace-only title, creating nothing and leaving the current item unsorted and still under decision.
- **FR-012**: If the supplied title matches an existing project or area (ignoring surrounding whitespace and letter case), the system MUST route the item to that existing destination rather than creating a duplicate.
- **FR-013**: When routing to waiting-for, the system MUST record who the item is waiting on and the current date alongside the item text.
- **FR-014**: The system MUST require a non-empty value for who the item is waiting on; an empty value leaves the item unsorted and still under decision.
- **FR-015**: The waiting-for entry MUST store the date in a form that lets a later feature compute how long the item has been waiting, without that later feature needing to re-derive it from anywhere else.
- **FR-016**: When routing to trash, the system MUST remove the item from the inbox and record it in a plain-text discard list, preserving its text verbatim and its capture timestamp. It MUST NOT be deleted outright, and MUST NOT appear in any project, area, waiting-for, or calendar destination.
- **FR-016a**: The discard list MUST be append-only within this feature — no automatic purge, expiry, or size limit. Recovering a discarded item is done by hand-editing the plain-text files; no in-application restore is provided.
- **FR-017**: When routing to calendar, the system MUST record the item in a dedicated calendar list, preserving its text verbatim and its capture timestamp, and MUST NOT read from, write to, or otherwise contact any external or system calendar.
- **FR-017a**: The system MUST also record the date the item was flagged, filled in automatically. The user MUST NOT be prompted for it, nor for any date, time, or duration for the eventual calendar entry.
- **FR-018**: Calendar-flagged items MUST remain identifiable as a distinct set, so a later feature can act on them without re-deriving which items were flagged.
- **FR-018a**: The flag date MUST be stored in a form that lets a later feature compute how long an item has sat unscheduled, without re-deriving it from elsewhere.

#### Moving the item

- **FR-019**: On a completed decision, the system MUST place the item in its destination and remove it from the inbox before the next item is presented. No separate save, commit, or confirm step may be required.
- **FR-020**: The system MUST NOT lose an item if a decision is interrupted partway. If the destination write and the inbox removal cannot both complete, the item MUST remain in the inbox — an item appearing twice is a recoverable outcome, an item vanishing is not.
- **FR-019a**: An item routed to a project or area MUST be appended under a dedicated `## Unprocessed` section within that destination's file, as a list entry carrying its text and its capture timestamp. The section MUST be created if absent, and MUST NOT be renamed, reordered, or merged into any other section by this feature.
- **FR-019b**: The system MUST NOT write a routed item into any other section of a project or area file, and MUST leave all existing content in that file — including structure a later feature or the user added — untouched.
- **FR-020d**: A decision interrupted partway MUST be completed automatically the next time the application starts, leaving the item in exactly one place. A duplicate is therefore transient — visible only between the interruption and the next launch — rather than a permanent state the user must notice and repair by hand.
- **FR-020e**: Removing an item from the inbox MUST NOT discard anything captured while the removal was in progress. A capture that lands during a sort decision MUST survive that decision.
- **FR-020a**: Immediately before writing a decision, the system MUST verify that the item it is about to move is still present in the inbox, unchanged, exactly as it was shown. It MUST NOT rely on a copy read earlier in the session.
- **FR-020b**: If that verification fails — the item was reworded, moved, or deleted in a text editor while the view was open — the system MUST cancel the decision without writing anything anywhere, tell the user what changed, and re-present the inbox as it now stands. A cancelled decision MUST leave every file exactly as it found them.
- **FR-020c**: If the chosen project or area no longer exists on disk at the moment of the write, the system MUST likewise cancel and report rather than silently recreating a destination the user deliberately removed. The user may then choose again or recreate it explicitly.
- **FR-021**: The system MUST preserve the item's captured text verbatim when moving it — no reformatting, re-wrapping, capitalization, or punctuation changes.
- **FR-022**: The system MUST preserve the item's original capture timestamp in its destination, so when the thought was captured is not lost by sorting it. An item that never had one is recorded without it rather than with a substituted date.
- **FR-023**: The system MUST NOT alter, reorder, or reformat inbox items other than the one being sorted.

#### Session and end state

- **FR-024**: Decisions MUST persist without an explicit save; ending a session, closing the application, or losing power after a completed decision MUST NOT undo it.
- **FR-025**: On resuming, the system MUST present the oldest remaining unsorted item, and MUST NOT re-present items already sorted.
- **FR-026**: When no unsorted items remain, the system MUST show an empty state and offer no destination choices.
- **FR-027**: The system MUST present inbox content that is not a well-formed captured item but contains text — a hand-written note, a heading, a stray paragraph — as a sortable item, routable to all five destinations exactly like a captured item.
- **FR-027a**: A hand-written item MUST be shown and stored without a capture timestamp. The system MUST NOT fabricate one, and MUST NOT rewrite the line into the capture format.
- **FR-027b**: Blank and whitespace-only lines MUST NOT be presented as items and MUST NOT prevent the inbox from being empty.
- **FR-027c**: Hand-written items MUST count toward whether the inbox is at zero (FR-028). The inbox is empty only when no routable text of any kind remains.
- **FR-027d**: Until it is sorted, every unsorted line MUST remain byte-for-byte untouched.
- **FR-028**: Whether the inbox is at zero MUST be determinable from the stored data alone, with no sort session running, so the weekly review can depend on it.

#### Boundaries

- **FR-029**: All destinations — projects, areas, waiting-for, calendar-flagged items, and the discard list — MUST be stored as human-readable plain text that the user can open, read, search, and edit with an ordinary text editor and no application running.
- **FR-030**: The system MUST NOT offer, generate, rank, or pre-select any suggested destination. Every routing decision MUST originate from an explicit user choice.
- **FR-031**: The system MUST function with no network connection; no destination, lookup, or decision may depend on a remote service.
- **FR-032**: The system MUST NOT provide editing of an item's text, reordering of the inbox, bulk or multi-item actions, or undo of a completed sort decision as part of this feature.

### Key Entities

- **Inbox Item**: One unsorted thought awaiting a decision — its raw text (possibly multi-line) and, if it came from capture, the time it was captured. A line the user typed into the inbox by hand is equally an item, just without a timestamp. Ordered by position in the inbox. Ceases to be an inbox item the moment it is routed.
- **Project**: A named container with a finite end state. In this feature it has a title and an `## Unprocessed` section holding routed items; its full structure (outcome, milestones, next action, DRI, status) belongs to a later feature, which adds it alongside — never on top of — what sort wrote.
- **Area**: A named container of ongoing responsibility with no end state. Same shape as a project in this feature: a title and an `## Unprocessed` section.
- **Waiting-For Entry**: A routed item that someone else owes — the item text, the person it is waiting on, and the date it started waiting. The date exists so staleness can be judged later.
- **Discarded Item**: A routed item the user rejected — its text and capture timestamp, kept in a plain-text discard list. Out of the inbox and out of every active destination, but not destroyed; it exists so a mis-click during a fast sort is survivable.
- **Calendar-Flagged Item**: A routed item marked as belonging on a calendar — its text, its capture timestamp, and the date it was flagged. It names no event date, time, or duration and is synchronized with nothing; the flag date exists only so a later feature can tell how long it has gone unscheduled.
- **Sort Position**: Which item is next. Derived from what remains in the inbox rather than tracked separately, so quitting and resuming needs no saved cursor and a hand-edit to the inbox cannot desynchronize it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can take an inbox of 20 captured items to zero in a single session, routing each to any of the five destinations, with no step that asks for anything beyond the destination and (where required) a title or a name.
- **SC-002**: Each routing decision requires at most two inputs from the user — the destination, plus one detail for waiting-for or a newly created project/area.
- **SC-003**: 100% of sorted items are findable in their destination by opening a plain-text file in an ordinary editor with no application running.
- **SC-003a**: In a project or area file that already contains hand-written or Feature 3 structure, routing an item adds it under `## Unprocessed` and leaves every other line byte-for-byte unchanged.
- **SC-004**: After quitting mid-session and reopening, 100% of decisions already made are still in effect and 0 unsorted items are lost, duplicated, or reordered.
- **SC-002a**: After a decision is committed, the next item appears within 100 milliseconds — the sort loop keeps the same rhythm as capture, with the durability write inside that budget rather than deferred.
- **SC-005a**: Captures made while a sort decision is in progress survive it — across repeated interleaving tests, 0 captured items are lost to a concurrent sort.
- **SC-004a**: In tests where the inbox is edited in a text editor mid-session, 0 decisions are written from stale state — every affected decision is cancelled with all files left byte-for-byte unchanged, and the user is told what changed.
- **SC-005**: Across repeated interruption tests — including force-quit between the destination write and the inbox removal — 0 items are lost. Any item that survives twice remains visible in the inbox and can be sorted again.
- **SC-006**: Creating a new project or area mid-sort adds exactly one input (the title) to that item's decision and never leaves the sort flow.
- **SC-007**: 100% of destination assignments are traceable to an explicit user choice; no suggested, defaulted, or pre-selected destination appears at any point in testing.
- **SC-008**: Every sort operation completes with no network connection available, in 100% of tested offline sessions.
- **SC-009**: When the last item is decided, the inbox-is-empty state is observable both in the interface and by inspecting the stored data directly. An inbox containing only blank lines reports empty; an inbox containing any routable text does not.
- **SC-009a**: An inbox assembled entirely by hand in a text editor, with no item written by capture, can be sorted to zero using the same flow — verified on a file with no timestamps in it at all.
- **SC-010**: 100% of items sent to trash remain findable by opening the discard list in a plain-text editor, with their original text and capture timestamp intact.
- **SC-011**: Every waiting-for entry created by sort carries a person and a date, and every calendar-flagged item carries a flag date, enabling a later staleness check on both with no further user input — verified on 100% of entries.

## Assumptions

- **Single user, single device.** There is one inbox and one set of destinations, with no sharing, permissions, or concurrent sorters to reconcile. Only the user's own text editor competes for the files.
- **Capture order is file order.** Items are presented top-to-bottom in the order they appear in `inbox.md`, which for captured items is oldest-first. File order — not timestamp order — is authoritative, because hand-written items have no timestamp to sort by and the user's editor shows them in file order regardless.
- **A hand-written item is a first-class item.** It carries text and nothing else. Rather than inventing a timestamp so it fits the capture grammar, the system records it in its destination with text alone; a later feature that needs a date will find its absence honest and obvious.
- **Routed items keep the capture grammar.** An item written into a project, area, waiting-for, or calendar destination keeps its capture timestamp and verbatim text in the same plain-text shape Feature 1 established, so the same thought is recognizable wherever it lands.
- **Projects and areas are one file each**, following the roadmap's data model (`projects/<slug>.md`, `areas/<slug>.md`). Creating one during sort produces a file with its title and an `## Unprocessed` section containing the routed item. Feature 3 adds outcome, milestones, next action, DRI, and status as sibling sections, and is expected to drain `## Unprocessed` as it turns raw items into structure — this feature only fills that section, never interprets it.
- **Waiting-for is a single shared list** (`waiting.md` per the roadmap), not a per-project one. The roadmap's 7-day staleness threshold is Feature 5's to enforce; this feature only guarantees the date is recorded.
- **Calendar-flagged items go to a dedicated append-only `calendar.md`**, parallel to `waiting.md`. No calendar file existed in the roadmap's data model before this feature; sort establishes one as a staging list for whichever later feature does the integration, and the roadmap now records it. It deliberately mirrors waiting-for's shape — text plus a date that starts a clock — because "flagged but never scheduled" is the same staleness problem as "delegated but never returned", and a later feature should be able to check both the same way.
- **Destination-write-then-inbox-removal** is the ordering used to satisfy FR-020. The failure mode is therefore a duplicate, which the user can see and fix, rather than a silent loss, which they cannot.
- **Titles are matched loosely, stored faithfully.** Duplicate detection (FR-012) ignores case and surrounding whitespace, but a created project keeps the title exactly as typed. Deriving a filename from a title is an implementation concern for planning.
- **The inbox is re-read from disk when the view opens** and re-verified immediately before every write, so a hand-edit is respected whether it happens between sessions or during one. This follows the precedent Feature 1 set with undo: verify the file still matches, and refuse on mismatch rather than acting on bytes the system cannot account for. Refusing a decision is a recoverable annoyance; writing the wrong text into a project is not.
- **A cancelled decision is not an error state.** The user re-decides on the item as it now reads. Nothing is queued, retried, or held pending.
- **The discard list is a durable artifact this feature introduced**, absent from the roadmap's data model until sort added it as the soft-delete target and the roadmap was updated to match. It grows without bound; pruning it is a deliberate non-goal here rather than an oversight, and a later feature may add retention if the file ever becomes a nuisance.
- **No undo.** A sort decision is final within this feature; correcting a mis-file means hand-editing the destination files, which the plain-text format supports. Soft-deleting to the discard list is what keeps the trash choice from being the one irreversible action in an otherwise recoverable flow. An undo affordance would need a decision history this feature does not otherwise require.
- **Feature 1 (quick capture) is the only producer of inbox items**, and its inbox file format is treated as an input contract to this feature.
- Explicitly out of scope and deferred: full project structure (Feature 3), WIP limits (Feature 4), the weekly review ritual that consumes inbox zero (Feature 5), and any AI-assisted splitting or suggestion of destinations (Feature 7).
