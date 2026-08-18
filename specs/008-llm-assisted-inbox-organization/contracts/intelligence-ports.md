# Contract: The intelligence ports

**Feature**: 008-llm-assisted-inbox-organization

Three interfaces core declares. Two speak Waypoint's vocabulary and are stable regardless of what answers
them; the third speaks in content and has never heard of a project. Each provider port has **exactly one call
site**, and every implementation is supplied by injection — the shape `TranscriptionPort` and
`SummaryProvider` already established.

---

## Seam one: what intelligence does

```ts
/**
 * Proposes how one inbox item divides into distinct thoughts.
 *
 * Returns groupings of *segment numbers*, never text. Core slices the original
 * to build each piece, so a piece cannot contain words the user did not say —
 * not because the provider is trusted, but because it never handles the text
 * (FR-010a, research R3).
 */
export interface SplitProvider {
  /** Attribution, shown before the provider runs. Never written to disk. */
  readonly name: string;
  propose(request: SplitRequest, signal: AbortSignal): Promise<SplitResponse>;
}

export interface SplitRequest {
  /** The item's own text. Nothing else about the vault (FR-042). */
  readonly text: string;
  /** The partition core computed. `segments.join("") === text`, byte for byte. */
  readonly segments: ReadonlyArray<{ index: number; text: string }>;
}

export interface SplitResponse {
  /** One array of segment indices per proposed piece. */
  readonly pieces: ReadonlyArray<ReadonlyArray<number>>;
  /** True when the item holds a single thought (FR-011). */
  readonly nothingToSplit: boolean;
}
```

```ts
/**
 * Proposes where one item — or one piece of a split one — belongs.
 *
 * Constrained to Feature 2's five destinations by reusing `SortDecision`. A
 * sixth destination is not expressible, and neither is a hint that a machine
 * proposed this one, because `SortDecision` has no field for either (FR-020,
 * FR-032).
 */
export interface DestinationProvider {
  readonly name: string;
  propose(request: DestinationRequest, signal: AbortSignal): Promise<DestinationResponse>;
}

export interface DestinationRequest {
  /** The item's or piece's own text. */
  readonly item: string;
  /** Title and stated outcome only. No milestone, next action, DRI, status, ledger, or unprocessed item. */
  readonly projects: ReadonlyArray<{ slug: string; title: string; outcome: string | null }>;
  /** Areas have no outcome, so a title alone. */
  readonly areas: ReadonlyArray<{ slug: string; title: string }>;
}

export interface DestinationResponse {
  readonly decision: SortDecision;
  readonly reason: string;
}
```

### Why `DestinationRequest` is the whole payload boundary

There is no field for a milestone, a DRI, a status, a ledger entry, an `## Unprocessed` item, another inbox
item, or any configuration value. A provider that wanted them would have to change core to get them, which is
a visible change rather than a quiet one. This is Feature 5's `ReviewRecord` discipline applied to a second
port, and `summary-payload.test.ts` already established how to prove it: plant a distinctive marker in every
file the payload must never carry, and assert that none appears.

### Why two interfaces and not one

FR-003 requires the two kinds of help to be independently requestable, and asking for one must not send the
other's content. Two interfaces make that a fact about the shape rather than a rule about the caller. It also
means a provider supplying one capability does not have to stub the other.

---

## Seam two: how a model is reached

```ts
/**
 * Carries request content out and brings response content back.
 *
 * Nothing about projects, areas, inbox items, destinations, or sorting appears
 * here, and nothing should ever be added. A transport that needed to know what
 * it was carrying would be an intelligence module wearing the wrong interface.
 */
export interface Transport {
  /** Named for display in a failure message and in the preview. */
  readonly name: string;
  /**
   * @param request the exact content to send
   * @param signal aborted by core at 120 seconds, or when the user abandons
   * @throws TransportError — mapped by the module onto SuggestionFailure
   */
  send(request: string, signal: AbortSignal): Promise<string>;
}
```

### The bound is core's, not the transport's

Core arms one `AbortController` per request and passes its signal down. A transport honours it — the command
transport kills the child, the certificate transport destroys the request — and implements no timeout of its
own. FR-066a requires one number for every transport, not configurable; enforcing it above the seam is what
makes that structural rather than two numbers that could drift (research R15).

### Two transports ship, and they are unalike on purpose

| | `command` | `certificate` |
|---|---|---|
| Mechanism | `node:child_process.spawn`; request on stdin, response on stdout | `node:https.request` with `cert`/`key`/`ca` |
| Failures | spawn `ENOENT`, non-zero exit with a stderr tail, killed on abort | credential unreadable, TLS handshake failure, non-2xx status, socket error, aborted |
| Maps onto | `unreachable`, `failed`, `timed-out` | `credential`, `unreachable`, `failed`, `timed-out` |

Their failures arrive as different *kinds* of thing — an exit code against a TLS error — which is what proves
the failure taxonomy is a real abstraction rather than one implementation's error type renamed. Neither adds a
dependency: both are platform capabilities, and `WhisperAdapter` already proved the spawn shape.

---

## The default module

```ts
/** One factory, one default module, configured with a transport. */
export function createDefaultIntelligence(
  transport: Transport,
): SplitProvider & DestinationProvider;
```

It owns segmentation input, request construction, response parsing, verbatim verification, and coverage
arithmetic. It owns no I/O and reaches no write verb.

**Internal by intent.** Exported as types so the project can use the seams deliberately, not so a third party
can register against them. There is no loader, no discovery mechanism, and no public extension API — the same
restraint Principle V requires of the policy seam, and the roadmap's stated position that the transport
interface should survive two real environments before anyone considers publishing it.

---

## What these ports are not

- **Not decision points.** They produce proposals for a human to accept or reject, never an `allow`, `warn`,
  or `block`. `DECISION_POINTS` stays at five (FR-034).
- **Not a write path.** Neither interface can reach a verb that writes. Accepting a destination is the client
  calling `sort()` after the user says yes; accepting a split is the client calling `split()`. The provider is
  not holding either (FR-035, research R11).
- **Not a provider of Feature 5's summary.** `SummaryProvider` still ships with no implementation. The
  ROADMAP anticipated this feature would supply one; the user excluded it, and the port is left as it is
  rather than quietly filled.
