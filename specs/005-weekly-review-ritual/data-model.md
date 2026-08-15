# Phase 1 Data Model: Weekly Review Ritual

**Feature**: 005-weekly-review-ritual | **Date**: 2026-08-15

Every type here is plain data, produced by parsing a file and consumed by pure functions — the habit that
keeps the rules testable without a filesystem. Nothing derived is stored: staleness, walk position, durations
and counts are all computed on read.

---

## Review

One guided pass over the user's commitments, belonging to exactly one ISO week.

```ts
export type ReviewStepName = "inbox" | "projects" | "waiting" | "top-three";

export interface Review {
  /** ISO week the review belongs to, `YYYY-Www`. Never changes once started. */
  week: WeekId;
  /** Local date the review was started. The anchor `nextWeek` is computed from. */
  started: string;
  /** The step the user is on. Stored, because a step can pass having decided nothing. */
  step: ReviewStepName;
  status: "in-progress" | "complete";
  /** Local date of completion, present iff complete. */
  completed: string | null;
  /** What was recorded, per step, in the order decided. */
  inbox: InboxStepRecord | null;
  projects: ProjectReviewRecord[];
  waiting: WaitingReviewRecord[];
  topThree: TopThreeStepRecord | null;
  /** The user's own words. Never generated. */
  note: string | null;
  /** An accepted draft, attributed. Absent unless a provider ran and was accepted. */
  summary: AcceptedSummary | null;
}
```

**Identity**: the week. At most one review per week (FR-005); starting again resumes.

**Lifecycle**: `in-progress` from the moment the file is created → `complete`, once, when the user completes
it. There is no other transition. A review left in progress when the week turns over stays in progress
forever unless the user finishes it; nothing auto-completes or deletes it (FR-059, FR-060).

**Not modelled**: a position within the project walk. It is derived — the first project in the walk set with
no `ProjectReviewRecord` against it (research R3).

---

## Step records

### InboxStepRecord

```ts
export interface InboxStepRecord {
  /** Count at the moment the step was passed. Derived then, recorded now. */
  count: number;
  /** The policy verdict the user passed under. */
  verdict: DecisionVerdict;
  /** Local date the step was passed. */
  on: string;
}
```

A `block` verdict is never recorded, because a blocked step is not passed. Recording `count` and `verdict`
together is what lets a later reader tell "inbox was clear" from "eleven items, warned, proceeded" (FR-067).

### ProjectReviewRecord

```ts
export interface ProjectReviewRecord {
  slug: string;
  /** What the user did. `none` is a decision and is recorded (FR-034). */
  action: "none" | "status" | "next-action" | "milestone-done" | "structure";
  /** Human-readable specifics: `active → parked`, the milestone's text, the field named. */
  detail: string | null;
  on: string;
}
```

One project may hold several records in one review — a milestone marked done *and* a status change are two
actions. Order is the order decided. Presence of at least one record is what marks the project as walked.

**Deliberately absent**: any copy of the project's fields. The record says what was decided; the project file
says what the project is. Copying would create a second truth that drifts.

### WaitingReviewRecord

```ts
export interface WaitingReviewRecord {
  /** The item's own text, enough to identify it in the log a year later. */
  text: string;
  owner: string;
  /** Days untouched when it was surfaced. */
  days: number;
  /** `project` when the subject was a waiting project rather than a delegated item. */
  subject: "item" | "project";
  action: "followed-up" | "received" | "none";
  on: string;
}
```

Records both subjects of the staleness rule, because both are things that went quiet and both belong in
"what slipped" (FR-066).

### TopThreeStepRecord

```ts
export interface TopThreeStepRecord {
  /** The reviewed week's outcomes as they stood when the step was passed. */
  finished: string[];
  slipped: string[];
  /** What was committed to for the week ahead. Empty is valid (FR-052). */
  committed: string[];
  /** The week those commitments landed in — the review's week + 1. */
  forWeek: WeekId;
  on: string;
}
```

The only record that copies text out of another file, and deliberately: what the user finished *that week* is
the fact the retrospective reads, and a later edit to `top-three.md` must not silently rewrite history in a
completed log.

### AcceptedSummary

```ts
export interface AcceptedSummary {
  text: string;
  /** The provider's own name, for attribution. */
  provider: string;
  on: string;
}
```

Separate from `note` at the type level, so nothing can merge them (FR-107).

---

## The walk

What core hands the client for the project step. Assembled from one pass over the project files.

```ts
export interface WalkEntry {
  project: ProjectSummary;         // includes gaps, needsDri, dri, statusSince
  /** The body the summary does not carry (corrected during implementation — see below). */
  outcome: string | null;
  nextAction: string | null;
  milestones: Milestone[];
  /** Present only for a `waiting` project the staleness rule flagged. */
  stale: StaleFlag | null;
  /** Whether this project already has a record in this review. */
  reviewed: boolean;
}

export interface StaleFlag {
  /** Policy's own words: "This has been waiting 74 days." */
  reason: string;
  days: number;
}
```

