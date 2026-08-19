# Data Model: Daily Shutdown

**Feature**: 009-daily-shutdown | **Date**: 2026-08-18 | **Plan**: [plan.md](./plan.md)

## The shape of this document

There is no persisted entity in this feature. Nothing below is stored, and no file on disk holds any of
it. Every type here describes a value that exists only between `ShutdownService.read()` returning and the
window being closed.

That is the load-bearing fact, so it is said once, plainly: **this feature adds no file, no field, no
section, no index, no cache, and no migration.** The Key Entities in the spec — the shutdown view, a stale
waiting-for item, a stale calendar-flagged item — are derived values with no identity and no lifecycle. The
staleness threshold is an existing policy value, read and never written.

Types the feature reuses unchanged, with links to where they are already defined:

| Type | Defined in | Used for |
|---|---|---|
| `Week`, `Outcome`, `OutcomeRef` | `weekly/types.ts` | the top-three panel and its one action |
| `ProjectSummary`, `Project`, `Milestone`, `MilestoneRef` | `projects/types.ts` | the project panel and its two actions |
| `ResolvedDri` | `identity/types.ts` | the "is this mine" filter, resolved by core, never here |
| `WaitingItem`, `WaitingRef`, `UnreadableLine` | `waiting/types.ts` | the waiting panel and its two actions |
| `PolicyConfig.stalenessDays` | `policy/policy-config.ts` | the one threshold, for all three subjects |
| `Decision` | `ports/index.ts` | the staleness answer, whose `reason` is passed through untouched |

---

## New types

### `CalendarItem` — `packages/core/src/calendar/types.ts`

One well-formed line of `calendar.md`. See [contracts/calendar-format.md](./contracts/calendar-format.md)
for the grammar it is parsed from.

```ts
export interface CalendarItem {
  /** Position in the file, 0-based. Part of its identity, as in `WaitingItem`. */
  index: number;
  /** Local date the item was flagged, `YYYY-MM-DD`. Verbatim; never substituted. */
  flaggedOn: string;
  /** Item text, continuation lines rejoined with newlines. Verbatim. */
  text: string;
  /** Original capture time, or null for a hand-written line. Never substituted. */
  capturedAt: Date | null;
  /** The full source block — item line plus any continuations. */
  raw: string;
}
```

**Deliberately absent**: any event date, time, duration, location, or attendee. `calendar.md` is a staging
list of flags, not a calendar (002 FR-017). There is no `CalendarRef`, because there is no verb to take
one: nothing in this feature or anywhere else writes to this file (FR-042).

**Unreadable lines** reuse `UnreadableLine` from `waiting/types.ts` rather than defining a second identical
shape. Its doc comment is widened from "a line of `waiting.md`" to "a line of a running list" — a comment
change with no behavioural effect (research R4).

---

### `SourceFailure` and `Panel<T>` — `packages/core/src/shutdown/types.ts`

```ts
/** A source that could not be read at all. Never a repair, never a guess. */
export interface SourceFailure {
  /** Vault-relative: `top-three.md`, `waiting.md`, `calendar.md`, or `projects/`. */
  path: string;
  /** The underlying error's message, verbatim. Core does not diagnose it. */
  message: string;
}

/**
 * A panel is built or it failed. Never both, never neither.
 *
 * A two-state union rather than an array plus an optional error, because
 * FR-011c requires "nothing here" and "could not read this" to be different
 * answers that read differently — and an array that is empty for both reasons
 * pushes that distinction into whichever renderer remembers it.
 */
export type Panel<T> =
  | { items: T[]; failure: null }
  | { items: []; failure: SourceFailure };
```

An empty vault yields the three list panels with `items: []` and `failure: null`, and panel 1 with a `Week`
holding no outcomes and `failure: null` — the explicit empty state FR-011 requires. (Panel 1 carries a
`Week` rather than a list, for the reason given below, and is a two-state union on the same principle as
this one.) A missing file is *not* a failure: absence is the normal first-run case and produces the empty
state, never a complaint and never a created file.

---

### The four panel rows — `packages/core/src/shutdown/types.ts`

```ts
/**
 * Panel 1. The current ISO week, exactly as `TopThreeService.current()` reads it.
 *
 * A two-state union for the same reason `Panel<T>` is one. With `week` and
 * `failure` both inhabited at once, an unreadable `top-three.md` would force a
 * fabricated empty `Week` into the value — a week that reads as "no outcomes
 * set for this week" when the truth is "this file could not be read". FR-011c
 * requires those to be different answers, and FR-009 forbids inventing the
 * week to make the shape work.
 */
export type TopThreePanel =
  | { week: Week; failure: null }              // id, outcomes (open and done together), current, writable
  | { week: null; failure: SourceFailure };
```

The week is carried whole rather than flattened: `Outcome` already holds `text`, `done`, `completedOn`, and
`raw`, and `raw` is what `OutcomeRef` needs to verify a write. FR-014's "show open and done together" is
therefore the absence of a filter, not the presence of one. FR-016's "no other week" is structural — there
is one `Week` here and no verb that takes another. The union costs a caller nothing: it checks
`panel.failure === null` before reaching for `panel.week`, exactly as it does for the other three.

