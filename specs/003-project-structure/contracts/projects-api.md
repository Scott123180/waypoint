# Contract: Core Projects API

**Package**: `@waypoint/core` | **Feature**: 003-project-structure

The complete surface the core exposes for project and area structure. Every rule in the feature spec is
enforced behind this boundary. The Electron GUI now, the local HTTP API in Feature 6, the LLM-assisted
layer in Feature 7, the weekly review in Feature 5, and the retrospective view later all call exactly these
verbs and get identical behaviour (Principles II and VII).

The core imports nothing from Electron and touches no platform globals.

Extends [Feature 2's sort API](../../002-inbox-view-sort/contracts/sort-api.md). **No new ports.**
`VaultStore` and `Clock` are reused exactly as they are (research R6).

---

## Types

See [data-model.md](../data-model.md) for the full shapes and their rules. In brief:

```ts
interface Project {
  slug: string; title: string; status: ProjectStatus;
  outcome: string | null; nextAction: string | null; dri: string | null;
  milestones: Milestone[]; completedOn: string | null;
  unprocessed: UnprocessedItem[];
}

interface Milestone {
  index: number; definitionOfDone: string; verifier: string | null;
  done: boolean; completedOn: string | null; raw: string;
}

interface Area { slug: string; title: string; status: AreaStatus; unprocessed: UnprocessedItem[] }

type ProjectStatus = "active" | "parked" | "waiting" | "done";
type AreaStatus = "active" | "parked";

/** Position plus text. The analogue of Feature 2's ItemRef. */
interface MilestoneRef { index: number; raw: string }

type ProjectOutcome =
  | { ok: true; project: Project }
  | { ok: false; reason: RefusalReason; message: string; open?: string[] };
```

Refusals are **values, not exceptions** — matching `SortOutcome`. A refusal is a branch the caller renders.
`VaultWriteError` is still thrown for a genuine I/O failure, exactly as in Feature 2.

---

## `ProjectService`

```ts
class ProjectService {
  constructor(deps: { vault: VaultStore; clock?: Clock });

  // Reading — every call re-reads from disk, nothing is cached
  list(): Promise<ProjectSummary[]>;
  listActive(): Promise<ProjectSummary[]>;
  get(slug: string): Promise<Project | null>;
  create(title: string): Promise<ProjectOutcome>;

  // Scalar fields — `expected` is the value the caller was shown
  setOutcome(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome>;
  setNextAction(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome>;
  setDri(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome>;
  setTitle(slug: string, expected: string, next: string): Promise<ProjectOutcome>;
  setStatus(slug: string, expected: ProjectStatus, next: ProjectStatus): Promise<ProjectOutcome>;

  // Milestones
  addMilestone(slug: string, definitionOfDone: string, verifier: string | null): Promise<ProjectOutcome>;
  editMilestone(slug: string, ref: MilestoneRef, definitionOfDone: string, verifier: string | null): Promise<ProjectOutcome>;
  removeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome>;
  completeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome>;
  reopenMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome>;

  // Completion
  complete(slug: string, opts?: { confirmOpenMilestones?: boolean }): Promise<ProjectOutcome>;
  reopen(slug: string, to: Exclude<ProjectStatus, "done">): Promise<ProjectOutcome>;

  // Unprocessed
  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<ProjectOutcome>;
}

interface ProjectSummary {
  slug: string; title: string; status: ProjectStatus;
  milestonesDone: number; milestonesTotal: number;
  gaps: StructureGap[];          // empty means fully structured
  completedOn: string | null;
}
```

### Guarantees

1. **Reads are always fresh.** `list()` and `get()` re-read from disk on every call. There is no cursor, no
   cache, and no session — a hand-edit made in a text editor is reflected the next time anything asks
   (FR-020, FR-045).

2. **Which projects are in the active list is decided by the core.** `listActive()` returns exactly the
   projects a client should show as active — every project whose status is not `done` (FR-032). `list()`
   returns *every* project, done ones included, for callers that genuinely need the whole set: Feature 5's
   review and the later retrospective.

   The rule lives here rather than in a client filter because "which projects are active" is a business
   rule, and Principle II puts business rules in the core. A renderer that filtered on `status` itself
   would be holding that rule, and Feature 7's HTTP API would have to reimplement it to agree.

3. **`gaps` is computed, never stored.** Derived from the returned fields themselves, so it cannot disagree
   with them (FR-018, FR-020, research R5).

4. **Every write verifies its own field first.** A mutator re-reads, compares that one field against
   `expected`, and returns `field-changed` without writing if it differs. Changes elsewhere in the file are
   preserved and do not cancel the write (FR-045a–d).

5. **Every write is atomic and byte-preserving.** Whole-file read-modify-write through
   `VaultStore.write` (temp + rename). Only the lines belonging to the changed field are altered; every
   other byte — unknown keys, unknown sections, `## Unprocessed`, the user's own formatting — is reproduced
   exactly (FR-045, FR-046).

6. **No write happens on a read.** Opening a project never rewrites, normalizes, or reorders it. Open and
   close produces no diff (research R3).

7. **`create(title)` produces exactly Feature 2's stub** — title and `status: active`, nothing else — by
   calling the same `renderStub`. A project created here and a project created mid-sort are the same file
   (FR-005). A title matching an existing slug returns that project rather than creating a duplicate.

8. **`addMilestone` refuses at four.** `{ reason: "milestone-cap" }`, existing milestones untouched
   (FR-013). Parsing imposes no cap, so a hand-written fifth or sixth is returned by `get()` in full
   (FR-013b). A milestone with an empty definition of done is refused with `empty-value`.

9. **`complete` refuses with `open-milestones` unless confirmed.** The refusal carries `open: string[]` —
   the definitions of done of the still-open milestones — so the caller has nothing to compute. Calling
   again with `{ confirmOpenMilestones: true }` proceeds, records `completed:` from the clock, and leaves
   the open milestones open with no date invented for them (FR-034a–c). All-done, or no milestones at all,
   requires no confirmation (FR-034d). The structure flag never triggers a confirmation (FR-034e).

10. **Completion dates are set and cleared only by completion verbs.** `completeMilestone` and `complete`
    set them from the `Clock`; `reopenMilestone` and `reopen` clear their own. No other mutator touches a
    date — editing a done milestone's text keeps its date (FR-037). `reopen` clears the project's date and
    leaves every milestone date untouched (FR-036).

11. **Milestone order is stable.** No verb reorders. `removeMilestone` shifts subsequent indices, which is
    why a `MilestoneRef` carries `raw` as well (FR-015).

12. **`dismissUnprocessed` appends to `trash.md` before removing from the project**, so an interrupted
    dismissal leaves a duplicate rather than a loss. No journal (research R9). It never converts the item
    into a field (FR-046c).

13. **Nothing is suggested.** No verb generates, ranks, defaults, or pre-fills an outcome, milestone, next
    action, DRI, or verifier (FR-048).

14. **Nothing is deleted.** There is no verb that removes a project or an area (spec Assumptions).

---

## `AreaService`

```ts
class AreaService {
  constructor(deps: { vault: VaultStore });

  list(): Promise<AreaSummary[]>;
  get(slug: string): Promise<Area | null>;
  create(title: string): Promise<AreaOutcome>;
  setTitle(slug: string, expected: string, next: string): Promise<AreaOutcome>;
  setStatus(slug: string, expected: AreaStatus, next: AreaStatus): Promise<AreaOutcome>;
  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<AreaOutcome>;
}

interface AreaSummary { slug: string; title: string; status: AreaStatus }
```

A separate service rather than a flag on `ProjectService`, because the difference between a project and an
area is the whole point of the distinction. There is **no** `setOutcome`, no milestone verb, no `complete`,
and no `gaps` — an area cannot be asked whether it is structured or finished, because those questions do
not typecheck (FR-024, FR-040, FR-041a).

`AreaStatus` is its own type so `done` cannot reach an area by widening. A hand-edited out-of-range status
is returned as read and never rewritten (FR-041c).

---

## Pure functions (exported for testing and reuse)

```ts
/** Parse a project or area file. Never throws; unknown content is carried. */
function parseProject(content: string, slug: string): Project;
function parseArea(content: string, slug: string): Area;

/** Which of outcome / milestones / next-action are missing. */
function structureGaps(project: Project): StructureGap[];

/** Milestone line rendering and parsing — the format contract in code. */
function renderMilestone(m: Omit<Milestone, "index" | "raw">): string;
function parseMilestone(line: string): Omit<Milestone, "index"> | null;
```

The parse/render pair is the highest-risk code in the feature and is pure by design, so the round-trip
property — `render(parse(x)) === x` for every fixture, and parse-then-render-with-no-edit preserving the
whole file byte for byte — is testable before any service exists (Principle I, research R11).

---

## What the client cannot do

There is no verb to write a project file directly, set a completion date, mark a project done without
passing the confirmation path, or read the incomplete flag from anywhere but a fresh computation. The
client renders what these verbs return and sends back what the user typed. It holds no rule it could get
wrong, which is Principle II made structural rather than aspirational.
