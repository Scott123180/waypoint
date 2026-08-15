# Contract: Two new decision points

**Feature**: 005-weekly-review-ritual

Extends the seam Feature 4 built. Everything about it is unchanged: core declares where rules are consulted
and never what they say, decisions are exactly `allow` / `warn` / `block` with a displayable reason, and
exactly one default module ships with no loader, no discovery, and no public extension API.

`DECISION_POINTS` goes from three to five.

```ts
export const DECISION_POINTS = [
  "project.status.change",
  "project.milestone.add",
  "week.outcome.record",
  "review.inbox.advance",   // NEW
  "waiting.stale.check",    // NEW
] as const;
```

Both new points have a rule registered against them. None is declared speculatively (FR-080).

**One existing test changes**: `packages/core/tests/decision-points.test.ts` asserts the count and the exact
set, and becomes 5. That is legitimate — the count is what changed — and `ports/index.ts` anticipates it in
as many words. Every other Feature 3 and Feature 4 test passes unmodified.

---

## `review.inbox.advance`

Consulted when the user attempts to pass the inbox step. Consulted **once per attempt**, not per item.

```ts
export interface ReviewInboxAdvanceContext {
  point: "review.inbox.advance";
  /** Derived from the file at the moment of the attempt. Never cached (FR-014). */
  inboxCount: number;
}
```

| Count | Configured `warn` (default) | Configured `block` |
|---|---|---|
| 0 | `allow`, empty reason | `allow`, empty reason |
| > 0 | `warn`, naming the count | `block`, naming the count and that sorting unblocks it |

A `warn` is returned to the caller, which may retry with `{ confirmed: true }` — the same flow the
open-milestone confirmation already uses, so a client renders both the same way. A `block` cannot be
confirmed past.

With an empty inbox the step advances silently whichever way the rule is configured (FR-020), which is why
both columns above read `allow` at zero: the gate is about a non-empty inbox, not about announcing an empty
one.

---

## `waiting.stale.check`

Consulted **once per subject** — per outstanding waiting-for item, and per project in the walk whose status
is `waiting`.

```ts
export interface WaitingStaleContext {
  point: "waiting.stale.check";
  /** For the message only. The rule and the threshold are identical for both. */
  subject: "item" | "project";
  /**
   * Local date the subject was last touched: the last follow-up, or the date it
   * started waiting; for a project, the date it entered `waiting`.
   */
  since: string;
  /** Local date today, supplied by core so the rule needs no clock. */
  today: string;
}
```

| Age | Verdict | Reason |
|---|---|---|
| ≤ threshold | `allow` | empty |
| > threshold | `warn` | e.g. `"Waiting 21 days, with a 7-day threshold."` |

`warn` rather than `block` because nothing is being refused — the closed set's middle value is exactly "this
deserves your attention", and the review surfaces it without preventing anything.

**One point, two subjects, on purpose.** A delegated item that has gone quiet and a project parked in
`waiting` are the same rule applied to two things, and they share the threshold. Splitting them into two
points would make separate thresholds the easy next step; keeping one means a contributor who wanted them to
diverge would have to change `DECISION_POINTS`, where it is visible.

**A subject with an unknown `since` is never asked.** A project whose ledger has no entry for its current
status — hand-edited, or older than the ledger — is walked with an unknown duration and is not put to the
rule at all (FR-094). Core does not substitute a date to make the question askable.

---

## Configuration

Two keys join the existing three in `policy.md`, in the same `key: value` preamble.

```markdown
# Policy

wip limit: 3
milestone cap: 4
weekly outcome cap: 3
inbox gate: warn
staleness days: 7
```

| Key | Values | Default | Governs |
|---|---|---|---|
| `inbox gate` | `warn` \| `block` | `warn` | `review.inbox.advance` |
| `staleness days` | whole number | `7` | `waiting.stale.check`, both subjects |

**Fallback stays per value, never per file.** A typo in `staleness days` must not silently restore a WIP
limit the user deliberately changed. An unrecognised `inbox gate` value falls back to `warn` and reports the
problem alongside whatever decision was being made — surfaced, never blocking, exactly as Feature 4's
malformed-value handling already works (FR-084).

`staleness days: 0` makes everything stale, which is a coherent configuration and is honoured rather than
corrected — the same treatment `wip limit: 0` already gets.

**Absence is still the normal case.** Every vault on disk has no `policy.md`, and every Feature 3 and
Feature 4 fixture has none. The defaults are the documented ones; no file is created without the user asking
(FR-083).

---

## What is not a decision point

**The summary port.** It returns text for the user to accept or decline, never `allow`/`warn`/`block`, and
routing it through the seam would corrupt a closed set whose value is that it is closed (FR-113). See
[summary-port.md](./summary-port.md).

**Advancing past any step other than the inbox.** No rule governs those, so no point is declared for them.

**Completing a review.** The constitution's Sync Impact Report mentions "before a review is closed" as an
*example* of a decision point, not a requirement to build one. No rule in this feature governs closing a
review, and FR-080 forbids declaring a point with nothing registered against it. When a rule wants it — "you
cannot close a review with unwalked projects" — the point is added then.
