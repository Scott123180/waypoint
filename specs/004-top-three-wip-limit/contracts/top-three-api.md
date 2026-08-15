# Contract: Top Three API

**Location**: `packages/core/src/weekly/` | **Feature**: 004-top-three-wip-limit

Same two habits as `ProjectService`: every read is fresh, and every write verifies its own entry first.
Refusals are values a caller renders, not errors thrown (FR-015a, FR-015b).

---

## Service

```ts
export interface TopThreeServiceDeps {
  vault: VaultStore;
  clock?: Clock;
  policy?: PolicyModule;   // defaults to the shipped module
}

export class TopThreeService {
  /** The week the clock is in, empty when never set. Never errors (FR-006). */
  current(): Promise<Week>;

  /** Every week on file, newest first, current one included (FR-012). */
  history(): Promise<Week[]>;

  /** Consults `week.outcome.record`; refuses `outcome-cap` at the maximum. */
  addOutcome(text: string): Promise<TopThreeOutcomeResult>;

  /** Verify-then-write. Only this entry changes (FR-007). */
  editOutcome(ref: OutcomeRef, text: string): Promise<TopThreeOutcomeResult>;

  /** Verify-then-write. Leaves a valid week, possibly empty (FR-008). */
  removeOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult>;

  /** Records today's local date (FR-009). */
  completeOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult>;

  /** Clears the completion date (FR-010). */
  reopenOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult>;
}

export type TopThreeOutcomeResult =
  | { ok: true; week: Week }
  | { ok: false; reason: TopThreeRefusal; message: string };

export type TopThreeRefusal =
  | "entry-changed"   // that outcome changed on disk since it was shown
  | "outcome-cap"     // the week is at its configured maximum
  | "empty-value"     // text is empty or whitespace-only
  | "past-week";      // writes target the current week only
```

Every write verb targets the **current week**. `OutcomeRef.week` is carried so a stale view cannot write
into the wrong section after midnight on a Monday — if the ref's week is not the current one, the verb
refuses `past-week` rather than writing where the user is no longer looking (FR-013).

Every successful verb answers with the week as it now stands on disk, mirroring `ProjectService`'s
re-read-after-write.

## Verify-before-write

```ts
const ref = { week: "2026-W33", index: 1, raw: "- [ ] Ship the migration" };
await topThree.editOutcome(ref, "Ship the migration behind a flag");
```

Before writing, the service re-reads the file, locates `ref.week`, takes entry `ref.index`, and compares
its raw line to `ref.raw`. On mismatch: cancel, leave the file **byte-for-byte unchanged**, and return
`entry-changed` with what the entry now says (FR-015b).

Verification is scoped to the entry, not the week (FR-015c). An unrelated hand-edit to a different outcome
in the same week does not cancel the write — the same reasoning Feature 3 used for field-level rather than
file-level verification: cancelling an edit the user cannot connect to what they did is a refusal they
cannot act on.

## Writes are surgical

Only the lines of the section being changed are touched; everything else is reproduced byte for byte, so
the git diff shows what the user did and nothing more. Setting a new week **inserts a new section** above
the existing ones and touches no prior week (FR-011) — the guarantee that makes history trustworthy.

## Reading is total

Parsing never fails. A week over the cap, an unrecognized line inside a section, an unknown section, a
hand-written date in an odd shape — all are carried through and displayed as they read (FR-015). The cap
governs what the system will **write**, never what it will show.

## Policy

`addOutcome` consults `week.outcome.record` with `{ week, outcomeCount }`. A `block` returns
`outcome-cap` with the module's reason verbatim. Absent `policy.md` → maximum 3.

The other four verbs consult nothing: editing, removing, completing, and reopening cannot take a week over
its cap.

## IPC

Follows `ipc-projects.md`. Renderer holds no domain logic — it renders what core returns and routes input
back.

| Channel | Direction | Payload → Result |
|---|---|---|
| `top-three:current` | invoke | `()` → `Week` |
| `top-three:history` | invoke | `()` → `Week[]` |
| `top-three:add` | invoke | `{ text }` → `TopThreeOutcomeResult` |
| `top-three:edit` | invoke | `{ ref, text }` → `TopThreeOutcomeResult` |
| `top-three:remove` | invoke | `{ ref }` → `TopThreeOutcomeResult` |
| `top-three:complete` | invoke | `{ ref }` → `TopThreeOutcomeResult` |
| `top-three:reopen` | invoke | `{ ref }` → `TopThreeOutcomeResult` |
| `vault:changed` | main → renderer | `()` — **existing signal, reused** |

`vault:changed` needs no new wiring: `FsVaultStore` raises it from its write path, and `top-three.md` is
written through that same store (research R9). The renderer re-reads on the signal, so a hand-edit or a
write from another window is reflected in an open view without a reopen (Feature 2's precedent).

The renderer must **not** decide whether a week is editable, compute the current week, or format a refusal.
`Week.current` and every message come from core (Principle II).

## ISO week

```ts
/** `YYYY-Www` for the local date. Pure, synchronous, no dependency (R1). */
export function isoWeek(date: Date): WeekId;
```

Monday start; week 01 contains the first Thursday; the label carries the ISO week-numbering year, so
1 Jan 2027 may read `2026-W53` (FR-003 through FR-003b). Zero-padded, so identifiers sort chronologically
as plain text (FR-003a).

Tested as a table across at least three year boundaries including a 53-week year, with `TZ` pinned — "which
week is it" is a question about the user's local midnight, and a UTC test run would place Sunday-evening
dates in the following week.

This is the definition of a week for the whole system. Feature 5's log files must use it (FR-003c).
