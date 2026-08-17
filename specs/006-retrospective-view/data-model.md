# Data Model: Retrospective View

**Feature**: 006-retrospective-view | **Date**: 2026-08-16 | **Plan**: [plan.md](./plan.md)

Every shape here is **produced**, never stored. Nothing in this feature has an on-disk representation: the
retrospective is an answer assembled from files Features 3, 4, and 5 already write, and it is discarded when
the window closes. That is why there is no format contract for it and no migration to consider.

The shapes live in `packages/core/src/retrospective/types.ts`.

---

## The question

### `DateRange`

```ts
/** Both endpoints inclusive, as local calendar dates (FR-001, FR-002). */
export interface DateRange {
  /** `YYYY-MM-DD`. */
  from: string;
  /** `YYYY-MM-DD`. Never earlier than `from`; a range that is, is refused (FR-003). */
  to: string;
}
```

### `RetrospectiveQuery`

```ts
export interface RetrospectiveQuery {
  range: DateRange;
  /**
   * A project slug to narrow to, or null for the whole range (FR-030).
   *
   * The slug rather than a title, because the slug is the identity every other
   * verb in the repo uses and a title can be edited between two readings.
   */
  project: string | null;
}
```

Not stored anywhere. FR-035 forbids writing a filter, a preference, or any view state into the data
directory, so the query lives in the window for as long as the window does.

---

## Completions

### `Completion`

One thing recorded as finished. Milestones and projects share a shape because they share a section, an
ordering, and an export rendering; the `kind` tag is what a reader needs and all that differs.

```ts
export type CompletionKind = "milestone" | "project";

export interface Completion {
  kind: CompletionKind;
  /**
   * What was finished, verbatim: a milestone's definition of done, or a
   * project's title. Never reworded, never truncated.
   */
  text: string;
  /** The project this belongs to — its own slug when `kind` is "project" (FR-007). */
  projectSlug: string;
  /** The project's title as it currently reads. A renamed project shows its new name. */
  projectTitle: string;
  /**
   * The recorded completion date, when it parses as `YYYY-MM-DD` (FR-006).
   *
   * null for every entry in `undated` and never anything else — an unparseable
   * date lives in `rawDate` and leaves this null, so no consumer can mistake
   * "2026-13-45" for a date by reading this field (FR-018).
   */
  completedOn: string | null;
  /**
   * What was actually written where the date goes, when it is not a date.
   *
   * null when `completedOn` is set, and null when nothing was written at all.
   * Present only for the third case: something is there and it is not a date.
   * Shown verbatim so the user can find it in vim (FR-018).
   */
  rawDate: string | null;
  /** Position within its project, for the tie-break. -1 for a project completion. */
  index: number;
}
```

**Ordering** (FR-008, research R8): `completedOn` descending, then `projectSlug` ascending, then `kind` with
`project` before `milestone`, then `index` ascending. Every field is data, so the order is a function of the
files and nothing else.

**Selection**: a record is a member of `completions` iff it is marked done, `completedOn` parses, and
`from <= completedOn <= to` as string comparison. Anything marked done that fails the parse is a member of
`undated` instead. Anything not marked done is neither (FR-014).

A hand-edited project carrying a completion date while its status says `active` is selected on the date and
shown with the status as it reads; neither is repaired (FR-019). This needs no code — the two are independent
fields and nothing reconciles them.

---

## Weekly outcomes

### `OutcomeCompletion` and `OutcomeWeekGroup`

```ts
export interface OutcomeCompletion {
  /** Verbatim as committed to. */
  text: string;
  /** Present iff this is in the dated set; null in `undatedOutcomes` (FR-013). */
  completedOn: string | null;
  rawDate: string | null;
  /** Position within its week, for a stable order within the group. */
  index: number;
}

export interface OutcomeWeekGroup {
  /** The week it was **committed to**, not the week it was finished in (FR-011). */
  week: WeekId;
  /** File order within the week, which is entry order. */
  outcomes: OutcomeCompletion[];
}
```

Groups sort by `week` descending. Week identifiers sort chronologically as text by construction, which is why
`ReviewService.history()` and `TopThreeService.history()` both already sort them as strings; this is the third
use of the same fact and not a new assumption.