**Corrected during implementation (2026-08-15)**: this shape originally carried `ProjectSummary` alone. FR-023
requires the walk to show the outcome, the next action, and every milestone with its done state, and a
summary carries none of those — it is shaped for a list row. Reading them per project would have been a
second read of every file, which is exactly the quadratic path SC-016 forbids, so `ProjectService` gained
`listDetailed()` and the walk entry carries the body from the same single pass.

**Walk set**: projects whose status is `active` or `waiting` (FR-022). Parked and done are excluded.
**Order**: `ProjectService.list()`'s order, which is `VaultStore.list()`'s sorted slugs — stable across reads
of unchanged data (FR-021).

---

## Project ledger

An append-only history in the project's own file.

```ts
export interface LedgerEntry {
  /** Local calendar date the action occurred. */
  on: string;
  /** The verb. `status` is the only one this feature writes (FR-090). */
  action: string;
  /** Everything after the verb: `active → waiting`. Verbatim. */
  detail: string;
  /** Days the ended state had lasted, when the ledger itself knows. Never inferred. */
  afterDays: number | null;
  /** The state that ended, when known. */
  afterState: string | null;
  /** The full source line, so a hand-written entry survives a rewrite of others. */
  raw: string;
}
```

**Order**: file order, oldest first. Appends land at the section's end.

**Never**: rewritten, reordered, compacted, or removed by the system (FR-091). There is no verb that edits an
entry.

**Derived from it** — never stored:

```ts
/** Date the current status was entered, or null when the ledger does not say. */
statusSince: string | null
```

Computed as the `on` of the **last** entry whose `detail` ends in `→ <project.status>`. Last, not first, so a
project that has bounced between statuses reports its most recent spell (spec edge case). `null` when no
entry matches — a hand-edited status, or a project older than the ledger — and a null duration is never
flagged stale (FR-094).

**Relationship to `status:`**: the preamble field is the source of truth for what the project *is*; the
ledger records how it got there (FR-095). Where they disagree, both are shown as they read.

---

## Waiting-for item

`waiting.md` parsed, with its actions.

```ts
export interface WaitingItem {
  /** Position in the file, 0-based. Part of its identity. */
  index: number;
  /** Date it started waiting. Preserved forever; never rewritten (FR-043a). */
  since: string;
  owner: string;
  /** Item text, continuation lines rejoined. Verbatim. */
  text: string;
  /** Original capture time, or null for a hand-written line. */
  capturedAt: Date | null;
  /** Follow-ups and receipt, in file order. */
  actions: WaitingAction[];
  /** The full source block — item line plus its continuations and actions. */
  raw: string;
}

export interface WaitingAction {
  kind: "followed-up" | "received";
  on: string;
}

export interface WaitingRef {
  index: number;
  /** The block exactly as the caller was shown it. */
  raw: string;
}
```

**Derived** — never stored:

- `outstanding` = no action of kind `received` (FR-042).
- `untouchedSince` = the `on` of the last action, or `since` when there are none (FR-037). This is what the
  staleness rule is asked about; `since` remains visible for total age.

`WaitingRef` is the deliberate analogue of `MilestoneRef` and `OutcomeRef`: position plus the exact text,
verified immediately before a write, no id embedded in the file.

---

## Policy additions

Two keys join the existing three in `policy.md`:

| Key | Type | Default | Governs |
|---|---|---|---|
| `inbox gate` | `warn` \| `block` | `warn` | Advancing past the inbox step with a non-empty inbox |
| `staleness days` | whole number | `7` | Both waiting-for items and waiting projects |

```ts
export interface PolicyConfig {
  wipLimit: number;
  milestoneCap: number;
  weeklyOutcomeCap: number;
  inboxGate: "warn" | "block";   // NEW
  stalenessDays: number;          // NEW
}
```

Fallback stays per value, never per file: a typo in `staleness days` must not restore a default WIP limit the
user deliberately changed. An unrecognised `inbox gate` value falls back to `warn` and reports the problem
(FR-084).

---

## Refusals

Values a caller renders, in the established `{ ok: false, reason, message }` shape.

| Reason | Raised when |
|---|---|
| `inbox-not-empty` | Advancing past the inbox step while the gate is configured to `block` |
| `step-order` | Attempting to reach a step before an earlier one has been passed (FR-002) |
| `already-complete` | Any write against a completed review (FR-011) |
| `entry-changed` | A waiting-for item changed on disk since it was shown |
| `not-found` | The referenced item, project, or review is gone |
| `future-week` | *(top three)* A write aimed beyond the next week (research R9) |

`past-week` is unchanged and still refuses writes to earlier weeks, so
`packages/core/tests/top-three-preservation.test.ts` passes unmodified.

---

## What is deliberately not modelled

- **A per-project note.** The user's note is one piece of prose at completion (FR-100). Per-project notes are
  a later addition the log format leaves room for.
- **A review cursor.** Position within the walk is derived (research R3).
- **A "reviewed" flag on the project file.** Attention paid is not an action taken; it belongs in the week's
  log, not in the project's ledger (FR-097).
- **A person or contact entity.** Owners and DRIs remain free-text names, as Features 3 and 4 established.
- **A ledger on anything but a project.** The entry shape generalises; nothing else carries one yet (FR-098).
