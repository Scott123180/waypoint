# Contract: `SuggestionService` and `SortService.split`

**Feature**: 008-llm-assisted-inbox-organization

The verbs a client calls. Two of them ask, two of them write, and the two kinds never meet: the service that
asks cannot write, and the service that writes has never heard of a proposal.

---

## `SuggestionService` — asks, and cannot write

```ts
export interface SuggestionServiceDeps {
  /** The only read source. Cannot name a file, so identity.md is not reachable. */
  catalog: DestinationCatalog;
  /** Absent means the layer is off. */
  intelligence?: SplitProvider & DestinationProvider;
  /** Test seam only. No production code path supplies it (research R15). */
  timeoutMs?: number;
}

export interface DestinationCatalog {
  list(dir: "projects" | "areas"): Promise<string[]>;
  read(dir: "projects" | "areas", slug: string): Promise<string | null>;
}
```

**What is absent is the contract.** There is no `vault`, no `inbox`, no `journal`, no `sort`, no `policy`, and
no `Clock`. A contributor who wanted to write from here, consult a rule from here, or read `log/` from here
would have to change this constructor, which is a visible edit rather than a quiet call to something already
injected. This is Feature 6's technique, taken one step further: narrowing to `Pick<VaultStore, "list" |
"read">` gives write-immunity but still typechecks `read("identity.md")`; naming the directory as a parameter
closes that (research R6).

### The two verbs

```ts
prepareSplit(item: InboxItemView): Promise<
  | { ok: true; prepared: PreparedRequest<SplitOutcome> }
  | { ok: false; reason: SuggestionFailure; message: string }
>;

prepareDestination(text: string): Promise<
  | { ok: true; prepared: PreparedRequest<DestinationOutcome> }
  | { ok: false; reason: SuggestionFailure; message: string }
>;
```

Preparing performs **no** I/O beyond reading the destination catalogue, and sends nothing. It is the step that
exists so FR-041's preview happens before the send.

```ts
export interface PreparedRequest<T> {
  /** The exact content that would be sent. */
  readonly payload: string;
  /** Sends `payload`. No argument, so nothing else is sendable. */
  run(): Promise<T>;
  /** Abandons an in-flight request. Leaves the item untouched (FR-066). */
  abandon(): void;
}
```

`run` is a closure over the same binding `payload` exposes. There is no second construction of the content,
which is what makes FR-045 impossible to violate rather than merely tested — the byte-for-byte assertion is
`received[0] === prepared.payload`, with `===`.

### Outcomes

```ts
type SplitOutcome =
  | { ok: true; proposal: SplitProposal }
  | { ok: false; reason: SuggestionFailure; message: string };

type DestinationOutcome =
  | { ok: true; proposal: DestinationProposal }
  | { ok: false; reason: SuggestionFailure; message: string };
```

Refusal is a value, not an exception — matching `SortOutcome` and capture's undo. A failure is an expected
outcome a client renders, not a crash.

### Rules this service holds

| Rule | Where it lives |
|---|---|
| Requests happen only when asked, one item at a time (FR-001, FR-004) | There is no other entry point, no timer, no subscription, and no array overload. |
| Asking for one kind does not send the other (FR-003) | Two verbs, two payloads, two provider interfaces. |
| Nothing is written by asking (FR-005) | No write verb is reachable from the dependencies. |
| A proposal names only a project or area that exists (FR-022) | The response's slug is checked against the catalogue read for *this* request; an unknown slug makes the response `unusable`. |
| A `createTitle` decision is marked new (FR-023) | `isNew` is derived from the decision's shape, not from the response. |
| A piece is always the user's words (FR-010a) | Piece text is sliced from the original; the response carries numbers. |
| Coverage is exact (FR-013) | Set difference over segment indices. |
| 120 seconds, same for every transport (FR-066a) | One `AbortController` here; transports have no timeout of their own. |
| No automatic retry (FR-065) | `run()` sends once. A second attempt is a second `prepare` by the client. |

---

## `SortService.split` — writes, and has never heard of a proposal

```ts
/**
 * Replaces one inbox item with several, atomically.
 *
 * Takes strings. It cannot tell whether they came from a proposal, an edit of
 * one, or a client that has no intelligence configured at all — which is what
 * makes FR-031 ("nothing exists only on the assisted path") a fact about the
 * signature rather than a claim.
 */
split(ref: ItemRef, pieces: string[]): Promise<SortOutcome>;
```

**Behaviour**

1. Refuse `empty-pieces` when `pieces` is empty or every entry is blank after trimming (FR-019). The original
   stands; discarding is one `sort()` to trash away.
2. Verify the item's bytes still match `ref.raw`. On mismatch, refuse `item-changed` with Feature 2's message
   and write nothing (FR-018) — the same verification `sort()` performs, from the same place.
3. Build the replacement block: each piece serialized in Feature 1's format, stamped with **the original
   item's** `capturedAt`, or with no timestamp at all when the original had none (FR-016).
4. One `inbox.replaceRange(start, end, expected, replacement)`. Either it lands or it does not.

**No journal entry.** A split touches one file through an atomic temp-plus-rename, so FR-014's all-or-nothing
is the rename's guarantee. The journal exists because a destination commit touches two files and POSIX cannot
update both atomically; adding it here would create a crash window that does not otherwise exist, with a
recovery path whose triggering state is unreachable (research R9). `recover()` and `SortJournalEntry` are
untouched.

**Refusal set**: `item-changed`, `empty-pieces` (new), `write-failed`. `destination-missing`, `empty-title`,
and `empty-owner` cannot arise — a split has no destination.

---

## `InboxDocument` grows one method

```ts
replaceRange(
  start: number,
  end: number,
  expected: string,
  replacement: string,
): Promise<"replaced" | "mismatch">;
```

Same guarantees `removeRange` documents: atomic to a reader, never discards a concurrent append, mismatch
writes nothing. `removeRange` keeps its signature and behaviour and shares the private splice, so Feature 2's
`fs-inbox-document.test.ts`, `inbox-concurrent-write.test.ts`, and `inbox-mutex.test.ts` pass unmodified.

---

## Accepting a destination: the client's call, not the service's

There is no `accept(proposal)` verb anywhere. A client that has shown a `DestinationProposal` and heard yes
calls:

```ts
await sort.sort(ref, proposal.decision);
```

The same call a manual choice makes, with the same validation, the same item-changed verification, the same
refusals, the same journalling and recovery, and the same policy consultation. Nothing distinguishes the two
at the call site because `SortDecision` has no field in which the difference could be recorded — Feature 2
removed that possibility deliberately, and this feature inherits it rather than re-promising it (FR-030,
FR-032).

---

## Out of scope for this surface

No `suggestAll`, no batch verb, no ranking, no confidence score, no accepted/rejected history, no
`SortService` method whose name contains `suggest` — Feature 2's scope guard still forbids the last of these
and still passes, because suggesting is a different verb on a different service.