An outcome committed to in `2026-W20` and finished in `2026-W23` appears under `2026-W20` carrying
`completedOn` from W23 — the grouping and the date answer different questions and both are shown (FR-011,
FR-013).

---

## The narrative

### `WeekNarrative`

What one week's log says. Read from the log and never reconciled against current data (FR-023).

```ts
export interface WeekNarrative {
  week: WeekId;
  /** Monday and Sunday, so a partially covered week is legible as such (FR-028). */
  span: DateRange;
  /** As the log records it. An unfinished review is shown, not hidden (FR-026). */
  status: "in-progress" | "complete";
  /**
   * The user's own words, verbatim, or null when the log records none.
   *
   * null here and *absence from the list* are different facts: this week has a
   * log and wrote no note; a week in `unreviewed` has no log at all (FR-025).
   */
  note: string | null;
  /** The reviewed week's outcomes the log recorded as not done (FR-022). */
  slipped: string[];
  /** Stale items and projects the log recorded, and what the user did (FR-022). */
  waiting: WaitingReviewRecord[];
  /** An accepted draft with its attribution intact, or null (FR-027). */
  summary: AcceptedSummary | null;
}
```

`WaitingReviewRecord` and `AcceptedSummary` are imported from `review/types.ts` unchanged. Reusing them rather
than mapping into a presentation shape is what keeps FR-023 structural: there is nowhere to put a recomputed
value, because the fields are the log's own.

### `UnreviewedWeeks`

```ts
export interface UnreviewedWeeks {
  /** Every week overlapping the range with no log, ascending. Named, not merely counted. */
  weeks: WeekId[];
  /** How many weeks the range overlaps in total, so the proportion needs no arithmetic (FR-024b). */
  weeksInRange: number;
}
```

Always present, even when `weeks` is empty — an empty list says "none were missed", and an absent section says
nothing at all (FR-024d). There is no threshold at which this shape changes (FR-024c); the same struct
describes a 13-week range and a 209-week one.

### `Narrative`

```ts
export interface Narrative {
  /** Weeks with a log, newest first. */
  weeks: WeekNarrative[];
  unreviewed: UnreviewedWeeks;
}
```

---

## Narrowing, and sections that a project does not have

### `ProjectScoped<T>`

```ts
/**
 * A section with no meaning under a project filter (FR-032, FR-033).
 *
 * Neither a weekly outcome nor a week's note carries a project association
 * anywhere in the data, so under a filter there is no honest way to show them:
 * showing them unfiltered implies an association that does not exist, and
 * showing an empty list implies the user committed to nothing. The third option
 * is to say why, and the reason is core's words, not a client's (Principle VII).
 */
export type ProjectScoped<T> =
  | { applies: true; value: T }
  | { applies: false; reason: string };
```

Used for `outcomes` and `narrative`. The union means a client physically cannot render an omitted section as
an empty one, because there is no array to iterate.

---

## Project history

### `ProjectHistory`

```ts
export interface ProjectHistory {
  slug: string;
  title: string;
  /** What the project says it is. Not reconciled with the ledger (FR-041). */
  status: ProjectStatus;
  /**
   * The project's ledger, verbatim and in file order (FR-037).
   *
   * `LedgerEntry` from `projects/types.ts`, carried through unmapped. There is
   * deliberately no field a derived duration could occupy: `afterDays` is the
   * ledger's own and is already null wherever the record is silent, which is
   * what makes FR-039's "unknown, never computed" structural rather than a rule
   * to remember.
   */
  entries: LedgerEntry[];
}
```

Present only when the query names a project; `null` otherwise (FR-036a, research R12). An empty `entries`
array means no history is recorded, which the export states in words — distinct from a project that has never
changed status, which is not a thing the data can express (FR-040).

---

## What could not be read

### `UnreadableSource`

```ts
export interface UnreadableSource {
  /** Vault-relative, so the user can open the offending file (FR-020). */
  path: string;
  /** 1-based, matching the editor gutter. null when the whole file is the problem. */
  line: number | null;
  /** Exactly as it sits on disk. Never rewritten. */
  raw: string;
  reason: "not-a-week-file" | "unreadable-line";
}
```

