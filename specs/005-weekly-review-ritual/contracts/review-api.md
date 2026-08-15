# Contract: ReviewService

**Feature**: 005-weekly-review-ritual

The single entry point for the ritual. Same habits as `SortService`, `ProjectService`, and
`TopThreeService`: injected ports, every read fresh, refusals as values rather than exceptions, one write at
a time.

```ts
export interface ReviewServiceDeps {
  vault: VaultStore;
  projects: ProjectService;
  topThree: TopThreeService;
  waiting: WaitingService;
  /** Reads the inbox count. The review never writes it. */
  inbox: Pick<SortService, "count">;
  clock?: Clock;
  /** Defaults to the single shipped module — absent means rules, not no rules. */
  policy?: PolicyModule;
  /** Absent means NO summary. The opposite convention from `policy`, deliberately. */
  summary?: SummaryProvider;
}
```

**Why the two optionals differ**: a rule that can be dropped by forgetting an argument is a bypass, so
`policy` defaults to enforcing. A summary that appears because an argument was forgotten is generated text
nobody asked for, so `summary` defaults to nothing (research R10).

**Why the other services are injected rather than reconstructed**: every change the review makes must go
through the same verbs any other surface calls, with the same decision points and the same refusals. Handing
`ReviewService` a `VaultStore` and letting it write project files would be the second write path this
feature is forbidden to create.

---

## Reading

```ts
/** The review for the current week — resumed if one exists, otherwise not started. */
current(): Promise<Review | null>;

/**
 * Starts the current week's review, or resumes it.
 *
 * Idempotent: calling it twice returns the same review. Creates `log/` and the
 * week's file on first call and not before (FR-006, FR-005).
 */
start(): Promise<Review>;

/** Past reviews, newest first, each identified by its week (FR-071). */
history(): Promise<ReviewSummary[]>;

/** One past review, read as it stands on disk. Never repaired (FR-072). */
get(week: WeekId): Promise<Review | null>;
```

## The steps

Each step's read verb hands the client a finished answer; the client renders it and routes input.

```ts
/** Count derived from the file on every call, hand-written lines included (FR-014, FR-015). */
inboxStep(): Promise<{ count: number }>;

/**
 * The walk, in stable order, with staleness already decided for waiting projects.
 *
 * Reads each project file at most once (SC-016). `reviewed` comes from the log,
 * so a resumed review knows where it is without a stored cursor.
 */
projectStep(): Promise<WalkEntry[]>;

/** The first walk entry with no record against it. Derived, never a stored cursor. */
nextProject(): Promise<WalkEntry | null>;

/**
 * Outstanding items, with the stale ones flagged by policy.
 *
 * `total` counts outstanding items; `stale` is the subset over the threshold.
 * Received items appear in neither (FR-039, FR-042).
 */
waitingStep(): Promise<{ total: number; stale: StaleWaitingItem[] }>;

/**
 * The reviewed week's outcomes and the week ahead's, both live.
 *
 * `reviewed` is editable — it is the current week, and a Friday review is when a
 * straggler gets marked done (FR-048). `ahead` is the week commitments land in.
 */
topThreeStep(): Promise<{ reviewed: Week; ahead: Week }>;
```

## Advancing

```ts
/**
 * Passes the current step and moves to the next.
 *
 * Consults `review.inbox.advance` when leaving the inbox step. A `block` verdict
 * refuses with `inbox-not-empty` and the module's own message; a `warn` is
 * returned to the caller, which may retry with `{ confirmed: true }` — the same
 * flow as the open-milestone confirmation (FR-017, FR-018).
 */
advance(opts?: { confirmed?: boolean }): Promise<ReviewResult>;

/** Returns to an already-passed step. Records nothing, discards nothing (FR-003). */
goTo(step: ReviewStepName): Promise<ReviewResult>;
```

Skipping forward is refused with `step-order`. Any write against a completed review is refused with
`already-complete`.

## Recording

Every verb here does two things in a fixed order: perform the change **through the owning service**, then
record what was decided in the log. If the underlying verb refuses, its refusal is returned unchanged and
nothing is recorded.

