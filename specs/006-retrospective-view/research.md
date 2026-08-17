# Phase 0 Research: Retrospective View

**Feature**: 006-retrospective-view | **Date**: 2026-08-16 | **Plan**: [plan.md](./plan.md)

Every decision below was reached by reading the shipped code rather than by reasoning about what it probably
does. Where a decision turns on an existing signature, that signature is quoted.

---

## R1 — What the retrospective depends on, and how "never writes" becomes a type

**Decision**: `RetrospectiveService` takes narrowed dependencies, so that no write verb is reachable from it:

```ts
export interface RetrospectiveServiceDeps {
  projects: Pick<ProjectService, "listDetailed">;
  weeks: Pick<TopThreeService, "history">;
  vault: Pick<VaultStore, "list" | "read">;
  clock?: Clock;
}
```

**Rationale**: FR-051 says the retrospective must never create, modify, or delete anything, and SC-004 asserts
the data directory is byte-for-byte identical before and after every operation. A service holding a full
`ProjectService` could call `complete()`; one holding a full `VaultStore` could call `write()`. Neither would
be caught by a type checker, so the guarantee would rest on nobody making a mistake for the life of the
module.

`Pick<>` makes it structural instead. `this.vault.write` does not typecheck, so the byte-for-byte test becomes
a regression net for a property the compiler already enforces rather than the only thing standing between the
feature and a stray write. This is the same move Feature 5 made deliberately with `SummaryProvider.draft`,
which takes a `ReviewRecord` rather than a `VaultStore` so that the privacy boundary is "a type rather than a
rule someone has to remember" (005 plan, post-design re-check).

It also keeps the dependency list honest about what is actually read: three sources, no policy module, no
clock beyond "what is today" for nothing at all in the current design — see R11.

**Alternatives considered**:

- **Full `ProjectService` / `TopThreeService` / `VaultStore`.** Simplest wiring, no type gymnastics, and the
  established habit elsewhere in the repo. Rejected because every other service in this repo *writes*; this is
  the first that must not, and the one place where narrowing buys something real.
- **A bespoke read port** (`interface RetrospectiveSources { projects(): Promise<Project[]>; … }`) implemented
  by an adapter. Rejected: it would need an implementation somewhere, and that implementation would either
  duplicate `listDetailed`'s single-pass read or wrap it — a layer whose only content is delegation.
- **Reading every file through `VaultStore` directly, parsing with the exported document functions.** Rejected
  for projects specifically: `readAll` + `resolutionContext` is private inside `ProjectService`, and
  reimplementing "read every project once" outside it is the quadratic path `listDetailed` exists to prevent
  (003 FR-031, 005 SC-016). Accepted for the *logs*, where there is no service to go through — see R4.

---

## R2 — One rendering: the report body is a single string, produced by core

**Decision**: core exports a pure function `renderReport(retrospective): string` producing the whole report
body as markdown. The window displays exactly that string and the export writes exactly that string. There is
no second rendering path.

**Rationale**: FR-045 and SC-011 require the export to match the view entry-for-entry, in order, including the
undated labelling, the no-review statements, and the stated reasons for omitted sections. If the window built
its own DOM from the structured value while the exporter built markdown from the same value, "they match"
would be a property maintained by two pieces of code that have to be changed in step forever — and the test
for it would compare two renderings rather than assert a fact.

With one rendering, the property is structural: the export is the thing on screen because it is the same
string. SC-011 collapses from a comparison to an identity.

It also puts every user-facing word of the report in core, which is where Principle II wants it. The sentence
"no review was run for 47 of these 52 weeks" is a statement about the user's data; a renderer composing it
would be a client holding domain vocabulary, which Principle VII forbids directly.

The window is not thereby contentless. It owns the chrome: the two date controls, the project filter, the
change notice, the copy and save actions, and the styling of the body it was handed.

**Alternatives considered**:

- **Structured value in, HTML in the window, markdown in the exporter.** The conventional split, and what most
  of this repo's other windows do. Rejected here because no other window has a requirement that its output be
  reproducible byte-for-byte somewhere else. Where that requirement exists, two renderers is the defect.
- **Render HTML in core.** Rejected: core would then know about a presentation medium, and the export would be
  markdown derived from HTML or a second render after all.
