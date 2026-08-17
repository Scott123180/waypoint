# Contract: Retrospective API

**Feature**: 006-retrospective-view | **Date**: 2026-08-16

The core surface, the IPC channels that carry it, and the guarantees each side owes the other. Shapes are
defined in [data-model.md](../data-model.md).

---

## 1. The core surface

`packages/core/src/retrospective/retrospective-service.ts`

### Construction

```ts
/** Just the part of `ProjectService` this reads. */
export interface ProjectSource {
  listDetailed(): Promise<ReadonlyArray<{ project: Project }>>;
}

export interface RetrospectiveServiceDeps {
  projects: ProjectSource;
  /** Read-only by type. No write verb is reachable from here (FR-051, research R1). */
  vault: Pick<VaultStore, "list" | "read">;
}

export class RetrospectiveService {
  constructor(deps: RetrospectiveServiceDeps);
}
```

**Two changes from the pre-implementation draft**, both found by tests and both recorded rather than
back-filled:

- **`projects` is a structural `ProjectSource`, not `Pick<ProjectService, "listDetailed">`.** The `Pick`
  carries `summary` along with `project`, so a test would have had to stand up identity resolution to satisfy
  it. The structural shape also *declares* that only `project` is read. `ProjectService` satisfies it by
  construction, and the no-write guarantee is unchanged — strengthened, if anything, since the type no longer
  names a write-capable class at all. The same discipline `ProjectLike` in `ports/` already follows.
- **There is no `weeks` dependency.** The draft took `Pick<TopThreeService, "history">`, and the read-count
  test caught the consequence: `history()` reads `top-three.md`, and the unreadable-line pass reads it again —
  two reads of one file, which SC-019 forbids. The service now reads it once and parses with the exported,
  total `parseTopThree`. That is also more correct: `history()` inserts the *current* week whether or not the
  file records it, which is a fact about the clock that a retrospective over a past range has no use for.

**No `policy`.** This feature declares no decision point and consults none (FR-058). The dependency is absent
rather than present-and-unused, so "it never asks policy anything" is a fact about the type.

**No `clock`.** Nothing here needs today's date: the endpoints come from the caller, selection compares
against them, and week enumeration derives from the range. An unused dependency accepted "in case" is the same
speculative habit the constitution rejects for decision points (research R11).

**`Pick<VaultStore, "list" | "read">`** is the whole of the guarantee that this feature writes nothing:
`this.vault.write(…)` and `this.vault.appendLine(…)` do not typecheck. SC-004's byte-for-byte assertion is a
regression net over a property the compiler already holds.

### `read`

```ts
read(query: RetrospectiveQuery): Promise<RetrospectiveResult>;
```

The only verb. One call answers one question completely.

**Refuses** — reading nothing and writing nothing:

| `reason` | When | `message` states |
|---|---|---|
| `invalid-date` | Either endpoint is not `YYYY-MM-DD` | which endpoint, and the expected form |
| `range-inverted` | `to < from` as string comparison | both dates, and that the end precedes the start |

`invalid-date` is checked first, so an inverted comparison is never performed on a value that is not a date.

**On success, guarantees:**

1. **Complete.** Every completion in range is present. Nothing is capped, sampled, truncated, or limited to a
   most-recent subset, at any range length (FR-006a).
2. **Deterministic.** Two calls with the same query over unchanged files produce results that render to
   byte-identical strings, including entries sharing a completion date (SC-003, research R8).
3. **Inclusive.** `from` and `to` are both members of the range (FR-001).
4. **Non-inferring.** No date is computed, substituted, or backfilled. A record marked done without a readable
   date lands in `undated` with whatever text was there (FR-016, FR-018, FR-052).
5. **Read-only.** No file is created, modified, or deleted, and no directory is created — including `log/`
   when it is absent (FR-029, FR-051).
6. **Bounded reads.** One read per project file, one `identity.md`, one `top-three.md`, one `list("log")`, and
   one per log file whose week overlaps the range. Nothing reads inside a per-entry loop (SC-019).
7. **Total.** A missing `top-three.md`, a missing `log/`, a missing project directory, an unparseable log, a
   file in `log/` not named for a week, and a malformed date each leave a usable result with the affected
   source named in `unreadable` (FR-020, FR-063).

**Under a project filter** (`query.project !== null`):

- `completions` and `undated` hold that project's milestone completions and its own completion (FR-031)
- `outcomes`, `undatedOutcomes`, and `narrative` are `{ applies: false, reason }`, with `reason` supplied by
  core (FR-032, FR-033)
- `history` is populated from that project's ledger (FR-036)
- A slug with no file yields an empty reading, not a refusal (FR-034)

**Unnarrowed** (`query.project === null`): `history` is `null` — no project history appears anywhere in an
unnarrowed reading (FR-036a, SC-014a).

### `renderReport`