```ts
/** Delegates to ProjectService.setStatus. WIP limit and open-milestone confirmation apply identically. */
recordStatus(slug: string, expected: ProjectStatus, next: ProjectStatus,
             opts?: { confirmOpenMilestones?: boolean }): Promise<ReviewResult>;

recordNextAction(slug: string, expected: string | null, next: string | null): Promise<ReviewResult>;
recordMilestoneDone(slug: string, ref: MilestoneRef): Promise<ReviewResult>;
/** Added during implementation: fixing a `milestones` gap the walk surfaced. The cap fires identically. */
recordMilestoneAdded(slug: string, definitionOfDone: string, verifier: string | null): Promise<ReviewResult>;
recordStructure(slug: string, field: "outcome" | "dri" | "next-action",
                expected: string | null, next: string | null): Promise<ReviewResult>;

/** "I looked at it and there is nothing to change." A decision, and recorded (FR-033, FR-034). */
recordNoChange(slug: string): Promise<ReviewResult>;

/** Delegates to WaitingService. The item stays outstanding. */
recordFollowUp(ref: WaitingRef): Promise<ReviewResult>;
/** Delegates to WaitingService. The item stops being outstanding; nothing is deleted. */
recordReceived(ref: WaitingRef): Promise<ReviewResult>;
/** A stale subject the user chose to leave. Recorded so the log shows it was surfaced. */
recordLeft(ref: WaitingRef | { slug: string }): Promise<ReviewResult>;
```

Outcomes for the week ahead are set through `TopThreeService` directly — `addOutcome(text, week)` — not
through a review verb. The review records what landed when the step is passed. A wrapper would be a second
path to a verb the client already has.

## Completing

```ts
/**
 * Asks the supplied provider for a draft.
 *
 * `{ available: false }` when no provider is supplied — which is the shipped
 * configuration and is not an error state for a client to render as broken
 * (FR-103). A provider that throws, hangs, or is unreachable yields
 * `{ available: false, failure }`, never a rejection (FR-111).
 */
draftSummary(): Promise<
  | { available: false; failure?: string }
  | { available: true; text: string; provider: string }
>;

/**
 * Completes the review.
 *
 * Acceptance is structural: only what the caller passes in `summary` is recorded.
 * There is no path by which core writes a draft it produced (FR-105).
 *
 * Refuses unless every step has been passed (FR-010).
 */
complete(input: { note?: string | null; summary?: { text: string; provider: string } }):
  Promise<ReviewResult>;
```

`ReviewResult` is `{ ok: true; review: Review } | { ok: false; reason: ReviewRefusal; message: string }`,
matching `ProjectOutcome` and `TopThreeOutcomeResult` so a client renders all three the same way.

**Corrected during implementation (2026-08-15)**: the recording verbs return `ReviewRecordResult`, which is
`ReviewResult` widened by `ProjectOutcome`'s refusal. "Its refusal is returned unchanged" above is not
expressible in `ReviewResult` alone — `wip-limit`, `open-milestones` and their `subjects`/`open` fields are
not `ReviewRefusal`s, and flattening them into one would have been the review holding its own opinion about
what a refusal means. The parity tests compare all three fields across both paths.

---

## Concurrency

One write at a time, using the queue `TopThreeService` established. Every recording verb is a
read-modify-write of one section of one file; two overlapping calls would both read the same state and the
second would silently discard the first. Cross-process races remain the adapter's problem, as they already
are for project files.

---

## IPC channels

Thin pass-throughs, registered by `registerReviewIpc(review, hideReview)`. No channel accepts a decision the
core did not define, and none raises the vault change signal — `FsVaultStore` raises it from its write path,
so a writer that never reaches these handlers still reaches every open view.

| Channel | Direction | Maps to |
|---|---|---|
| `review:current` | invoke | `current()` |
| `review:start` | invoke | `start()` |
| `review:history` | invoke | `history()` |
| `review:get` | invoke | `get(week)` |
| `review:step-inbox` | invoke | `inboxStep()` |
| `review:step-projects` | invoke | `projectStep()` |
| `review:step-waiting` | invoke | `waitingStep()` |
| `review:step-top-three` | invoke | `topThreeStep()` |
| `review:advance` | invoke | `advance(opts)` |
| `review:go-to` | invoke | `goTo(step)` |
| `review:record-*` | invoke | the recording verbs above |
| `review:draft-summary` | invoke | `draftSummary()` |
| `review:complete` | invoke | `complete(input)` |
| `review:dismiss` | send | hides the window |
| `vault:changed` | main → renderer | existing generic signal; the review view re-reads |

**Deliberately absent**: a channel that writes the inbox, sorts an item, or sets a project field the review
does not offer. The client cannot hold domain logic it has no way to express.
