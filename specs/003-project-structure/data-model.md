# Phase 1 Data Model: Projects with Milestones

**Feature**: 003-project-structure | **Date**: 2026-08-12

The in-memory shapes the core works with, and the rules that constrain them. The on-disk representation is
[contracts/project-format.md](contracts/project-format.md); the callable surface is
[contracts/projects-api.md](contracts/projects-api.md).

Nothing here is a class with behaviour. These are plain data, produced by parsing a file and consumed by
pure functions — which is what keeps the rules testable without a filesystem.

---

## Project

```ts
interface Project {
  /** Filename stem. The identity used by every verb. */
  slug: string;
  /** The `#` heading, verbatim as typed. Never derived from the slug. */
  title: string;
  status: ProjectStatus;
  /** null when not yet set — never an empty string, so "absent" has one representation. */
  outcome: string | null;
  nextAction: string | null;
  dri: string | null;
  /** Empty when the user has not added any. Order is file order. */
  milestones: Milestone[];
  /** Local date, set only while status is `done`. */
  completedOn: string | null;
  /** Raw items sort left behind, in file order. */
  unprocessed: UnprocessedItem[];
}

type ProjectStatus = "active" | "parked" | "waiting" | "done";
```

| Field | Rule | Source |
|---|---|---|
| `slug` | Non-empty. Unique within `projects/`. Never changes once created — editing the title does not rename the file. | FR-003, spec Assumptions |
| `title` | Non-empty, stored exactly as typed. | FR-003 |
| `status` | Exactly one of the four. Always present; defaults to `active` when the file omits it. | FR-002 |
| `outcome` | Free text, may span lines. No format or length imposed. | FR-006 |
| `nextAction` | Free text, single line. At most one. | FR-007 |
| `dri` | Free text name, may be the user. At most one. Its absence never flags. | FR-008, FR-009 |
| `milestones` | 0–4 through the application; more tolerated when hand-written. | FR-013, FR-013b, FR-014 |
| `completedOn` | Present iff `status === "done"` *and* the project was completed through the app. Cleared on reopen. | FR-034, FR-036 |

**A stub is a Project.** Sort's output — title, `status: active`, nothing else — parses to a `Project` with
three nulls and two empty arrays. There is no separate "unstructured project" type, because that state is
valid rather than exceptional (FR-004).

---

## Milestone

```ts
interface Milestone {
  /** Position in the project, 0-based. Part of its identity — see MilestoneRef. */
  index: number;
  /** What finishing it means. Verbatim. */
  definitionOfDone: string;
  /** Who confirms it. null when not yet named. May be the user. */
  verifier: string | null;
  done: boolean;
  /** Local date, present iff `done`. */
  completedOn: string | null;
  /** The full source line, for verification on write. */
  raw: string;
}
```

| Rule | Reason |
|---|---|
| `definitionOfDone` is required and never inferred from the project's outcome | FR-011 |
| `verifier` may be absent — a milestone can be typed before its verifier is decided | FR-004's partial-fill principle applied within a milestone |
| `completedOn` is set when `done` flips true, cleared when it flips false | FR-033, FR-036 |
| Order is stable and never rearranged by editing, completing, or reopening | FR-015 |
| A milestone marked done is never hidden, moved, or collapsed | FR-035 |

**Identity is position plus text**, not a stored id (research R2):

```ts
interface MilestoneRef {
  index: number;
  /** The line exactly as the caller was shown it. */
  raw: string;
}
```

The deliberate analogue of Feature 2's `ItemRef { start, end, raw }`. A milestone reworded in a text editor
fails verification rather than being written over (FR-045b, FR-045d).

---

## Area

```ts
interface Area {
  slug: string;
  title: string;
  status: AreaStatus;
  unprocessed: UnprocessedItem[];
}