```ts
/** Panel 2. One active project whose DRI resolves to the user. */
export interface MyProject {
  summary: ProjectSummary;      // slug, title, status, dri, gaps, statusSince, …
  /** Verbatim, or null when the project records none. Never inferred (FR-021). */
  nextAction: string | null;
  /** Open milestones only — what can be marked done from here (FR-022). */
  openMilestones: Milestone[];
}
```

`nextAction: string | null` carries FR-021 in the type: there is no branch in which a value could be
derived, because there is nothing to derive it from. The panel lists projects in `listDetailed()` order —
`list("projects")` sorted by slug — and is never limited, truncated, or ranked (FR-023).

```ts
/** Panel 3. A waiting-for item the rule flagged. */
export interface StaleWaiting {
  item: WaitingItem;       // owner, text, since, actions, raw — the ref's identity
  /** Policy's words, passed through untouched. Never composed by a client. */
  reason: string;
  /** Days since last touched. Core's count of two dates, not a rule about them. */
  untouchedDays: number;
  /** Days since `since`. What tells "chased weekly for months" from "forgotten". */
  waitingDays: number;
}

/** Panel 4. A calendar flag the same rule flagged. */
export interface StaleCalendar {
  item: CalendarItem;
  reason: string;
  /** Days since flagged. The only age a flag has. */
  unscheduledDays: number;
}
```

`StaleWaiting` deliberately mirrors `StaleWaitingItem` in `review/types.ts` and carries one field more —
`waitingDays` — because FR-027 requires both numbers on screen at once. Both come from the same `today`, so
they cannot disagree (research R10).

---

### `ShutdownView` — the whole screen, read at one moment

```ts
export interface ShutdownView {
  /** The local date the screen was read. Every age below is measured against it. */
  today: string;

  topThree: TopThreePanel;
  projects: Panel<MyProject>;
  waiting: Panel<StaleWaiting>;
  calendar: Panel<StaleCalendar>;

  /** Lines the grammar could not read, surfaced rather than dropped (FR-032). */
  unreadableWaiting: UnreadableLine[];
  unreadableCalendar: UnreadableLine[];

  /** The policy module's complaints about its own configuration, if any. */
  policyNotices: string[];
}
```

**`today` is a field, not a call.** It is taken once at the top of `read()`, and every day count in the
value is measured against it. The date changing while the window is open changes nothing, because nothing
recomputes — which is exactly the edge case the spec names.

**`policyNotices`** carries what `parsePolicyConfig(..., { withProblems: true })` already produces: a
malformed `staleness days` is reported for display and never thrown, and the documented default applies for
that value alone (FR-030). This is a notice, never a refusal — a configuration error must not stop the user
working, the discipline Feature 5 established for `review.inbox.advance`.

**No `openedAt`, no `id`, no `completed`, no `step`, no `progress`.** There is nothing in this value that
could be persisted into a record of a shutdown, because FR-004, FR-005, FR-050, and FR-052 forbid one
existing. The type is the enforcement.

---

## Derivation rules

| Panel | Membership rule | Source |
|---|---|---|
| Top three | The current ISO week's section, whatever it holds | `TopThreeService.current()` (FR-012) |
| Projects | `status === "active" && dri.resolution === "mine"` | `ProjectService.listDetailed()` (FR-017–FR-019) |
| Waiting | `outstanding(item)` **and** `waiting.stale.check` returns non-`allow` for `untouchedSince(item)` | `WaitingService.read()` (FR-024–FR-026) |
| Calendar | `waiting.stale.check` returns non-`allow` for `flaggedOn` | `readCalendar(...)` (FR-028) |

Three consequences follow from the staleness rule being *the same function* rather than a copy of it, and
none of them is implemented here:

- **The boundary is inclusive** — at the default of 7, an item last touched 7 days ago is stale and one
  touched 6 days ago is not (FR-024, FR-028), because `default-policy.ts` compares `days < stalenessDays`.
- **An unreadable or future date is never stale** (FR-029a), because that function returns `allow` when
  `daysBetween` yields `null` or a negative.
- **A threshold of zero makes everything outstanding stale** (edge case), because zero is a number and not
  an "off" switch.

Ordering, everywhere, is source order: file order for the three lists, slug order for projects. Nothing is
sorted by age, staleness, or urgency, which would be the ranking FR-009 forbids.

## State transitions

None. There is no state to transition. The view is created by `read()`, held by one window, and discarded
when that window closes. Closing it mid-use leaves nothing partial because there is nothing to finish
(FR-004, FR-005, FR-010c).

The only transitions this feature can cause are the ones the existing verbs already own: an outcome
open → done, a milestone open → done, a next action replaced, a waiting item chased or received, and an
inbox item created. Each is recorded exactly as it is recorded from any other surface, and none of them
knows this screen exists (FR-051).
