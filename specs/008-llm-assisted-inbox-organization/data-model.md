# Data Model: LLM-Assisted Inbox Organization

**Feature**: 008-llm-assisted-inbox-organization

Almost everything here is in-memory and lives only between a user's ask and their accept-or-reject. Exactly
one thing reaches disk that did not before — `intelligence.md` — and exactly one existing file is written in a
new way — `inbox.md`, by a split, in the format Feature 1 already defined.

---

## On disk

### `intelligence.md` — new, at the vault root, absent by default

The only persistent addition. Format and parsing rules in
[contracts/intelligence-config.md](./contracts/intelligence-config.md).

| Field | Kind | Meaning |
|---|---|---|
| `transport` | `"command" \| "certificate"` | Which transport is used. Any other value is a reported problem and the layer stays off. |
| `command` | absolute path or bare name | `command` transport only. The tool to spawn. |
| `## Arguments` | list of strings | `command` transport only. Passed in order. Absent means none. |
| `endpoint` | `https://` URL | `certificate` transport only. |
| `certificate` | filesystem path | `certificate` transport only. Client certificate. **A path, never material.** |
| `key` | filesystem path | `certificate` transport only. Private key. **A path, never material.** |
| `ca` | filesystem path | `certificate` transport only, optional. Trust anchor for a private CA. |

**Absent file, or a file naming no transport, is the shipped state**: the layer is off, silently, with no
problem reported and no affordance rendered (FR-054, FR-060).

**No field's value is secret material** (FR-051b). There is no field a private key could be written into,
which is what makes "the data directory stays safe to commit" a property of the format rather than a warning
in the documentation.

### `inbox.md` — existing, written in a new way by a split

A split replaces one item's byte range with the serialized pieces. The format is Feature 1's, unchanged:

```text
- 2026-08-17T09:14:22-04:00 first piece text
- 2026-08-17T09:14:22-04:00 second piece text
```

- Every piece carries **the original item's** `capturedAt`, not the time of the split (FR-016).
- A hand-written item — one `parseInbox` read back with `capturedAt: null` — yields pieces written as bare
  `- text` lines with no timestamp. Nothing is fabricated (FR-016).
- Multi-line piece text uses the two-space continuation indent, and a blank line inside a piece stays blank.
  A piece spanning a blank line must round-trip through `parseInbox` as **one** item; this is the property
  test research R10 requires.
- Pieces occupy the original's byte range, so file order — which is capture order, and which
  `SortService.next()` reads directly — is preserved with nothing computed.

### Files this feature never reads

`identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, `log/`. Not a rule to remember: the
service's only read source is a `DestinationCatalog`, whose `read(dir, slug)` cannot name them (research R6).

---

## In memory, for the life of one request

### `Segment`

The partition of an item's text. Never leaves core.

| Field | Type | Notes |
|---|---|---|
| `index` | `number` | 0-based. This is what the model names. |
| `start`, `end` | `number` | Character offsets into the item text. |

**Invariant**: `segments.map(s => text.slice(s.start, s.end)).join("") === text`, byte for byte, including
whitespace. Asserted as a property test over every dictation fixture. Boundaries (after `.`/`!`/`?` plus
whitespace, and at every newline) are a heuristic and may be poor; correctness depends only on the partition
being total, so a bad boundary yields a coarser proposal, never a wrong one.

### `PreparedRequest<T>`

The value that makes the payload guarantee structural (research R4).

| Field | Type | Notes |
|---|---|---|
| `payload` | `string` | The exact content that would be sent. What FR-041's preview displays. |
| `run()` | `() => Promise<T>` | Sends `payload`. Takes no argument, so nothing else is sendable. |
| `abandon()` | `() => void` | Aborts an in-flight request, leaving the item untouched. Shares the one `AbortController` with the 120-second bound, so FR-066 and FR-066a are one mechanism with two triggers. |

`run` is a closure over the same binding `payload` exposes. `received[0] === prepared.payload` is assertable
with `===`.

### `SplitProposal`

| Field | Type | Notes |
|---|---|---|
| `pieces` | `ProposedPiece[]` | One or more. |
| `uncovered` | `string[]` | Text of segments no piece names, in file order. Empty when the pieces account for everything. FR-013's display comes from here. |
| `nothingToSplit` | `boolean` | True when the item holds one thought. Presented as such rather than as a one-piece proposal (FR-011). |

### `ProposedPiece`

| Field | Type | Notes |
|---|---|---|
| `text` | `string` | Built by core by slicing the original at the named segments. **Never taken from the response** (FR-010a). |
| `segments` | `number[]` | Which segments it groups. Retained so the coverage arithmetic is checkable and the piece's provenance is inspectable. |

Once a proposal reaches the user it is ordinary editable text: `SortService.split()` takes strings, not
pieces, so an edited piece and a proposed one are the same kind of thing to the write path.

### `DestinationProposal`

| Field | Type | Notes |
|---|---|---|
| `decision` | `SortDecision` | **Feature 2's type, unchanged.** A proposal that cannot be expressed as one of the five decisions does not exist. |
| `reason` | `string` | Brief, in the item's terms (FR-021). Displayed, never written (FR-032). |
| `isNew` | `boolean` | True only for `createTitle` decisions. What FR-023's distinct presentation keys off. |

Reusing `SortDecision` is what makes FR-020's "no sixth destination" and FR-031's "nothing exists only on the
assisted path" facts about the type. It also inherits Feature 2's deliberate absence of a `suggestedBy`
field, so FR-032 needs no enforcement.

### `SuggestionFailure`

Closed union, owned by core, mapped onto by both transports (research R14).

| Value | Raised when |
|---|---|
| `not-configured` | No `intelligence.md`, or none names a transport. Never surfaces a message — a client with no transport renders nothing. |
| `misconfigured` | Unrecognised `transport:`, or a required parameter missing. Message names the value read and the values that work. |
| `credential` | The named certificate or key is absent, unreadable, or rejected. Message names the **path** and the problem, never the material (FR-051d). |
| `unreachable` | Process could not be spawned; endpoint could not be reached. |
| `timed-out` | The 120-second bound, or the user abandoned. |
| `failed` | Started and did not complete: non-zero exit, non-2xx status, socket closed mid-response. |
| `unusable` | Completed, and the response could not be understood (research R12). |

Every member except `not-configured` carries a display message. None triggers a retry (FR-065).

---

## What is deliberately not modelled

- **No proposal is stored.** No cache, no history, no record of what was accepted or rejected, no per-user
  tuning signal. Nothing about a request survives the request, which makes "learning from the user's
  decisions" structurally out of scope rather than merely unimplemented (FR-046, FR-070).
- **No attribution field on anything written.** Feature 5 records which provider drafted a summary because a
  generated summary sits in the log beside the user's own words and a reader must be able to tell them apart.
  Here the opposite is required: an accepted piece is an ordinary inbox item and an accepted destination is an
  ordinary sort, indistinguishable from a manual one (FR-015, FR-032).
- **No decision-point context type.** This feature adds no decision point, so there is no new
  `DecisionContext` member and `DECISION_POINTS` stays at five (FR-034).
- **No `Clock`.** A split takes its timestamp from the item it divides, and nothing else here needs today.
