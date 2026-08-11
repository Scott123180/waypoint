# Contract: Core Sort API

**Package**: `@waypoint/core` | **Feature**: 002-inbox-view-sort

The complete surface the core exposes for sorting. Every rule in the feature spec is enforced behind this
boundary. The Electron GUI now, the local HTTP API in Feature 6, and the LLM-assisted layer in Feature 7
all call exactly these verbs and get identical behaviour (Principles II and VII).

The core imports nothing from Electron and touches no platform globals.

Extends [Feature 1's core API](../../001-quick-capture/contracts/core-api.md); `Clock` is reused unchanged.

---

## New ports (implemented by the adapter layer, injected into the core)

```ts
/** Read/modify access to inbox.md. Distinct from Feature 1's append-only InboxStore. */
interface InboxDocument {
  /** Full current contents. Empty string if the file does not exist. */
  read(): Promise<string>;

  /**
   * Removes bytes [start, end) — but ONLY if what is currently there exactly equals `expected`.
   * Returns 'mismatch' without writing anything if it does not.
   *
   * Must be atomic: a reader sees the file before or after, never mid-write.
   *
   * Must not discard concurrent appends. An implementation that rebuilds the file
   * (temp + rename) MUST serialize against every other writer in its own process and
   * MUST detect out-of-process growth before committing — a capture landing mid-removal
   * has to survive it (FR-020e). See research R4a.
   */
  removeRange(start: number, end: number, expected: string): Promise<'removed' | 'mismatch'>;
}

/** Raw file access within the vault. Deliberately has no concept of a destination. */
interface VaultStore {
  /** Slugs of files in a vault subdirectory. Empty array if the directory is absent. */
  list(dir: 'projects' | 'areas'): Promise<string[]>;

  /** File contents, or null if absent. Path is vault-relative. */
  read(relPath: string): Promise<string | null>;

  /** Writes atomically, creating parent directories. Path is vault-relative. */
  write(relPath: string, content: string): Promise<void>;

  /** Appends to a list file, creating it if absent. Guarantees a preceding newline if needed. */
  appendLine(relPath: string, line: string): Promise<void>;
}

/** Write-ahead log making the two-file commit effectively-once (R2). */
interface SortJournal {
  begin(entry: JournalEntry): Promise<void>;
  markDestinationWritten(id: string): Promise<void>;
  clear(id: string): Promise<void>;
  pending(): Promise<JournalEntry[]>;
}
```

**Why the ports are this dumb**: none of them can express "route an item to a project." An adapter can
write bytes to a path; only the core decides which path and which bytes. That is what makes Principle II
structural rather than a convention the next client could forget.

---

## SortService

```ts
class SortService {
  constructor(deps: {
    inbox: InboxDocument;
    vault: VaultStore;
    journal: SortJournal;
    clock?: Clock;        // defaults to system clock
  });
```

### `next(): Promise<InboxItemView | null>`

```ts
type InboxItemView = {
  text: string;
  capturedAt: Date | null;   // null for a hand-written item (FR-027a)
  ref: ItemRef;              // opaque; pass back to sort()
};
```

- Returns the **first** item in file order, or `null` when the inbox holds no routable text (FR-001).
- Re-reads the file every call. There is no cursor, no session, and nothing to resynchronize after a
  hand-edit (FR-025).
- Never returns blank lines as items (FR-027b).

### `count(): Promise<number>` / `isEmpty(): Promise<boolean>`

- Computed from the file, never cached (FR-028). `isEmpty()` is what Feature 5's review gate will call.

### `destinations(): Promise<{ projects: DestinationRef[]; areas: DestinationRef[] }>`

- Read fresh from the vault, so a hand-created project file appears without a restart (FR-006, FR-007).
- Titles come from each file's `#` heading; a file without one falls back to its slug.

### `sort(ref: ItemRef, decision: SortDecision): Promise<SortOutcome>`

The verb. One call performs the entire commit: validate → journal → write destination → remove from inbox
→ clear journal.

```ts
type SortOutcome =
  | { ok: true;  destination: string }   // e.g. 'projects/roof-repair.md'
  | { ok: false; reason: SortRefusal; message: string };

type SortRefusal =
  | 'item-changed'         // inbox bytes no longer match ref (FR-020b)
  | 'destination-missing'  // chosen project/area gone from disk (FR-020c)
  | 'empty-title'          // create title empty, or slugs to empty (FR-011)
  | 'empty-owner'          // waiting-for owner empty (FR-014)
  | 'write-failed';        // I/O failure; nothing was committed
```

- **Awaits the disk.** Unlike `CaptureService.submit`, this resolves only once the decision is durable.
  A client cannot present the next item before the current one is committed (FR-019, FR-024).
- **Refusal is a value, not an exception** — the same convention Feature 1 uses for undo, because refusing
  is an expected outcome and callers must render it, not crash on it.
- On any refusal, **nothing is written anywhere** and the item remains in the inbox unchanged.
- Creating a project or area is folded into the decision rather than being a separate call, so
  create-and-route is one journaled operation with no window where a stub exists but the item did not move
  (FR-010).
- `sort()` does not return the next item. Clients call `next()` again, which re-reads the file — the
  cheapest way to stay correct when the user is also editing it.

### `recover(): Promise<RecoveryReport>`

```ts
type RecoveryReport = {
  completed: number;    // entries finished
  abandoned: number;    // entries cleared because the inbox no longer matched
};
```

- Replays any pending journal entries (R2). Idempotent — safe to call twice, safe to crash inside.
- **Must be called at startup before the sort view opens.** The client is responsible for calling it; it is
  not responsible for knowing what it does.
- An abandoned entry means the item is safely in its destination but may also still be in the inbox. That
  is a visible duplicate, not a loss, and the report exists so the client can say so.

---

## Errors

Sort refuses by returning a value. The only thrown errors are genuine faults:

| Error | Thrown when | Client must |
|---|---|---|
| `VaultWriteError` | A vault write fails irrecoverably | Show a notice including the item text so the thought stays recoverable, following `InboxWriteError`'s precedent |

`write-failed` as a `SortRefusal` covers the case where the failure was caught and nothing was committed.
`VaultWriteError` is for the case where the core cannot establish what state the disk is in — rare, and
loud on purpose.

---

## Guarantees the core owns (and clients therefore cannot get wrong)

1. Items are presented in file order, one at a time, and no client can request the second one first.
2. A decision is durable before it resolves; there is no non-blocking variant to reach for.
3. An item is never in neither place. After recovery it is never in both.
3a. A capture made while a decision is committing is never lost to it.
4. Unsorted bytes are never altered — not reordered, not reformatted, not re-timestamped.
5. A hand-written item never acquires a fabricated capture time.
6. Empty titles and empty owners never produce a destination or an entry.
7. A destination the user deleted is never silently recreated.
8. Inbox emptiness is computed from the file, so it cannot drift from what the user sees in their editor.
9. Nothing suggests, ranks, or pre-selects a destination — the API has no field in which a suggestion
   could be expressed.
