# Contract: Identity Resolution

**Location**: `packages/core/src/identity/` | **Feature**: 004-top-three-wip-limit

Answers one question — *does this DRI refer to the user?* — as a **fact about the data**, derived on every
read and never stored. It lives in core and imports nothing from `policy/`, so Feature 5's review, Feature
6's retrospective, and any future client can use it without depending on the policy module (FR-053).

---

## Public surface

```ts
/** Reads identity.md. Absent file → { canonical: null, aliases: [] } (FR-031). */
export function parseIdentity(content: string | null): Identity;

/** Formatting-only normalization to a word list. Never guesses (FR-022–FR-026). */
export function normalizeName(name: string | null): string[];

/** Distinct person names across parsed projects: DRIs and verifiers (FR-028a). */
export function buildCorpus(projects: readonly Project[]): NameCorpus;

/** The four-way answer, plus collision evidence when ambiguous. */
export function resolveDri(
  dri: string | null,
  identity: Identity,
  corpus: NameCorpus,
): ResolvedDri;
```

`resolveDri` is **pure and synchronous**. It touches no filesystem, which is what makes the whole
normalization and ambiguity matrix testable as a table with no fakes.

## Resolution order

```
1. dri is null, or normalizes to zero words   →  "unassigned"
2. no canonical value configured              →  "theirs"
3. matches canonical or an alias?
     no                                       →  "theirs"
     yes → some other corpus name has this
           word list as a strict prefix?
             yes                              →  "ambiguous" (+ collidesWith)
             no                               →  "mine"
```

Step 2 is the not-configured case and deliberately answers `theirs` rather than `unassigned`: the project
*has* a DRI, it simply is not known to be the user. Conflating the two would make every named project look
unowned when identity is missing, and `unassigned` is the signal that drives "needs a DRI" (FR-032).

## Matching

Equality is on the **normalized word list**, compared element-wise. A match is exact — never a prefix,
never a subset, never fuzzy.

| DRI on disk | Canonical `Scott Rodgers` | Why |
|---|---|---|
| `Scott Rodgers` | `mine` | identical |
| `scott rodgers` | `mine` | case (FR-022) |
| `  Scott Rodgers  ` | `mine` | surrounding whitespace (FR-023) |
| `Scott   Rodgers` | `mine` | collapsed internal runs (FR-024) |
| `Scott Rodgers.` | `mine` | one trailing period (FR-025) |
| `Scott` | `theirs` | **shorter is a different person** (FR-026) |
| `Scott Rodgers Jr` | `theirs` | **longer is a different person** (FR-026) |
| `scottrodgers` | `theirs` | not word-equal |
| `S. Rodgers` | `theirs` | initials are never expanded (FR-026) |
| *(absent)* | `unassigned` | no DRI at all (FR-007 of US2) |

The only way to make a second spelling resolve to the user is to add it to the alias list (FR-027).

## Ambiguity

A matched value is `ambiguous` when some **other distinct** corpus name has the matched word list as a
**strict prefix** (R7).

```
aliases: ["Scott"]          corpus contains "Scott R."
  → DRI "Scott" resolves ambiguous, collidesWith: ["Scott R."]

aliases: ["Scott Rodgers"]  corpus contains "Scott"
  → DRI "Scott Rodgers" resolves mine — the corpus name is shorter, not longer

aliases: ["Scott"]          corpus contains "Scottie"
  → DRI "Scott" resolves mine — word-level, not character-level
```

Names that themselves match an identity value are excluded as evidence (FR-028c) — the user appearing as
their own verifier is not a second person. More than one collision is possible and all are reported
(FR-029).

**Ambiguity never resolves anything.** It only demotes a confident `mine` to "ask a human", and an
ambiguous DRI does not count toward the WIP limit (FR-042), on the same principle that an unknown owner is
not the user.

## The corpus

Built from DRI values and milestone verifier values on **parsed projects only** (FR-028a). Not from
`waiting.md`, not from the inbox, not from areas — areas have no DRI (FR-037, FR-028b).

The corpus is an argument, not a lookup the function performs. That is what keeps `resolveDri` pure, and it
is what forces the caller to have already parsed the projects once — the single-pass discipline that keeps
the list inside its budget (R6). A function that fetched its own corpus would make the quadratic
implementation the easy one to write.

## Integration with `ProjectService`

```ts
async list(): Promise<ProjectSummary[]> {
  // one pass: parse every project exactly once
  const projects = await this.readAllProjects();
  const identity = parseIdentity(await this.vault.read("identity.md"));
  const corpus = buildCorpus(projects);
  return projects.map((p) => summarize(p, resolveDri(p.dri, identity, corpus)));
}
```

`get(slug)` used for a resolution-bearing read follows the same shape, because a single-project view and
the list must not disagree (FR-020a). Opening one project therefore reads the whole vault — the accepted
cost of the clarification Q3 answer, measured at SC-016b.

**Never cached.** No memoization, no invalidation, no stored copy — the reasoning is Feature 3's research
R5 verbatim: stored derived state drifts the first time the user edits a file in vim, which is the exact
scenario the plain-text format exists to support (FR-020b).

## Needs-a-DRI

```ts
/** Its own signal. Deliberately not a StructureGap (FR-033). */
needsDri = resolution === "unassigned";
```

`gaps.ts` is **not edited by this feature**. Adding `"dri"` to `StructureGap` would silently reverse
Feature 3's FR-009 and newly flag every otherwise-complete project without a DRI. A regression test asserts
that a project with an outcome, milestones, and a next action but no DRI has `gaps: []` and
`needsDri: true`.

Informational only. Nothing blocks, gates, or delays on it (FR-035).
