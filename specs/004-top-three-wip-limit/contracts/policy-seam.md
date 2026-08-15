# Contract: The Policy Seam

**Location**: `packages/core/src/ports/index.ts` (interface), `packages/core/src/policy/` (default module)
| **Feature**: 004-top-three-wip-limit

**This interface is internal.** It is not exported from `@waypoint/core`'s public surface as an extension
point, there is no loader, no discovery, and no documented way for a third party to register a module
(FR-064). It is written down here so it can be used deliberately inside the project, not so it can be
depended on from outside. Publishing it is a promise that is expensive to take back.

---

## The three decision points

Exactly three, and no others (FR-063a). Core knows these names and where they are consulted; it does not
know what any rule does.

| Point | Consulted in | Before |
|---|---|---|
| `project.status.change` | `ProjectService.setStatus`, `complete`, `reopen` | a project's status changes |
| `project.milestone.add` | `ProjectService.addMilestone` | a milestone is added |
| `week.outcome.record` | `TopThreeService.addOutcome` | a weekly outcome is recorded |

A decision point with no rule registered against it must not be declared speculatively. When a future
feature needs a fourth, it adds it then.

## The interface

```ts
export interface PolicyModule {
  decide(point: DecisionPoint, context: DecisionContext): Promise<Decision>;
}

export type DecisionPoint =
  | "project.status.change"
  | "project.milestone.add"
  | "week.outcome.record";

export type DecisionVerdict = "allow" | "warn" | "block";

export interface Decision {
  verdict: DecisionVerdict;
  /** Written for the user, complete enough to display unmodified. "" when allow. */
  reason: string;
  /** Named items to act on — projects to park, milestones still open. */
  subjects?: string[];
}
```

### Context, per point

Expensive facts are functions; cheap ones are values. Core offers the capability, the rule decides whether
to pay for it (research R4).

```ts
export type DecisionContext =
  | StatusChangeContext
  | MilestoneAddContext
  | OutcomeRecordContext;

export interface StatusChangeContext {
  point: "project.status.change";
  project: Project;
  from: ProjectStatus;
  to: ProjectStatus;
  /** Resolved by core. Policy never resolves identity itself (FR-053). */
  dri: ResolvedDri;
  /** Active projects whose DRI resolves to "mine". Excludes `project` itself. */
  activeProjectsDrivenByUser: () => Promise<ProjectSummary[]>;
}

export interface MilestoneAddContext {
  point: "project.milestone.add";
  project: Project;
  /** Current count, so the rule does not walk the array itself. */
  milestoneCount: number;
}

export interface OutcomeRecordContext {
  point: "week.outcome.record";
  week: WeekId;
  outcomeCount: number;
}
```

`activeProjectsDrivenByUser` **excludes the project being changed**. Without that, a project already
`active` being re-set to `active` would count itself and refuse at the limit rather than above it.

## How core consults

```ts
const decision = await this.policy.decide("project.milestone.add", { ... });
if (decision.verdict === "block") {
  return { ok: false, reason: "milestone-cap", message: decision.reason };
}
```

Rules core follows and must not deviate from:

- **`block` stops the write.** Nothing is touched, and the refusal carries `decision.reason` verbatim —
  core never rewrites, prefixes, or summarizes a reason it did not author.
- **`warn` requires confirmation.** The verb returns a refusal the caller can retry with an explicit
  confirmation flag; the second call passes the same point with the same context and honors the
  confirmation rather than re-asking. This is exactly Feature 3's `open-milestones` shape, preserved.
- **`allow` proceeds silently.** No notice, no log, no interruption.
- **Core does not interpret `reason` or `subjects`.** They pass through to the client untouched.
- **Core consults before writing, never after.** A decision on stale state is not a decision.

## Registration

```ts
export interface ProjectServiceDeps {
  vault: VaultStore;
  clock?: Clock;
  /** Defaults to the single shipped module (research R3). */
  policy?: PolicyModule;
}
```

Absent means **the default module**, not "no rules". This is load-bearing twice over: it keeps Feature 3's
~60 test files passing unmodified (FR-062b), and it means a caller cannot obtain an unpoliced service by
forgetting an argument — which is the bypass Principle V exists to prevent.

## The default module

`packages/core/src/policy/default-policy.ts`. One module, three rules.

