# Research: Weekly Top Three and WIP Limit

**Feature**: 004-top-three-wip-limit | **Date**: 2026-08-14

Decisions taken before design, each with what was rejected. Feature 3's `research.md` is the model: the
value is in the rejected alternatives, because those are what a reader six months from now will otherwise
re-propose.

---

## R1 — ISO week computation, written rather than depended on

**Decision**: Implement `isoWeek(date: Date): string` in `packages/core/src/weekly/iso-week.ts`, returning
`YYYY-Www`. The algorithm is the standard one: take the local date, shift to the Thursday of that week
(Thursday is what fixes the year), then count weeks from 4 January of that Thursday's year.

**Rationale**: It is roughly fifteen lines of arithmetic with no branches worth fearing, and it is
exhaustively testable — a table of dates spanning several year boundaries, a 53-week year (2026 has 53
ISO weeks; 2020 and 2015 do too), and both drift directions. Against that, any dependency is a supply-chain
surface, a bundle cost, and a thing to keep updated, for logic that will never change: ISO-8601 is frozen.
The user asked for no new dependencies and this is well inside what that can mean.

**Alternatives considered**:

- **`Intl.DateTimeFormat` with `week` field** — not supported. There is no week field in the ECMA-402
  formatting surface; the `weekInfo` locale API answers a different question (which day a locale considers
  the week's start) and would make the identifier locale-dependent, which is precisely wrong for a stable
  on-disk key.
- **`Temporal.PlainDate.prototype.weekOfYear`** — this is the right long-term answer and would be a
  two-line implementation. It is not available unflagged on Node 22, and pinning a polyfill is a dependency
  with a much larger surface than the fifteen lines it replaces. Worth revisiting when Temporal ships
  unflagged; the function's signature is designed so the body can be swapped without touching a caller.
- **date-fns / luxon / dayjs** — a dependency measured in tens of kilobytes, for one function, in a project
  whose stated build rule is that the work machine never runs an install.

**Test consequence**: the `test` script already pins `TZ=America/New_York`. That is load-bearing here and
must not be relaxed — "which week is it" is a question about the user's local midnight, and a test run in
UTC would place late-Sunday-evening dates in the following week.

---

## R2 — The seam is a port; the default module is a sibling directory

**Decision**: `PolicyModule` and the decision types are declared in `packages/core/src/ports/index.ts`.
The single default implementation lives in `packages/core/src/policy/`, a module directory alongside
`projects/` and `sort/`. It is not a separate npm workspace package.

**Rationale**: `ports/index.ts` already carries the exact meaning needed — "ports the core depends on,
implemented by the client/adapter layer and injected in. The core owns the rules; adapters own the I/O."
A policy module is that shape precisely: core declares the interface and the call sites, someone else
supplies the behavior. Putting it anywhere else would invent a second concept for a thing the codebase
already has a home for.

The package split was rejected on a hard technical ground, not a preference — see R3.

**What keeps the boundary real without a package**: a test asserting import direction. `projects/` and
`weekly/` may import from `ports/` but must not import from `policy/` except the single
`createDefaultPolicy` factory; `policy/` may import domain types but must not import a service. This is
checked by reading the source files and matching imports — cheap, and it fails loudly the first time
someone reaches across. The directory is extractable to `packages/policy` later as a mechanical move, at
the point the extension interface is deliberately published (which the constitution says is not now).

**Alternatives considered**:

- **`packages/policy` workspace** — see R3; creates a cycle or reintroduces bypassability.
- **Policy as a wrapper around core** — explicitly rejected by the roadmap and the constitution: a layer
  above core is bypassable by anything calling core directly, which is exactly what Feature 7's API and
  Feature 8's LLM layer do.

---

## R3 — The default module is the default dependency

**Decision**: `ProjectServiceDeps.policy` is optional. When absent, the service constructs the default
module over the same vault. Same for `TopThreeService`.

**Rationale**: This is what makes the migration provably behavior-preserving. Feature 3's suites do
`new ProjectService({ vault, clock })` and assert a refused fifth milestone and a confirmation on open
milestones. FR-062b forbids editing them. With the default module as the default dependency, and with
absent `policy.md` producing defaults numerically identical to Feature 3's shipped constants
(`MILESTONE_CAP = 4`), every one of those tests exercises the relocated rule through the seam and passes
unmodified. The migration's correctness is then a property of the test suite that already exists, rather
than something a reviewer has to eyeball.

It also closes the bypass Principle V cares about: a caller cannot get an unpoliced service by forgetting
to pass a module. Forgetting yields the default, not permissiveness.

**Alternatives considered**:

- **Required dependency** — every existing call site edited, including the tests that are the migration's
  own proof. Self-defeating.
- **No-op default** — turns "no policy injected" into "no rules", which is a silent behavior change for
  every existing caller and the exact bypass the principle forbids.

---

## R4 — Decision context is lazy

**Decision**: Each decision point receives a context object whose cheap facts are values and whose
expensive facts are zero-argument functions returning promises. For the status-change point:

```
{ project, from, to, driResolution, activeProjectsDrivenByUser: () => Promise<ProjectSummary[]> }
```

**Rationale**: Two constraints pull against each other. Core must not know what a rule needs — so it cannot
compute the WIP count only when the target status is `active`, because "only when active" *is* the rule.
But eagerly listing every project on every status change would make parking a project as expensive as
rendering the whole list, for the benefit of a rule that will not even look.

A lazy accessor satisfies both. Core offers the capability unconditionally; the module decides whether to
pay for it. Core still knows nothing about the rule, and the cost lands only where a rule actually asks.
The WIP rule calls the accessor only when `to === "active"`; the milestone cap never calls anything.

**Alternatives considered**:

- **Eager context** — correct but wasteful, and the waste is on a write path the user feels.
- **Policy given the whole `ProjectService`** — hands a rule the ability to write, inverts the dependency,
  and makes every rule a potential mutation. A rule answers a question; it does not act.
- **Policy given the `VaultStore`** — a rule would then re-read and re-parse files core has already parsed,
  duplicating the read path and putting identity resolution inside policy, which the spec forbids (FR-053).

---

## R5 — One file for all weeks, milestone-shaped lines

**Decision**: `top-three.md` at the vault root. One `## YYYY-Www` section per week, newest first. Each
outcome is a line in the established milestone shape: `- [ ] text` / `- [x] text — done YYYY-MM-DD`.

**Rationale**: History stays together and greppable — `grep -A4 '## 2026-W' top-three.md` is the whole
retrospective, with no application running. Growth is ~52 short sections a year, so a per-week file would
be hundreds of files for no benefit. Newest-first means the current week is at the top of the file, which
is where a user opening it in an editor wants it.

Reusing the milestone line shape is the Principle VII argument made concrete: the user already knows what
`- [x] … — done 2026-08-14` means, and `parseMilestone`/`renderMilestone`'s right-to-left tail parsing
already handles text containing `—`. The verifier tail is simply never emitted for an outcome.

**Alternatives considered**:

- **`log/YYYY-WW.md`, folded into the weekly log** — that file is Feature 5's, and this feature explicitly
  excludes the review ritual. Writing into it now would mean Feature 5 inherits a format it did not choose
  and cannot change without a migration.
- **One file per week** — hundreds of files, and "look back at what I committed to" becomes a directory
  listing instead of a scroll.
- **A structured format (YAML/JSON) for the entries** — the constitution permits it, but it would be the
  only place in the vault where a checkbox is not a checkbox, and the user marks these done by hand as
  often as through the app.

**Note on the roadmap's `log/YYYY-WW.md`**: the identifier here is `YYYY-Www` (`2026-W33`). Reconciling the
log filename spelling is Feature 5's to settle; what this feature fixes is the week *computation*, which
both must share (FR-003c).

---

## R6 — One pass over the vault, verified by counting reads

**Decision**: `list()` parses every project once into an array, derives the name corpus from that array,
then maps each parsed project to a summary carrying its resolution. `get(slug)` for a resolution-bearing
read builds the corpus the same way, from one pass. No caching, no memoization, no invalidation.

**Rationale**: Ambiguity needs vault-wide input, which is the first time a derived per-project value has
depended on other projects. The naive shape — `list()` mapping over slugs and each summary resolving
itself — re-reads every file for every project, turning a 100-file read into 10,000. That would blow
Feature 3's 100 ms budget, and the tempting fix (cache the corpus) is exactly the stored derived state
Feature 3's research R5 rules out, because it drifts the moment the user edits a file in vim.

The honest fix is structural: read once, derive twice from the same array.

**Verification**: `FakeVaultStore` gains a `readLog` (additive — no behavior change, so Feature 3's tests
are unaffected), and the test asserts `readLog.length === 100` for a 100-project list. Counting rather than
timing is deliberate: a timing test passes on fast hardware even when the implementation is quadratic, so
it would not catch the regression it exists to catch. The 100 ms budget test is kept as well, but the read
count is the real gate.

**Cost accepted**: opening one project reads the whole vault, because ambiguity cannot be answered from one
file. This was the explicit answer to clarification Q3 — a single-project view and the list must not
disagree. For a vault of hundreds of small markdown files this is milliseconds, and it is measured
(SC-016b).

---

## R7 — Ambiguity as a leading-word collision

**Decision**: Normalize every name to a lowercase, space-collapsed, trailing-period-stripped word list.
A DRI that matches an identity value is **ambiguous** when some other distinct name in the corpus has that
value's word list as a strict prefix of its own.

`scott` vs `scott r` → ambiguous. `scott rodgers` vs `scott` → not (the corpus name is shorter, so the
match is not the ambiguous-shorter-form case). `scott` vs `scottie` → not (word-level, not character-level).

**Rationale**: This is the operational form of "two different people on my team can share a first name". It
is decidable, cheap, order-independent, and — critically — it never *resolves* anything. It only demotes a
confident match to "ask a human". Every other approach in this space guesses at identity, which FR-026
forbids outright.

Names matching an identity value are excluded from the corpus as evidence against themselves (FR-028c), so
the user appearing as their own verifier is not treated as a second person.

**Alternatives considered**:

- **Character-prefix matching** — `scott` would collide with `scottie`, a different person by any reading.
- **Edit distance / fuzzy matching** — explicitly forbidden by FR-026, and it fails the same way in both
  directions: it merges distinct people and splits the same person unpredictably.
- **Initial expansion (`Scott R.` ≈ `Scott Rodgers`)** — this is inference, and it is the exact
  misattribution the whole design exists to prevent.

---

## R8 — Entry identity for verify-before-write

**Decision**: A top-three outcome is identified by `{ week, index, raw }` — the deliberate analogue of
`MilestoneRef { index, raw }`. Verification compares the raw line at that index within that week's section.

**Rationale**: Feature 3 settled this precedent and the reasoning transfers unchanged: no id is embedded in
the file, because machine bookkeeping does not belong in a document whose promise is hand-editability. A
reworded entry fails verification rather than being written over. Scoping to the entry rather than the week
(FR-015c) follows Feature 3's field-level choice for the same reason — cancelling an edit to outcome one
because outcome three changed is a refusal the user cannot act on.

Writes are surgical, reusing the `setMilestoneLines` pattern: only the lines of the section being changed
are touched, everything else reproduced byte for byte, so the git diff shows what the user did and nothing
else.

---

## R9 — The change signal already exists and needs no new concept

**Decision**: Reuse `VaultChanged`. No new emitter, no new channel name.

**Rationale**: `main.ts` constructs `new FsVaultStore(config.vaultRoot, () => vaultChanged.raise())` — the
signal is raised in the adapter's **write path**, not in an IPC handler. Because `top-three.md`,
`identity.md`, and `policy.md` are written through that same `VaultStore`, every top-three write raises
`vault:changed` with no new wiring at all. This is also why it works across windows: a write from any
window, or from a future API client sharing the adapter, is noticed.

`VaultChanged`'s own doc comment already frames it as "a project or area file changed — the fact, never the
cause", which is the generic-signal discipline Feature 2 established. A `topThreeChanged` emitter would be
a signal named for its cause, and would need every writer to remember to raise it.

**Consequence accepted**: the projects window will re-render on a top-three write and vice versa. For a
local single-user app with sub-millisecond re-reads this is the cheap side of the trade; the expensive side
would be windows showing stale data.

---

## R10 — Configuration absence is the normal case

**Decision**: All three new files are optional. `VaultStore.read` already returns `null` when a file is
absent, which maps directly onto "use documented defaults". No file is ever created unasked. A malformed or
out-of-range value falls back to the default for that value alone and surfaces a notice; it never blocks.

Defaults: WIP limit **3**, milestone cap **4** (Feature 3's shipped constant), weekly outcome cap **3**.

**Rationale**: Every existing vault on disk has none of these files, and Feature 3's ~60 test vaults have
none either. Absence must therefore be the well-trodden path, not an error branch. Making defaults
identical to Feature 3's constants is what makes the whole migration a no-op for existing data.

Per-value fallback rather than whole-file rejection matters: a typo in the WIP limit should not silently
restore a milestone cap of four when the user had deliberately set six.

**Identity is different in one respect**: absent `identity.md` means *no project resolves to the user*, and
the WIP limit cannot fire (FR-049). That is not a default value — it is the honest answer to "who are you?"
when nobody has said. It is surfaced plainly so the user can tell configuration is missing from the limit
being satisfied (FR-031).

---

## R11 — Where the over-limit state surfaces

**Decision**: `ProjectService.list()` summaries carry each project's resolution and needs-DRI flag. A
separate core query answers "how many active projects is the user driving, and what is the limit" for the
project list header. Nothing recalculates this in the renderer.

**Rationale**: FR-050 requires an over-limit state reached by hand-editing to be shown and not corrected.
Since the limit is policy and the count is core, the count is core's to expose and the comparison is
policy's to make — the renderer receives a finished answer. A renderer computing `count > limit` would be
a client holding a rule, which Principle II forbids and which the future API would have to reimplement to
agree.