type AreaStatus = "active" | "parked";
```

Structurally incapable of holding an outcome, milestones, a next action, a DRI, or a completion date — not
by validation, but by having nowhere to put them (FR-040, FR-041a). A client cannot ask an `Area` whether it
is complete because the question does not typecheck.

`AreaStatus` is its own type rather than a subset of `ProjectStatus`, so `done` cannot reach an area through
a widening assignment (FR-041).

A hand-edited `status: done` on an area parses to a fourth variant the app displays but never offers
(FR-041c) — carried as the raw string alongside the parsed status rather than coerced to `active`, so
nothing is silently rewritten.

---

## UnprocessedItem

```ts
interface UnprocessedItem {
  /** Item text, verbatim, continuation lines included. */
  text: string;
  /** null for a hand-written item; no date is ever substituted. */
  capturedAt: Date | null;
  /** Position within `## Unprocessed`, 0-based. */
  index: number;
  /** Full source block, for verification on dismissal. */
  raw: string;
}
```

Written by Feature 2, read but never reinterpreted here (FR-046). Reuses the inbox item grammar, so the
same parsing rules apply — a continuation line is indented, a hand-written line has no timestamp.

Dismissing one appends it to `trash.md` in Feature 2's existing line format and removes it from the project
(FR-046b, FR-046d). Nothing converts it into a field (FR-046c).

---

## StructureGaps — derived, never stored

```ts
type StructureGap = "outcome" | "milestones" | "next-action";

function structureGaps(project: Project): StructureGap[];
```

A pure function over a parsed project. Returns the gaps in a fixed order so the UI renders them
consistently; empty means fully structured.

| Rule | Reason |
|---|---|
| Missing `outcome`, zero `milestones`, or missing `nextAction` each produce a gap | FR-018 |
| A missing `dri` produces no gap | FR-009 |
| `status` has no influence — a parked or done project with no outcome still reports one | FR-021 |
| Never persisted to the file, never cached | FR-020, research R5 |
| An `Area` has no equivalent function — the concept does not exist for areas | FR-024 |

Computed on every read, which is what keeps a hand-edit accurate with the app uninvolved.

---

## Outcomes and refusals

Every mutating verb returns a discriminated union rather than throwing, matching Feature 2's `SortOutcome`.
A refusal is an expected branch a caller renders, not an error.

```ts
type ProjectOutcome =
  | { ok: true; project: Project }
  | { ok: false; reason: RefusalReason; message: string; open?: string[] };

type RefusalReason =
  | "not-found"        // the slug no longer exists on disk
  | "field-changed"    // FR-045b — that field changed since it was shown
  | "milestone-cap"    // FR-013 — a fifth milestone
  | "open-milestones"  // FR-034a — needs confirmation, `open` names them
  | "empty-title"      // FR-003
  | "empty-value";     // a milestone with no definition of done
```

`open-milestones` carries the names of the still-open milestones so the client has nothing to compute
(research R8). Every other refusal carries a message the client displays verbatim — refusal wording is
domain vocabulary and belongs in the core (Principle VII).

---

## State transitions

**Project status** — any of the four to any other, at any time (FR-029):

```text
active ⇄ parked
active ⇄ waiting
parked ⇄ waiting
{active|parked|waiting} → done   sets completedOn; needs confirmation if any milestone is open
done → {active|parked|waiting}   clears completedOn; milestone dates untouched (FR-036)
done → done (re-complete)        records the new date, replacing the cleared one (FR-039)
```

The active list is every project whose status is not `done` (FR-032).

**Milestone done state**:

```text
open → done    sets completedOn from the clock, no prompt (FR-033)
done → open    clears completedOn (FR-036)
```

Editing a milestone's text or verifier while it is done leaves `completedOn` untouched (FR-037). Deleting
the milestone discards its date along with it, which is a deliberate destructive edit rather than a breach
of that guarantee (spec Assumptions).

**Area status**: `active ⇄ parked`. No terminal state exists (FR-041a).

---

## What this feature does not model

No person entity — verifiers and DRIs are free-text names with no linkage across projects. No WIP counter,
no top-three, no review record, no retrospective query object. The retrospective will read `completedOn`
fields straight off the project files when it is built (research R10); nothing is stored ahead of it here.