`packages/core/src/retrospective/report.ts`

```ts
export function renderReport(retrospective: Retrospective): string;
```

Pure. No I/O, no clock, no randomness. The complete report body, in the format
[report-format.md](./report-format.md) specifies.

This is **the** rendering. The window displays this string and the export writes this string; there is no
second path from `Retrospective` to text, which is what makes FR-045 an identity rather than a comparison
(research R2). Every count the report prints is computed here from the array it is about to print, so a total
and the list beneath it cannot disagree (FR-010f).

---

## 2. What core does not own

Three things belong to the client, named here so nobody looks for them in core:

- **Holding the reading.** `read` returns a value with no notion of freshness. The window keeps it until the
  user asks for another (FR-010a).
- **The change notice.** Raised by the existing `VaultChanged` emitter in the adapter layer, which already
  fires after any vault write lands, from any window (FR-010b, research R9).
- **Delivering the export.** `clipboard.writeText` and `dialog.showSaveDialog` are Electron APIs; core
  produces bytes and the client places them (FR-050, research R10).

---

## 3. IPC channels

`packages/desktop/src/main/ipc.ts` — `registerRetrospectiveIpc`

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `retrospective:read` | renderer → main | `RetrospectiveQuery` | `RetrospectiveResult` |
| `retrospective:render` | renderer → main | `Retrospective` | `string` |
| `retrospective:copy` | renderer → main | `{ text: string }` | `{ ok: true }` |
| `retrospective:save` | renderer → main | `{ text: string; suggestedName: string }` | `{ saved: boolean; path?: string }` |
| `retrospective:changed` | main → renderer | none | — |
| `projects:list` | renderer → main | none | `ProjectSummary[]` |

Notes on the shape of this table:

- **`retrospective:render` exists so the renderer never re-renders.** The window could hold the structured
  value and format it itself, and that is precisely the second rendering path R2 exists to prevent. The
  renderer asks main for the string and displays it.
- **`retrospective:save` returns `saved: false` when the dialog is cancelled**, which is not an error. The
  default directory is the user's documents directory and is asserted never to be inside the vault root
  (FR-049).
- **`retrospective:changed` carries no payload.** It says a write landed, not what changed — the same
  discipline `VaultChanged` and `InboxChanged` already follow: "the fact, never the cause".
- **`projects:list` is reused, not added.** Both the handler (`ipc.ts`) and the preload bridge already exist.
  The project filter uses the *unfiltered* list rather than `list-active`, because a retrospective is largely
  about finished projects and the active list excludes exactly those.

**No `retrospective:refresh` channel.** Re-reading is `retrospective:read` called again with the same query.
A separate channel would be a second way to do one thing, and would tempt someone to make it re-read
automatically.

---

## 4. Preload surface

`packages/desktop/src/preload/preload.ts` — added to the existing bridge:

```ts
retrospective: {
  read(query: RetrospectiveQuery): Promise<RetrospectiveResult>;
  render(retrospective: Retrospective): Promise<string>;
  copy(text: string): Promise<void>;
  save(text: string, suggestedName: string): Promise<{ saved: boolean; path?: string }>;
  onChanged(listener: () => void): void;
}
```

No write verb crosses the bridge, because there is none to cross.

---

## 5. Public exports from `@waypoint/core`

Added to `packages/core/src/index.ts`:

```ts
export { RetrospectiveService } from "./retrospective/retrospective-service";
export type { RetrospectiveServiceDeps } from "./retrospective/retrospective-service";
export { renderReport } from "./retrospective/report";
export type {
  DateRange, RetrospectiveQuery, Retrospective, RetrospectiveResult, RetrospectiveRefusal,
  Completion, CompletionKind, OutcomeCompletion, OutcomeWeekGroup,
  Narrative, WeekNarrative, UnreviewedWeeks, ProjectScoped,
  ProjectHistory, UnreadableSource,
} from "./retrospective/types";
export { weekEnd } from "./weekly/iso-week";
```

Additive only. No existing export changes signature, and `DECISION_POINTS` is untouched at five.

---

## 6. Vocabulary this feature adds to the core

Per Principle VII, new terms enter the core first and every client inherits them:

| Term | Means |
|---|---|
| **retrospective** | One answer to one date range, read at one moment and held |
| **range** | The start and end dates asked about, both inclusive |
| **reading** | One retrospective as it stood when it was read; what the window holds and the export writes |
| **completion** | Something recorded as finished, with the date recorded against it |
| **undated** | Recorded as finished with no readable date; shown, never placed, never guessed |
| **narrative** | What a week's log says about that week — the note, what slipped, any accepted summary |
| **unreviewed** | A week in range with no log; named, never mistaken for an empty week |
| **history** | A project's ledger, read and shown; no new meaning beyond the one Feature 5 gave it |

No term contradicts an existing one, and none is a synonym for one already in use.