The deliberate analogue of `UnreadableLine` in `waiting/types.ts`, widened by a path because this feature
reads several files rather than one. Two reasons, both real:

- `not-a-week-file` — a file in `log/` whose name is not a week identifier, such as a hand-made copy. Surfaced
  rather than parsed as a week or silently skipped (research R4).
- `unreadable-line` — a line inside an in-range week section of `top-three.md` that is neither blank, a
  heading, nor a parseable outcome (research R6).

Project files produce no entries here: `parseProject` is total, and what it does not recognise stays visible
in the fields it did read. The one case it cannot cover — a project file that vanishes between `list` and
`read` — is recorded as a known limitation in [plan.md](./plan.md) rather than modelled here.

---

## The result

### `Retrospective`

```ts
export interface Retrospective {
  /** Echoed back, so an export separated from the app still says what it covers (FR-010, FR-046). */
  query: RetrospectiveQuery;
  /** The project's current title when narrowed, for the header. null otherwise. */
  projectTitle: string | null;

  /** Dated, in range, ordered. Complete — never capped or sampled (FR-006a). */
  completions: Completion[];
  /** Marked done, no readable date. Cannot be placed in the range (FR-016, FR-017). */
  undated: Completion[];

  outcomes: ProjectScoped<OutcomeWeekGroup[]>;
  undatedOutcomes: ProjectScoped<OutcomeCompletion[]>;
  narrative: ProjectScoped<Narrative>;

  /** Only under a project filter (FR-036, FR-036a). */
  history: ProjectHistory | null;

  /** Surfaced, never dropped (FR-020). Empty in the ordinary case. */
  unreadable: UnreadableSource[];
}
```

**No counts.** Every total the report prints is computed by `renderReport` from the array it is about to
print, so the number and the list beneath it cannot disagree (FR-010f, research R7). A stored count would be
the first stored derived value in this codebase, added by the feature least in need of one.

**No freshness.** Nothing here records when it was read or whether the files have moved since. The held
reading and its change notice are the window's, because a core that knew whether its answer was stale would
need view lifecycle it has no business holding (FR-010a–d, research R9).

### `RetrospectiveResult`

```ts
export type RetrospectiveRefusal =
  /** `to` is earlier than `from` (FR-003). */
  | "range-inverted"
  /** An endpoint is not a `YYYY-MM-DD` local calendar date. */
  | "invalid-date";

export type RetrospectiveResult =
  | { ok: true; retrospective: Retrospective }
  | { ok: false; reason: RetrospectiveRefusal; message: string };
```

Refusals are values a caller renders, matching `ProjectOutcome`, `TopThreeOutcomeResult`, and `ReviewResult`.
A refusal reads nothing and writes nothing (FR-003).

There is no `not-found` refusal for a narrowing whose slug does not exist: an absent project yields a reading
with no completions and no history, which the export states plainly (FR-034). A slug the user picked from a
list and which then vanished is an empty answer, not an error.

---

## Relationships

```text
RetrospectiveQuery ──── read ───▶ Retrospective ──── renderReport ───▶ string
                                        │                                 │
                                        │                          view + export
                                        │                        (the same string)
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
   Completion[]                  ProjectScoped<…>                 ProjectHistory
        ▲                               ▲                               ▲
        │                               │                               │
  Project.completedOn            Outcome.completedOn              Project.ledger
  Milestone.completedOn          Review.note / .topThree.slipped   (LedgerEntry[])
  (Feature 3)                     (Features 4 and 5)                 (Feature 5)
```

Every arrow points **out of** files this feature does not write. Nothing flows back.

---

## What this feature adds to existing shapes

Nothing. No field is added to `Project`, `Milestone`, `Outcome`, `Week`, `Review`, `LedgerEntry`, or
`ProjectSummary`; no file gains a section; no format changes (FR-062). The only edit to a shipped module is
one additive function, `weekEnd(id)` in `weekly/iso-week.ts`, which reads nothing and changes no existing
signature (research R5).