| Rule | Point | Verdict | Config | Default |
|---|---|---|---|---|
| WIP limit | `project.status.change` | `block` | `wip limit` | 3 |
| Milestone cap | `project.milestone.add` | `block` | `milestone cap` | 4 |
| Weekly outcome cap | `week.outcome.record` | `block` | `weekly outcome cap` | 3 |
| Open-milestone confirmation | `project.status.change` | `warn` | — | always on |

### WIP limit

Fires only when **all** of: `to === "active"`, `from !== "active"`, `dri.resolution === "mine"`, and the
count of active projects driven by the user is at or above the limit.

`theirs`, `unassigned`, and `ambiguous` never count (FR-040 through FR-042). No identity configured means
no project resolves to `mine`, so the rule cannot fire (FR-049).

```
verdict: "block"
reason:  "You are already driving 3 active projects and your limit is 3.
          Finish or park one of these first."
subjects: ["Roof repair", "Q3 hiring plan", "Migrate the build"]
```

The rule reads the limit from config and the count from the lazy accessor. It never writes, never changes a
status to make room, and never re-runs itself (FR-051).

### Open-milestone confirmation

Fires when `to === "done"` and any milestone is open. `warn`, never `block` — a hard refusal would be
routed around by deleting the milestone, destroying its record. `subjects` carries the open milestones'
definitions of done, which is what Feature 3's `open` field carried; the field is renamed at the seam but
the user-visible message and the confirmation flow are byte-identical.

### The client-facing shape is frozen

The seam's vocabulary (`warn`, `subjects`) is internal. What reaches a client must not change:

| Seam | Translated by core into | Consumed at |
|---|---|---|
| `{ verdict: "warn", reason, subjects }` at `project.status.change` when `to === "done"` | `{ ok: false, reason: "open-milestones", message, open: subjects }` | `renderer/projects.ts:630`, `preload.ts:279` |
| `{ verdict: "block", reason }` at `project.milestone.add` | `{ ok: false, reason: "milestone-cap", message }` | renderer error line |
| `{ verdict: "block", reason, subjects }` at `project.status.change` when `to === "active"` | `{ ok: false, reason: "wip-limit", message, subjects }` — **new field, not `open`** | renderer refusal panel |

The renderer branches on the literal string `"open-milestones"` and reads `outcome.open`. If either is
renamed, the confirmation dialog stops appearing and completing a project with open milestones silently
succeeds — a behavior change no core test would catch, because every core test asserts on the refusal value
rather than on the dialog. A desktop-level test covers this path.

**The WIP refusal must not reuse `open`.** `open` means "the still-open milestones" and nothing else. A
client that already renders `open` as a confirmation list would render a WIP block as an open-milestone
confirmation — offering to complete a project the user was trying to activate. `ProjectOutcome` therefore
carries a separate `subjects` field ([data-model.md](../data-model.md)). Two meanings, two fields; the
seam's internal `subjects` maps to `open` for the milestone warning and to `subjects` for the WIP block.

### Migration equivalence

The two relocated rules must fire on exactly the same inputs as before (FR-062a). The boundaries asserted
before the move and re-asserted after, with the pre-move tests unedited:

| Input | Verdict | Was |
|---|---|---|
| 3 milestones, add a 4th | `allow` | accepted silently |
| 4 milestones, add a 5th | `block` | `milestone-cap` refusal |
| done, 0 milestones open | `allow` | no confirmation |
| done, ≥1 milestone open | `warn` | confirmation naming them |

If a Feature 3 test needs editing to pass, the migration is wrong and the test is right (FR-062b).

## Configuration

`policy.md`, vault root. Absent, malformed, or out-of-range values fall back **per value**, so one typo
cannot silently reset a different rule. A configuration problem is surfaced and never blocks (FR-060).
Format in [data-files.md](./data-files.md).

## Import direction

Enforced by a test that reads the source and matches import statements:

- `policy/` may import domain types and `ports/`. It must not import a service.
- `projects/` and `weekly/` may import `ports/`. They must not import `policy/`, except the single
  `createDefaultPolicy` factory used as a constructor default.
- `identity/` must not import `policy/` at all — the direction that lets Feature 5 and Feature 6 use
  identity without depending on policy (FR-053).

This is what makes the boundary real without a third workspace package, and what makes a later extraction
to `packages/policy` a mechanical move.
