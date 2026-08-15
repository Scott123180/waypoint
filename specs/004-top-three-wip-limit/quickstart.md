# Quickstart: Weekly Top Three and WIP Limit

**Feature**: 004-top-three-wip-limit | **Date**: 2026-08-14

How to run and validate this feature. Shapes and rules live in [data-model.md](./data-model.md) and
[contracts/](./contracts/); this file is the run guide.

---

## Prerequisites

```bash
nvm use                 # .nvmrc pins Node 22; the system node is stale
npm install             # Ubuntu build machine only — never the work MacBook
```

No new dependencies are added by this feature. If `npm install` wants to add one, something has gone wrong
— ISO week computation is written in-repo on purpose (research R1).

## Running the suites

```bash
npm run test:core       # fastest loop while building core
npm test                # everything, TZ=America/New_York
npm run typecheck
```

`TZ=America/New_York` is already pinned in the `test` script and is **load-bearing** here: "which week is
it" is a question about the user's local midnight. A run under UTC places Sunday-evening dates in the
following week and will fail the boundary table.

## The four gates

These are the checks that would catch this feature going wrong. Run them in this order — the migration gate
first, because it is the only one that can break shipped behavior.

### 1. Migration equivalence — Feature 3's suites, unedited

```bash
npm run test:core
git status --porcelain packages/core/tests/    # MUST be empty
```

The second command is the real assertion. Feature 3's test files must be **byte-for-byte unmodified**. If a
test needed editing to pass, the migration is wrong and the test is right (FR-062b).

Boundary behavior, asserted explicitly before and after the move:

| Input | Expected |
|---|---|
| 3 milestones, add a 4th | accepted silently |
| 4 milestones, add a 5th | refused, `milestone-cap` |
| mark done, 0 open | no confirmation |
| mark done, ≥1 open | confirmation naming them |

The silent rows matter as much as the refusing ones — a relocated rule that starts firing *more* is drift a
cap test alone would not notice.

### 2. Read count — the quadratic guard

```bash
node --test packages/core/dist/tests/identity-read-count.test.js
```

Asserts a 100-project list issues exactly 100 project reads. **Counting, not timing** — a timing test
passes on fast hardware even when the implementation is quadratic, so it would not catch the regression it
exists to catch (SC-016c). The 100 ms budget test runs too, but the read count is the gate.

### 3. Identity matrix — the never-guess rule

```bash
node --test packages/core/dist/tests/identity-resolve.test.js
```

A table with no fakes, because `resolveDri` is pure. Two halves:

- **Formatting variants all resolve `mine`** — case, surrounding whitespace, collapsed internal runs,
  trailing period.
- **Shorter/longer pairs all resolve `theirs`** — no prefix, initial, first-name, substring, or fuzzy match
  ever succeeds (FR-026, SC-006). This half is a prohibition; if any row flips to `mine`, identity is being
  inferred and the feature is misattributing work.

### 4. Byte-for-byte preservation

```bash
node --test packages/core/dist/tests/top-three-preservation.test.js
```

Setting a new week leaves every prior week's bytes untouched (FR-011), and a cancelled write leaves the
whole file untouched (FR-015b).

## Manual validation

```bash
npm run dev
```

### Top three, from nothing

1. Open the top-three window. Empty current week, no error, an invitation to set one.
2. Add one outcome → saved, valid at one. Add two more.
3. Add a fourth → refused, states the maximum, existing three unchanged.
4. Mark one done → date recorded. Unmark → date gone.
5. Open `<vault>/top-three.md` in an editor. It reads the way a project file reads.

### Concurrent hand-edit

1. With the week open, reword an outcome in a text editor and save.
2. In the app, edit **that same** outcome → cancelled, file unchanged, week re-presented as it now reads.
3. Reword a *different* outcome in the editor; edit your original in the app → **succeeds**, and the
   hand-edit survives (FR-015c).

### Identity and the WIP limit

1. Create `<vault>/identity.md` with `me: <your name>` and any aliases.
2. The project list now shows which projects are yours, which need a DRI, and any ambiguous ones.
3. Set three of your own projects to active. Try a fourth → refused, naming the three to finish or park.
4. Park one, retry → succeeds.
5. Set ten projects owned by other people to active → zero refusals, zero warnings.
6. Delete `identity.md` → the limit stops firing entirely, and the app says identity is not configured
   rather than implying nothing is yours.

### Configuration travels with the data

1. Create `<vault>/policy.md` with `wip limit: 2`.
2. Restart. The refusal now fires at the third project, with no application change (FR-058).
3. Put garbage in `milestone cap`. The default of 4 applies, the problem is surfaced, and **nothing is
   blocked** — including the WIP limit, which still reads 2 (FR-060).

### Live view updates

With the top-three window open, edit `top-three.md` by hand. The view reflects it without a reopen — the
existing `vault:changed` signal, raised from the vault adapter's write path, needs no new wiring
(research R9).

## What is deliberately absent

No weekly review ritual, no retrospective view, no local API, no AI-assisted suggestions, no person or
contact entity, and no migration of any existing project file. If a change starts to need one of these, it
belongs to a later feature.

## Packaging

Unchanged. macOS builds are produced by GitHub Actions on a macOS runner and shipped as release artifacts;
the work machine only downloads finished builds and never runs an install or a compile.
