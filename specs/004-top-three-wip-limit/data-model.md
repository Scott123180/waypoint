# Data Model: Weekly Top Three and WIP Limit

**Feature**: 004-top-three-wip-limit | **Date**: 2026-08-14

Shapes only — plain data produced by parsing and consumed by pure functions, which is what keeps the rules
testable without a filesystem. Follows `packages/core/src/projects/types.ts` in style and in discipline:
absent has exactly one representation (`null`, never `""`), and nothing derived is stored.

---

## Identity

```ts
/** Who the user is, as configured in the vault. Read by core, never by policy. */
export interface Identity {
  /** The canonical spelling. null when identity.md is absent or names none. */
  canonical: string | null;
  /** Other spellings the user has deliberately claimed. File order, duplicates kept. */
  aliases: string[];
}
```

`canonical: null` is the "not configured" state and is meaningfully different from an empty alias list: it
means no DRI can resolve to the user at all (FR-031), which is what disables the WIP limit (FR-049).

```ts
/**
 * What a DRI value turns out to be. Exactly four possibilities (FR-021).
 *
 * These literals are the spec's four answers under their internal names:
 * `mine` is "the user's", `theirs` is "someone else's". They are never
 * displayed — a client renders a phrase core gives it — so the short forms
 * cost nothing and read better at every call site.
 */
export type DriResolution =
  /** Matches the canonical value or an alias, with no collision. */
  | "mine"
  /** A name, but not one of the user's. */
  | "theirs"
  /** No DRI on the project at all. Not the same as "not the user's" (FR-041). */
  | "unassigned"
  /** Matches an identity value but collides with a distinct longer name (FR-028). */
  | "ambiguous";
```

```ts
/** A resolution plus the evidence, so a client can explain an ambiguous one. */
export interface ResolvedDri {
  resolution: DriResolution;
  /** The DRI exactly as written in the file. null when unassigned. */
  raw: string | null;
  /**
   * Present only when `resolution === "ambiguous"`: the other names, as written,
   * that this value could also refer to. Never empty when present (FR-029).
   */
  collidesWith?: string[];
}
```

### The name corpus

Not a stored entity — an intermediate value built per read operation and discarded (FR-020b).

```ts
/** Every distinct person name on the projects, with its normalized form. */
export type NameCorpus = ReadonlyArray<{ raw: string; words: string[] }>;
```

Built from DRI values **and** milestone verifier values across all parsed projects (FR-028a). Nothing else:
no inbox, no `waiting.md`, no areas — areas have no DRI (FR-037).

### Normalization

Formatting only, never identity (FR-022 through FR-026):

| Rule | Effect | FR |
|---|---|---|
| Lowercase | `Scott` ≡ `scott` | FR-022 |
| Trim ends | `  Scott  ` ≡ `Scott` | FR-023 |
| Collapse internal runs of whitespace | `Scott   Rodgers` ≡ `Scott Rodgers` | FR-024 |
| Strip one trailing period | `Scott R.` ≡ `Scott R` | FR-025 |

The result is a **word list**, not a string, because ambiguity is a word-boundary question (R7). A name
normalizing to zero words (blank, or `.` alone) is treated as absent, not as a name.

**What normalization must never do**: stem, expand initials, drop middle names, compare by edit distance,
or match on prefixes. FR-026 is a prohibition, and the test suite asserts it as one — a fixture of
shorter/longer pairs that must all resolve to `theirs`.

---

## Weekly top three

```ts
/** ISO-8601 week identifier, `YYYY-Www` — e.g. "2026-W33" (FR-003, FR-003a). */
export type WeekId = string;

/** One outcome the user committed to. */
export interface Outcome {
  /** Position within its week, 0-based. Part of its identity. */
  index: number;
  /** Verbatim as typed. Never generated or suggested (FR-016). */
  text: string;
  done: boolean;
  /** Local calendar date, present iff `done` (FR-009, FR-010). */
  completedOn: string | null;
  /** The full source line, for verification on write. */
  raw: string;
}

/** One week's commitment. */
export interface Week {
  id: WeekId;
  /** File order, which is entry order. */
  outcomes: Outcome[];
  /** True when this is the week the clock is currently in. Derived, never stored. */
  current: boolean;
}

/**
 * An outcome's identity: week, position, and text.
 *
 * The analogue of `MilestoneRef`. No id is embedded in the file — machine
 * bookkeeping does not belong in a hand-editable document (R8).
 */
export interface OutcomeRef {
  week: WeekId;
  index: number;
  /** The line exactly as the caller was shown it. */
  raw: string;
}
```

### State transitions

An outcome has one axis of state, and both directions are user-driven:

```
  not done  ──  complete(ref)  ──▶  done, completedOn = today
      ▲                                      │
      └──────────  reopen(ref)  ─────────────┘
                 (completedOn → null)
```