- **Export by scraping the DOM.** Rejected on sight: it makes the export a function of layout, and it cannot
  work in a core test.

---

## R3 — Selection is by recorded date; undated and unreadable dates are separate outcomes

**Decision**: a completion is selected iff it carries a completion date that parses as `YYYY-MM-DD` and falls
within `[from, to]` inclusive, compared as text-shaped local calendar dates. A record marked done with a null
date, or with a date that does not parse, is not selected and instead lands in the undated set, carrying the
raw text of whatever was there.

**Rationale**: The three sources already record exactly this and nothing more:

- `Milestone.completedOn: string | null` — "Local calendar date, present iff `done`"
- `Project.completedOn: string | null` — "Local date, set only while `status` is `done`"
- `Outcome.completedOn: string | null` — "Local calendar date, present iff `done`"

All three are `string | null`, all three are already local `YYYY-MM-DD`, and all three are parsed by code that
never invents one. So the range comparison is string comparison against two endpoints in the same shape —
which is not a shortcut but the correct semantics: FR-002 forbids timezone conversion precisely because
converting `2026-03-14` to an instant and back can move a completion across a boundary, and that would be the
recalculation FR-052 prohibits.

Three states rather than two, because the data has three. `null` means "marked done, never dated". A string
that does not match `YYYY-MM-DD` means "something is written there and it is not a date" — a hand-edit — and
FR-018 requires it shown verbatim rather than corrected. Folding the second into the first would lose the text
the user needs in order to find and fix it in vim.

`daysBetween` in `vault/lists.ts` already owns the `^(\d{4})-(\d{2})-(\d{2})$` shape and already returns null
for anything else. The retrospective reuses that regexp's discipline rather than inventing a second opinion
about what a date is.

**Alternatives considered**:

- **Parse to `Date` and compare instants.** Rejected — FR-002, above. It also introduces a DST-sensitive
  comparison for values that are not instants.
- **Drop undated records.** Rejected by FR-016/017 and by the user's own phrasing: "shown as undated rather
  than guessed at" only makes sense if they are shown.
- **Include undated records in the range on the theory that they might belong.** Rejected: that is inferring a
  date, which is the one thing the feature is explicitly built not to do.
- **Repair an unparseable date.** Rejected by FR-018 and by the repo's standing habit — nothing is ever
  rewritten to agree with anything else.

---

## R4 — Logs are read from the directory, not through `ReviewService`

**Decision**: the narrative reads `vault.list("log")`, filters to slugs that satisfy `isWeekId`, reads each
file in range, and parses it with `parseReview(content, week)` imported from `review/review-document.ts`. It
does not construct or hold a `ReviewService`.

**Rationale**: `ReviewService` is write-capable and expensive to stand up. Its `deps` require `projects`,
`topThree`, `inbox`, `waiting`, a policy module, and optionally a summary provider:

```ts
export interface ReviewServiceDeps {
  vault: VaultStore; projects: ProjectService; topThree: TopThreeService;
  inbox: { count(): Promise<number> }; waiting: WaitingService;
  clock?: Clock; policy?: PolicyModule; summary?: SummaryProvider;
}
```

Constructing all of that to read files would drag the entire review write surface — and a default policy
module — into a feature that adds no decision point and consults none (FR-058). It would also make the
`Pick<>` boundary of R1 pointless, since `ReviewService.complete()` would be one hop away.

Reading the directory directly costs nothing in duplication, because everything needed is already exported
and total:

- `LOG_DIR` and `reviewPath(week)` — so the retrospective invents no path knowledge
- `isWeekId(value)` — so a file that is not named for a week is not parsed as one
- `parseReview(content, week)` — total, never throws, and already returns `note`, `topThree.slipped`,
  `waiting[]`, `status`, and `summary`, which is the whole of FR-021, FR-022, FR-026 and FR-027

