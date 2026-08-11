# Contract: Electron IPC for the Sort View (renderer ↔ main)

**Feature**: 002-inbox-view-sort

Extends [Feature 1's IPC contract](../../001-quick-capture/contracts/ipc.md). Same rules apply: the
renderer is a thin client (Principle II), every channel is a pass-through to `SortService`, and **no
channel exists that lets the renderer make a domain decision.**

`contextIsolation: true`, `nodeIntegration: false`. The preload adds the surface below to
`window.waypoint.sort` and nothing else.

---

## Renderer → Main

### `sort:next` — `invoke`

```ts
next(): Promise<
  | { item: { text: string; capturedAt: string | null; ref: ItemRef } }
  | { item: null }          // inbox is empty (FR-026)
>
```

Calls `SortService.next()`. `capturedAt` crosses as an ISO 8601 string and is rendered as-is;
`null` means a hand-written item and the renderer shows **no timestamp** rather than a placeholder or
today's date (FR-027a).

`ref` is opaque. The renderer stores it and hands it back untouched — it must never construct, adjust, or
reason about byte offsets.

### `sort:destinations` — `invoke`

```ts
destinations(): Promise<{
  projects: { slug: string; title: string }[];
  areas:    { slug: string; title: string }[];
}>
```

Called each time the picker opens, so a project created in another window or by hand appears without a
restart. The renderer renders the list in the order given and **must not** reorder, rank, or pre-select an
entry (FR-030).

### `sort:decide` — `invoke`

```ts
decide(ref: ItemRef, decision: SortDecision): Promise<
  | { ok: true;  destination: string }
  | { ok: false; reason: SortRefusal; message: string }
>
```

The one channel that changes anything. Calls `SortService.sort()`.

**The renderer MUST await this before requesting the next item** (FR-019, FR-002) — the opposite of
`capture:submit`, which the renderer is required *not* to await. Capture optimizes for never hesitating;
sort optimizes for never losing a decision. A renderer that fired-and-forgot here could show item N+1
while item N's write was still in flight, and a crash in that window would be exactly the state the
journal exists to prevent.

Refusal handling the renderer must implement:

| `reason` | Renderer behaviour |
|---|---|
| `item-changed` | Show what happened, discard the stale `ref`, call `sort:next` again (FR-020b) |
| `destination-missing` | Show the message, reopen the picker with a fresh `sort:destinations` |
| `empty-title` | Keep the create field open with focus; nothing was created (FR-011) |
| `empty-owner` | Keep the owner field open with focus; nothing was written (FR-014) |
| `write-failed` | Show a persistent notice including the item text, per `InboxWriteError` precedent |

None of these are modal errors. The item is still in the inbox in every case, so the user can retry or
choose differently.

### `sort:count` — `invoke`

```ts
count(): Promise<number>
```

For progress display only ("4 left"). Advisory — the renderer must not use it to decide whether to keep
going; `sort:next` returning `null` is the only authority on emptiness.

### `sort:dismiss` — `send`

Fire-and-forget. Closes the sort window. Safe at any moment: every completed decision is already durable
and there is no session state to lose (FR-024).

---

## Main → Renderer

### `sort:recovered` — `send`

```ts
{ completed: number; abandoned: number }
```

Emitted once at startup after `SortService.recover()` runs, and only when either count is non-zero. The
renderer shows a non-blocking notice. `abandoned > 0` means an item may appear both in the inbox and in
its destination — a duplicate the user can see and delete, never a loss.

### `sort:notice` — `send`

```ts
{ level: 'info' | 'error'; message: string; recoverableText?: string }
```

Reuses Feature 1's notice queue and rendering rather than introducing a second mechanism.

---

## Testing seam

Reuses Feature 1's `WAYPOINT_E2E=1` gate on the same terms. Adds `showSort`, `hideSort`, and
`isSortVisible` to the existing `__waypoint` global, substituting only for window management — the part
Playwright cannot drive.

No stub is added for sorting itself. E2E tests drive real `SortService` calls against a temp vault,
because the whole point of the sort tests is what lands on disk.

---

## Explicitly absent channels

Omitted on purpose; adding any would move domain logic into the client:

| Not provided | Why |
|---|---|
| `sort:createProject` as a standalone call | Creation is folded into the decision so create-and-route is one journaled operation (FR-010) |
| `vault:write` / raw file access | Only the core decides what goes where |
| Any channel accepting a caller-supplied destination path | The core derives paths from slugs; a client-supplied path could write anywhere |
| Any channel accepting a caller-supplied waiting-since or flagged-on date | Dates are core-assigned (FR-013, FR-017a), exactly as capture timestamps are |
| `sort:skip` / `sort:defer` | Not a destination. The user ends the session instead (FR-002) |
| `sort:undo` | Out of scope (FR-032); soft-delete to `trash.md` is what makes that acceptable |
| `sort:suggest` or any ranked ordering | Feature 7 territory. The absence of the channel is what makes FR-030 structural |
| `inbox:write` | Still true from Feature 1 — only the core writes to the inbox |