A week has no lifecycle of its own. It is *current* or *past*, and that is a function of the clock, not a
stored status — so no transition ever needs to be written, and a week cannot be left in a stale state by an
app that was closed over a weekend. Past weeks are read-only through the application (FR-013) and remain
hand-editable on disk.

### Validation rules

| Rule | Where enforced | FR |
|---|---|---|
| At least one outcome is a valid week | Nowhere — no minimum is enforced | FR-001 |
| At most the configured maximum (default 3) | **Policy**, at the `before-outcome-recorded` point | FR-004, FR-063 |
| Text must be non-empty after trimming | Core, `TopThreeService` | FR-005 |
| A hand-edited week over the cap is displayed as-is | Core, on read — the cap governs writes only | FR-015 |
| `completedOn` present iff `done` | Core, by construction in render | FR-009, FR-010 |

---

## Policy

```ts
/** The closed set of decisions. Nothing else is representable (FR-055). */
export type DecisionVerdict = "allow" | "warn" | "block";

export interface Decision {
  verdict: DecisionVerdict;
  /** Displayable, complete, and written for the user. Empty only when allow. */
  reason: string;
  /**
   * Named items the user would act on — the projects to finish or park, the
   * milestones still open. Lets a client render remediation without computing it
   * (FR-046).
   */
  subjects?: string[];
}
```

```ts
/** The values the default module enforces. Absent file → all defaults (FR-059). */
export interface PolicyConfig {
  /** Active projects the user may drive at once. Default 3. Zero is valid (FR-044). */
  wipLimit: number;
  /** Milestones per project. Default 4 — Feature 3's shipped constant (FR-061). */
  milestoneCap: number;
  /** Outcomes per week. Default 3 (FR-063). */
  weeklyOutcomeCap: number;
}
```

Each value falls back independently when malformed or out of range, so one typo cannot silently reset
another rule (R10). Out of range means negative or non-integer; zero is in range for all three and is
honored rather than corrected.

---

## Changes to existing types

Additive only. No existing field changes meaning, and no project file is rewritten.

```ts
// projects/types.ts

/** ProjectSummary gains two derived fields, computed per read, never stored. */
export interface ProjectSummary {
  // ... existing: slug, title, status, milestonesDone, milestonesTotal, gaps, completedOn
  /** Who the DRI is, relative to the user (FR-020a). */
  dri: ResolvedDri;
  /** No DRI named. Its own signal, deliberately NOT a StructureGap (FR-033). */
  needsDri: boolean;
}

/** One new refusal reason joins the existing union. */
export type RefusalReason =
  | /* ...existing... */
  /** The WIP limit would be exceeded; `subjects` names what to finish or park. */
  | "wip-limit";

/**
 * ProjectOutcome gains its own carrier for named remediation.
 *
 * Deliberately NOT a reuse of `open`, which means "the still-open milestones"
 * and nothing else (Feature 3, FR-034a). A client already branches on the
 * refusal reason and renders `open` as a confirmation list — overloading it
 * with project titles would let a WIP block render as an open-milestone
 * confirmation. Two meanings, two fields.
 */
export type ProjectOutcome =
  | { ok: true; project: Project }
  | {
      ok: false;
      reason: RefusalReason;
      message: string;
      /** The still-open milestones. Set only for `open-milestones`. */
      open?: string[];
      /** Named items to act on. Set only for `wip-limit` (FR-046). */
      subjects?: string[];
    };
```

`"outcome-cap"` is **not** added here. A week is not a project, and `TopThreeService` has its own
`TopThreeRefusal` union ([top-three-api.md](./contracts/top-three-api.md)). Putting a weekly refusal in the
project union would make it representable in a place it can never occur.

**`StructureGap` is deliberately unchanged.** Adding `"dri"` to it would silently reverse Feature 3's
FR-009 and newly flag every otherwise-complete project with no DRI. `gaps.ts` is not edited by this
feature; `needsDri` is a sibling signal computed alongside it. A regression test asserts a project missing
only a DRI has `gaps: []` and `needsDri: true`.

---

## Relationships

```
identity.md ──▶ Identity ─┐
                          ├──▶ ResolvedDri ──▶ ProjectSummary.dri
projects/*.md ──▶ Project ┤                         │
                  (DRI +  │                         │
                  verifier)└──▶ NameCorpus ─────────┘
                          │
                          └──▶ activeProjectsDrivenByUser() ──▶ WIP decision
                                                                    ▲
policy.md ──▶ PolicyConfig ─────────────────────────────────────────┘

top-three.md ──▶ Week[] ──▶ Outcome ──▶ outcome-cap decision
```

Note the direction that matters for Principle V: identity flows **into** policy and never back out. Policy
consumes `ResolvedDri`; nothing in `identity/` imports from `policy/`. That is what lets Feature 5's review
and Feature 6's retrospective use identity without depending on policy (FR-053).