**A refinement this surfaced.** The spec's edge case "two log files claim the same week because one was
copied by hand" cannot happen the way it was written: `vault.list` returns filename stems, and one week has
one filename. A hand-copied file arrives as a *different* stem — `2026-W12 copy` — which `isWeekId` rejects.
The honest behaviour, and what the contract specifies, is that such a file is surfaced as an unreadable log
source naming its path, rather than silently ignored or parsed as a week. That satisfies the intent of the
edge case (both are surfaced as they read; the view does not pick a winner) via the mechanism the filesystem
actually provides. Recorded here rather than by rewriting the spec, since the spec is the record of what was
asked for.

**Alternatives considered**:

- **`ReviewService.history()` + `get()`.** The obvious reuse. Rejected on the construction cost and the write
  surface above. Note the retrospective would also have had to discard `ReviewSummary` and re-read anyway,
  since `history()` returns summaries without the note.
- **Widening `ReviewService` with a read-only sibling.** Rejected: a second entry point into a service whose
  deps are the problem does not fix the deps.
- **A new `RetrospectiveLogReader` port implemented in the adapter layer.** Rejected — the parsing is core's
  and already exists; a port here would move I/O that `VaultStore` already covers.

---

## R5 — Enumerating the weeks a range touches; `weekEnd` joins `iso-week.ts`

**Decision**: the weeks overlapping a range are enumerated by walking from `isoWeek(from)` with `nextWeek`
until the week's start passes `to`. `iso-week.ts` gains one exported function, `weekEnd(id)`, returning the
Sunday of the week as a local `Date`.

**Rationale**: FR-028 requires every individually shown week to state the calendar dates it spans, so a
partially covered week is legible as such. That needs both ends of a week. `weekStart(id)` already exists and
is already documented as local-not-UTC so that `isoWeek(weekStart(id)) === id` holds everywhere; `weekEnd` is
`weekStart + 6 days` and belongs beside it.

Putting it in `iso-week.ts` rather than in the retrospective module follows the rule this repo already wrote
down for itself, in `daysBetween`'s own comment: *"One definition, because two would disagree… A second
implementation that rounded differently would be a bug nobody could see until the two numbers appeared on the
same screen."* Week arithmetic has exactly one home and this is it.

Walking with `nextWeek` rather than adding 7 days repeatedly is likewise the module's own instruction:
`nextWeek` is "deliberately *not* `week + 1`, and deliberately not `+ 7 days` on a parsed date either", because
2026 has 53 ISO weeks and a naive increment produces `2026-W54`. Round-tripping through `isoWeek` means there
is one implementation of week arithmetic in the repo and the retrospective is not a second.

**Alternatives considered**:

- **A local `weekEnd` in the retrospective module.** Rejected by the rule above. It is three lines, which is
  exactly what makes a second copy tempting and undetectable.
- **Deriving the span from the log file instead.** Rejected: unreviewed weeks have no file and still need a
  span if they were ever shown individually, and the span is a fact about the calendar, not about the log.
- **Storing spans.** Rejected — derived on read, like everything else here.

---

## R6 — Unparseable outcome lines are found by a second pass, not by widening `parseTopThree`

**Decision**: to satisfy FR-020 for `top-three.md`, the retrospective re-walks the lines of each in-range week
section with `weekLines(content, week)` and the exported `parseOutcome(line, index)`, and reports any line that
is neither blank, nor a heading, nor a parseable outcome as an unreadable source with its 1-based line number.
`parseTopThree` is not changed.

**Rationale**: `parseTopThree` silently drops what it cannot read:

```ts
const outcome = parseOutcome(line, current.outcomes.length);
if (outcome) current.outcomes.push(outcome);
```

That is correct for its callers — Feature 4's views want the outcomes — but it means FR-020's "MUST NOT be
silently dropped" is unsatisfiable through it. Widening its return type would edit a shipped, heavily tested
module and break every existing caller's destructuring, for the benefit of one new reader.

The second pass costs nothing and duplicates nothing, because `parseOutcome` is exported, total, documented as
"one line, or null when it is not an outcome at all. Never throws", and is the *same function*
`parseTopThree` calls. There is one grammar; this reader just keeps the rejects instead of discarding them.
`weekLines` is likewise already exported and already returns a section's raw lines.

**Alternatives considered**:

- **Widen `parseTopThree` to `{ weeks, unreadable }`.** Rejected on blast radius: shipped module, shipped
  tests, four call sites, one beneficiary. If a second consumer ever wants the rejects, this is the moment to
  reconsider — noted so a future task can act on it rather than rediscover it.
