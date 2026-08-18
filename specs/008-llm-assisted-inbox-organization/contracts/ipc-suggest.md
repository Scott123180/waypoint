# Contract: Suggestion IPC

**Feature**: 008-llm-assisted-inbox-organization

How the sort window reaches the suggestion service. Follows `ipc-sort.md`: `invoke`/`handle` for anything
returning a value, `send`/`on` for one-way, everything through the preload bridge, no domain logic in the
renderer.

---

## The channels exist only when the layer does

`main.ts` reads `intelligence.md` at startup and after a vault change. With no transport configured:

- `ipcMain.handle` is **not called** for any `suggest:*` channel.
- `preload.ts` exposes **no** `suggest` object on the bridge.
- The renderer's proposal panel is not rendered, because the code path that renders it checks for a capability
  that is not on the API surface.

The renderer therefore has nothing to hide, disable, or grey out. FR-060 and SC-002 ask for no control in any
state, and a `disabled` attribute does not satisfy that — a control that exists and is invisible is still a
control, and one bad selector away from visible (research R17).

---

## Channels

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `suggest:available` | invoke | — | `boolean`. Whether the layer is on. Read once when the sort window opens. |
| `suggest:prepare-split` | invoke | `ItemRef` | `{ ok: true; id: string; payload: string } \| { ok: false; reason; message }` |
| `suggest:prepare-destination` | invoke | `ItemRef` or `{ text: string }` | same shape |
| `suggest:run` | invoke | `{ id: string }` | `SplitOutcome \| DestinationOutcome` |
| `suggest:abandon` | send | `{ id: string }` | — |

### Why prepare and run are two channels

FR-041 requires the exact content to be shown before it is sent. `prepare` returns the payload and sends
nothing; `run` sends it. The renderer displays `payload` and the user's act of running is the send.

### Why `id` and not the payload

`suggest:run` takes an opaque id, not the payload text. If the renderer sent the payload back, the content
that reaches the transport would be whatever crossed the bridge twice, and a mismatch would become possible —
exactly what FR-045 forbids. The main process holds the one `PreparedRequest` against its id and calls
`run()`, which is closed over the payload it already returned. The bridge cannot influence what is sent.

Ids are per-window and short-lived: preparing again for the same item replaces the held request, and closing
the sort window drops them. Nothing about a prepared request is persisted (FR-046).

---

## Accepting

There is **no** `suggest:accept` channel.

- Accepting a destination is `sort:decide` — the channel a manual decision already uses, with the
  `SortDecision` the proposal carried. There is no assisted path to a destination because there is no second
  channel to it (FR-030, FR-031).
- Accepting a split is `sort:split`, a new channel carrying `(ItemRef, string[])`. It takes the piece strings
  the renderer holds after the user has edited them, and cannot tell whether they came from a proposal.

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `sort:split` | invoke | `ItemRef`, `string[]` | `SortOutcome` |

Named `sort:*` rather than `suggest:*` because it is a sort-time write with no knowledge of proposals — the
channel name says which service owns it, and this one is owned by `SortService`.

---

## Refreshing

No new refresh channel. A landed split raises the existing `inbox:changed` signal from `FsInboxDocument`,
which the sort window already listens to — the signal is named for the file, so capture, undo, sort, and now a
split all raise the one signal and no listener learns which client changed it.

---

## Preload surface

```ts
const suggestApi = {
  available(): Promise<boolean>,
  prepareSplit(ref: ItemRef): Promise<PrepareResult>,
  prepareDestination(input: ItemRef | { text: string }): Promise<PrepareResult>,
  run(id: string): Promise<SplitOutcome | DestinationOutcome>,
  abandon(id: string): void,
};
```

Attached to the bridge **only** when a transport is configured. `window.waypoint.suggest` is `undefined`
otherwise, and that is what the renderer checks.

The sort API gains one method, `split(ref, pieces)`, which is present **always** — it is a `SortService` verb
and its availability has nothing to do with whether a model can be reached.

---

## Not in this contract

- No channel that produces a suggestion without being asked. Nothing subscribes, nothing polls, nothing fires
  on `sort:next` (FR-002).
- No channel taking more than one item (FR-004).
- No channel returning a ranked list, a score, or a pre-selected destination — `sort:destinations` keeps
  returning what Feature 2 defined, in the order Feature 2 defined, and `sort-no-suggestion.test.ts` keeps
  asserting it.
- No channel exposing the transport's configuration, credentials, or credential paths to the renderer. The
  preview shows the request content; it does not show how the request travels.

---

## Amendment — what shipped (recorded 2026-08-18, task T080)

The contract above is left as it was written. Three things about the channels differ in the built code, found
by `/speckit-converge` and recorded here rather than by rewriting the table.

**`suggest:available` does not exist.** It was to be "read once when the sort window opens". Research R17 then
settled availability differently: the main process decides it before the window is created and passes
`--waypoint-suggest` as a window argument, so `preload.ts` either attaches the `suggest` object or does not.
The channel shipped anyway, with no caller, and could only ever have answered `true` — it is reachable only
when the layer is already on. It has been removed from `ipc.ts` and from the bridge, and
`suggest-ipc-contract.test.ts` now asserts the bridge is exactly `prepareSplit`, `prepareDestination`, `run`,
and `abandon`, so a fifth verb cannot reappear unnoticed.

**Three payloads are flatter than the table says.** `suggest:prepare-split` takes the serialized item —
`{ text, capturedAt, ref }`, the same shape `sort:next` returns — rather than an `ItemRef` the main process
would re-resolve. `suggest:prepare-destination` takes a bare `string`, and `suggest:run` and `suggest:abandon`
take a bare `string` id rather than `{ id }`.

None of this weakens FR-045, and it is worth being exact about why, because "the renderer supplies the text"
sounds like it should. The payload is still constructed once, in the main process, from whatever text arrives,
and the string returned to the renderer is the same binding `run()` closes over — the renderer names a request
by id and cannot reach the content again. What crosses the bridge on the way *in* is not what is sent; what is
sent is what was previewed, and that identity is a property of `PreparedRequest`, not of this table.

The lesson is the same one plan.md records for `propose` → `prepare*`: a contract written before the code is a
design instrument, and the useful thing to do when it diverges is to date the divergence, not to quietly
restate history as though it had always said this.