- **A tolerant second parser in the retrospective.** Rejected outright: two grammars for one line format is
  precisely the drift `parseOutcome` being exported was meant to prevent.
- **Ignore unparseable lines.** Rejected by FR-020.

Projects need no equivalent pass: `parseProject` is total and yields a `Project` for any bytes, so a project
file is never "unparseable" in the sense that loses data — what it cannot recognise stays visible in the
fields it did read, and hand-edits are shown as they read by design. The one real loss is a file that vanishes
between `list` and `read`, which `readAll` filters; that is recorded as a known limitation in the plan rather
than papered over.

---

## R7 — Counts are computed at render time and never stored

**Decision**: no count appears as a field on any shape in the result. `renderReport` computes each section's
count from the length of the array it is about to print.

**Rationale**: FR-010f requires the number and the list beneath it to be incapable of disagreeing. A stored
count is a second representation of the same fact, and second representations drift — the whole reason
`ProjectSummary.gaps`, `needsDri`, and `statusSince` are documented as "derived on every read", and the reason
the review's inbox count is "derived on every call (FR-014)". A count in a struct would be the first stored
derived value in the repo, added by the feature least in need of one.

Computing at render time also means the count is literally taken from the entries shown, which is what FR-010f
says, rather than from the entries the selector thought it was going to show.

**Alternatives considered**:

- **`counts: { milestones: number; projects: number; outcomes: number }` on the result.** Convenient for a UI
  that wants a header without walking arrays. Rejected: the UI is a wall of text produced by `renderReport`
  (R2), so nothing needs it, and the drift risk is real for zero benefit.

---

## R8 — Ordering, and a tie-break that is derived rather than incidental

**Decision**: completions sort by `completedOn` descending, then by `projectSlug` ascending, then by kind
(`project` before `milestone`), then by milestone index ascending. Weeks sort by identifier descending.

**Rationale**: SC-003 requires byte-identical output across runs, "including the order of entries sharing a
completion date". `vault.list` sorts its entries (`.sort()` on filename stems), so project order is already
stable — but relying on that would make the retrospective's determinism a property of an adapter's
implementation detail rather than of core. Two entries on the same date need a rule core owns.

Every field in the tie-break is data: slug is the project's identity, index is "position within the project,
0-based. Part of its identity". Nothing depends on read order, filesystem order, or insertion order, so the
same fixture produces the same bytes on any machine.

Descending by date follows the spec's assumption, which follows the convention Feature 5 set for
`ReviewService.history()` and Feature 4 set for `TopThreeService.history()` — both sort newest-first with the
identical comparator idiom. Three sorts in one direction; the fourth does not get to be different.

**Alternatives considered**:

- **Leave same-date entries in read order.** Rejected — it makes SC-003 depend on `readdir`.
- **Tie-break on text.** Rejected: two milestones can share text across projects, so it is not a
  discriminator, and it sorts a user-visible string for machine reasons.

---

## R9 — The held reading is the client's; the change notice already exists

**Decision**: core's `read(range)` returns a value and has no notion of freshness. The window holds the value
it was given, subscribes to the existing `VaultChanged` emitter, and on a signal shows a notice with a
re-read action. Nothing re-reads on its own.

**Rationale**: The clarification settled that results are held and a notice offers a refresh (FR-010a–d). The
mechanism is already built and already correct for this: `VaultChanged` is raised by `FsVaultStore` *after a
write lands*, and the comment on `raise()` says why that matters — "a listener's whole job is to re-read the
file, so raising early would hand it the state from *before* the write". Its own docstring anticipates exactly
this reuse: "A writer added later… raises this by going through the same path, with nothing to remember and no
view to teach about it."

Crucially the emitter hangs off the **adapter**, not off an IPC handler, so a write from any window — the
review, the projects view, a future local API — reaches the notice. Hanging it anywhere else is the defect
Feature 3 already fixed once and wrote down.

"Held" is deliberately not modelled in core. A core that knew whether its answer was stale would need to know
when it was asked and what has happened since, which is view lifecycle living in a module whose only job is to
answer a question about files.

One consequence worth naming: `VaultChanged` fires on any project or area write, and `top-three.md` and the
log files are written through the same `FsVaultStore`. That is the right granularity here — the retrospective
reads all three sources, so any of them changing makes the reading stale — and it means the notice is
occasionally raised for a write that would not have altered this particular range. Over-notification is the
safe direction: the answer on screen is still true about the moment it was read (FR-010d), and the user
chooses whether to care.

**Alternatives considered**:

- **Re-read on signal, like the projects and inbox views.** The house convention. Rejected by the
  clarification and for the reason recorded there: entries moving mid-read break the copy in the user's
  clipboard and make FR-045 unprovable.
- **A new `RetrospectiveChanged` emitter.** Rejected — `VaultChanged` already covers every writer, and a
  second emitter would need every writer to remember it.
- **Compare a hash and only notify on a real difference.** Rejected as speculative: it would mean re-reading
  everything on every signal to decide whether to say anything, which is the cost the held reading avoids.

---

## R10 — Export delivery: clipboard and a save dialog, defaulting outside the vault

**Decision**: the window offers copy-to-clipboard (`clipboard.writeText`) and save-to-file
(`dialog.showSaveDialog`, defaulting to the user's documents directory, never the vault root), both operating
on the string `renderReport` returned. The core has no part in delivery.

**Rationale**: FR-050 requires both, because the stated purpose is pasting into a document and a file the user
must then open and copy is a worse version of the same thing. FR-049 requires the export to write nothing into
the data directory, which is why the dialog's default path is asserted in a test rather than left to whatever
Electron last remembered.

Delivery is main-process work — `clipboard` and `dialog` are Electron APIs — and core must not import from
Electron (Principle II, and the repo's existing package boundary). Core produces the bytes; the client places
them.

**Alternatives considered**:

- **Write the file from core through `VaultStore`.** Rejected twice over: it would put the export inside the
  vault, and it would require the `write` capability that R1 deliberately removed.
- **A download link in the renderer.** Rejected — it is a desktop app with a real save dialog, and a link
  would land in the browser's download directory with a generated name.
- **Clipboard only.** Rejected by FR-050; a year-long report is a lot to hold on a clipboard, and users save
  reports.

---

## R11 — No decision point, no policy module, and no clock

**Decision**: `DECISION_POINTS` is unchanged at five. `RetrospectiveServiceDeps` contains no `policy` field.
The `clock` dependency is present only for the one place a "today" could be needed and is otherwise unused —
see below.

**Rationale**: Principle V says a decision point must not be declared speculatively, and FR-058 says this
feature declares none. The reason is not restraint but that there is nothing to decide: a date range is a
question, not a commitment, and no answer here is an `allow`, `warn`, or `block`. Omitting the dependency
entirely — rather than accepting one and not calling it — makes SC-018's assertion (five before, five after)
redundant with the type, which is the desirable order of belt and braces.

On the clock: nothing in the current requirements needs "today". The range endpoints come from the user;
selection compares against them; week enumeration comes from the range. `TopThreeService.history()` internally
uses its own clock to guarantee the current week is present, which is its business, not the retrospective's.
**The clock is therefore omitted from the deps entirely.** Adding an unused dependency because it might be
wanted is the same speculative habit the constitution rejects for decision points.

**Alternatives considered**:

- **Accept a `PolicyModule` and never consult it**, for symmetry with the other services. Rejected: an
  injected policy that is never asked anything is an invitation for someone to ask it something.
- **A decision point for "is this range too large".** Rejected — that is a rule nobody asked for, guarding
  against a range the user explicitly said they want ("since I joined").

---

## R12 — The project history is part of the narrowed reading, not a separate verb

**Decision**: `Retrospective.history` is populated only when the query names a project, and is `null`
otherwise. It carries the project's `ledger` array unmodified, beside its `title` and current `status`.

**Rationale**: The clarification settled that the history appears under the project filter and nowhere else
(FR-036, FR-036a). Making it a field of the reading rather than a second verb means it comes from the same
single pass over the project files — `listDetailed()` already returns each `Project`, and `Project.ledger` is
already on it — so a narrowed reading costs no additional read. A separate `history(slug)` verb would re-read
the project, and would be callable from a client that had not narrowed, which is exactly what FR-036a
forbids.

FR-037 says the history must be read from the ledger and nothing else. Carrying `LedgerEntry[]` through
verbatim rather than mapping it into a new shape makes that structural: there is no field into which a derived
duration could be smuggled, because `afterDays` and `afterState` are the ledger's own and are already
documented as null when "the date a state began is observable at the transition and nowhere else, and one is
never inferred".

FR-041's "where `status:` and the ledger disagree, both shown, neither repaired" needs no code at all under
this design — the status field and the entries are two independent fields of the same struct, and nothing
reconciles them. It is asserted by test rather than implemented.

**Alternatives considered**:

- **`history(slug)` as its own verb.** Rejected above.
- **Mapping `LedgerEntry` into a presentation shape with a formatted duration.** Rejected: the formatting is
  `renderReport`'s job (R2), and an intermediate shape is where an inferred duration would eventually appear.

---

## R13 — Performance is bounded by counting reads, not by timing

**Decision**: reads per retrospective are: one per project file plus one `identity.md` (inside
`listDetailed`), one `top-three.md`, one `list("log")`, and one per log file whose week falls in range.
Asserted by a counting stub, per SC-019.

**Rationale**: SC-019 requires every project file to be read at most once over a four-year range, "verified by
counting reads, not by timing" — the form Feature 5 established for SC-016 and Feature 3 for identity
resolution (`identity-read-count.test.ts` exists). Timing tests are flaky on a laptop and prove nothing about
the shape of the algorithm; a read count proves the thing that actually matters, which is that nothing reads
per-entry inside a loop.

`listDetailed()` is the single-pass read and is documented as existing for precisely this reason: a caller
needing bodies as well as rows "could otherwise only get them by reading each file a second time. That second
read is exactly the quadratic path `list()` was shaped to avoid". The retrospective is its second customer.

The identity read is one per retrospective, not one per project, and is a cost of reusing `listDetailed`
rather than reimplementing it. It buys back the DRI resolution the retrospective does not need — an accepted
waste of exactly one file read, and cheaper than a second way to read all projects.

SC-001's ten-second budget is a client-side smoke check in the quickstart, not a unit test.

**Alternatives considered**:

- **A `listProjects(): Promise<Project[]>` addition to `ProjectService`** to skip identity resolution.
  Rejected: it edits a shipped service to save one file read, and a third list method on a class that already
  has four is a worse trade than one `identity.md` read.
- **Timing assertions.** Rejected per SC-019's own wording.

---

## R14 — Test strategy

**Decision**: `node --test` over compiled output under `TZ=America/New_York`, matching the existing suite.
New test files in the flat `packages/core/tests/` directory, kebab-case by topic. Five kinds of test carry
disproportionate weight:

1. **Byte-for-byte immutability** (SC-004): a fixture vault hashed before and after running every operation —
   read, narrow, history, export. The `Pick<>` boundary of R1 means this is a regression net rather than the
   primary guarantee, which is the right order.
2. **Determinism** (SC-003): the same range read twice, `renderReport` output compared as strings. Same-date
   entries included deliberately, since that is the case a naive implementation gets wrong.
3. **Boundary selection** (SC-002): a fixture with completions on `from - 1`, `from`, `to`, and `to + 1`.
   Inclusive endpoints are the kind of thing that is right until someone refactors the comparator.
4. **Read counting** (SC-019): a counting `Pick<VaultStore, "list" | "read">` stub, asserting one read per
   project file over a four-year range.
5. **Export identity** (SC-011): the export is the same string the view was handed, asserted directly rather
   than by comparing two renderings — which is only possible because of R2.

Offline (SC-016) follows the existing `project-offline.test.ts` pattern. Client behaviour — the held reading,
the change notice, the save dialog's default directory — is tested in the desktop package, where the
Playwright config already lives.

**Rationale**: The suite's conventions are established across 153 test files; a new feature inventing its own
layout would be the divergence. `TZ` is pinned and load-bearing here as it is in Feature 5: week spans and
local date comparison are local-calendar facts.

**Alternatives considered**: a nested `tests/retrospective/` directory — rejected, the existing directory is
flat and consistency beats taxonomy at this size.
