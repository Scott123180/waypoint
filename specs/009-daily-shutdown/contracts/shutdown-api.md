# Contract: Shutdown API

**Feature**: 009-daily-shutdown | **Date**: 2026-08-18

What `packages/core` exposes for this feature, how the client reaches it, and — the part that matters most
— how every action on this screen reaches a verb that already exists.

---

## 1. The core surface

Exactly one new verb enters the core for this feature.

```ts
class ShutdownService {
  constructor(deps: ShutdownServiceDeps);
  /** The whole screen, read at one moment. Never rejects. */
  read(): Promise<ShutdownView>;
}
```

### Dependencies are narrowed so no write is reachable

```ts
export interface ProjectSource  { listDetailed(): Promise<Array<{ project: Project; summary: ProjectSummary }>> }
export interface TopThreeSource { current(): Promise<Week> }
export interface WaitingSource  { read(): Promise<{ items: WaitingItem[]; unreadable: UnreadableLine[] }> }

export interface ShutdownServiceDeps {
  projects: ProjectSource;
  topThree: TopThreeSource;
  waiting: WaitingSource;
  /** `calendar.md` only. `write` and `appendLine` do not typecheck. */
  vault: Pick<VaultStore, "read">;
  /** Consulted for staleness. Never for a write, because none is reachable. */
  policy: PolicyModule;
  clock?: Clock;
}
```

`ProjectService`, `TopThreeService`, and `WaitingService` satisfy these structurally, so the real services
are passed in and only their read half can be called. This is the type-level form of SC-002 and FR-053.

**Deliberately absent**: any intelligence, suggestion, or summary dependency. Absent rather than
accepted-and-unused, so a future contributor who wanted to generate something here would have to change
this constructor — a visible edit (FR-009, and the discipline Feature 6 set for `policy`).

### `read()` never rejects

Each panel is built inside its own `try`/`catch`. A source that cannot be read produces a `SourceFailure`
on its panel and nothing else; the other three are built, returned, and remain fully actionable
(FR-011b). Nothing is repaired, recreated, rewritten, or emptied (FR-011c), and no file is created by
being looked for.

### Reads per call

| Path | Reads |
|---|---|
| `topThree.current()` | `top-three.md` × 1 |
| `projects.listDetailed()` | `identity.md` × 1, each `projects/*.md` × 1 |
| `waiting.read()` | `waiting.md` × 1 |
| `vault.read(CALENDAR_PATH)` | `calendar.md` × 1 |
| `policy.decide(...)` | `policy.md` × 1 **per candidate item** — outside the count, see below |

Each **panel source** is read once, and that is what SC-013 asserts: a read count over those paths,
**filtered** the way `review-read-count.test.ts` filters to `projects/`. A bare `maxReadCount() === 1`
across everything is the wrong assertion and must not be used.

`policy.md` is deliberately outside the count. `DefaultPolicy.decide()` re-reads its configuration on every
decision — by design, so an edited rule takes effect without a restart — and staleness is a question asked
once per candidate waiting item and once per candidate flag. A shutdown over thirty stale subjects reads
`policy.md` thirty-odd times, and that is the shipped rule working rather than this feature leaking a read.
FR-011a names the exclusion, so the requirement and the assertion agree instead of quietly disagreeing.

No read happens inside a per-item loop over any panel source: the policy consultation takes two dates and a
subject, and touches no file *this feature* owns.

### New exports from `@waypoint/core` (all additive)

```ts
export { ShutdownService } from "./shutdown/shutdown-service";
export type { ShutdownServiceDeps, ProjectSource, TopThreeSource, WaitingSource } from "./shutdown/shutdown-service";
export type { ShutdownView, Panel, SourceFailure, TopThreePanel, MyProject, StaleWaiting, StaleCalendar } from "./shutdown/types";
export { CALENDAR_PATH, readCalendar } from "./calendar/calendar-document";
export type { CalendarItem } from "./calendar/types";
```

Plus one additive method on an existing class:

```ts
class WaitingService {
  /** Items and unreadable lines from one read of `waiting.md` (FR-011a). */
  read(): Promise<{ items: WaitingItem[]; unreadable: UnreadableLine[] }>;
}
```

`list()` and `unreadable()` keep their behaviour and their callers.

---

## 2. The policy seam: one point, a third subject

`DECISION_POINTS` is **unchanged and still five**. `decision-points.test.ts` is not edited.

```diff
 export interface WaitingStaleContext {
   point: "waiting.stale.check";
-  subject: "item" | "project";
+  /** For the message only. The rule and the threshold are identical for all three. */
+  subject: "item" | "project" | "calendar";
   since: string;
   today: string;
 }
```

`default-policy.ts` gains one branch in its existing `stale()` method. The comparison, the inclusive
boundary, the `allow` for unreadable and future dates, and the threshold all stay exactly as they are.

**The reason text**, for the new subject:

```text
This has been waiting to be scheduled for 14 days. Put it in your calendar, or let it go.
```

Shaped like the two that ship today — a statement of elapsed time, then a remediation naming what the
*person* does, not what the app offers. The app offers no scheduling verb and this sentence does not imply
one (FR-042). Day counts pluralize through the existing `plural()` helper.

The verdict is `warn`, never `block`, for the same reason the other two subjects are: staleness is a
prompt, and nothing here changes a byte of anything.

**Passed through untouched.** A client renders `decision.reason` as it is given. Composing that sentence in
a renderer from a day count would put domain vocabulary in a client (Principles II and VII).

---

## 3. Action routing — the heart of the contract

Every affordance on this screen calls the verb the ordinary surface calls. There is no shutdown-specific
write path, and no channel named for this screen performs a write.

| Affordance | Core verb | IPC channel | Status |
|---|---|---|---|
| Mark a top-three outcome done (FR-033) | `TopThreeService.completeOutcome(ref)` | `top-three:complete` | exists, reused |
| Mark a milestone done (FR-034) | `ProjectService.completeMilestone(slug, ref)` | `projects:complete-milestone` | exists, reused |
| Change a next action (FR-035) | `ProjectService.setNextAction(slug, expected, next)` | `projects:set-field` with field `"next-action"` | exists, reused |
| Record a follow-up (FR-036) | `WaitingService.recordFollowUp(ref)` | `waiting:record-follow-up` | **new channel, existing verb** |
| Record received (FR-036a) | `WaitingService.recordReceived(ref)` | `waiting:record-received` | **new channel, existing verb** |
| Capture (FR-043) | `CaptureService.submit(text, "typed")` | `capture:submit` | exists, reused |
| Undo a capture (FR-049) | `CaptureService.undo(id)` | `capture:undo` | exists, reused |

### Why the waiting verbs need new channels

Their only existing surface is the weekly review, and `review:record-follow-up` calls
`ReviewService.recordWaiting`, which delegates to `WaitingService` **and writes a line into
`log/YYYY-Www.md`**. That log line is the review's record of its own ritual. Reaching it from here would
write a record of the shutdown, which FR-050 forbids.

The new channels are named for the **verb**, not for this screen, so any later surface uses the same ones.

### What parity means, precisely (SC-004)

> The file change the verb owns is byte-identical to the same verb's change from the ordinary surface.

- `top-three.md` after a shutdown completion == after a top-three-window completion.
- The project file after a shutdown milestone completion == after a projects-window completion, ledger
  line included.
- `waiting.md` after a shutdown follow-up == after a review follow-up. The review's additional log line is
  the review's record, not part of the waiting action, and is not compared — and its **absence** after a
  shutdown action is itself asserted (no file under `log/` is created or modified).
- `inbox.md` after a shutdown capture == after a capture-window capture (SC-008).

### Refusals, warnings, and verify-before-write

All inherited, none re-implemented:

- Refusals are values in the established shape `{ ok: false, reason, message }` and are rendered as given.
  The same attempt refused elsewhere is refused here with the same `reason` and the same `message`
  (FR-038, SC-005).
- A `warn` presents the same choice with the same words. There is no bypass, no override, no suppression,
  and no "don't ask me again" anywhere on this screen (FR-039, FR-041).
- Every write carries the `raw` it was shown — `OutcomeRef.raw`, `MilestoneRef`, `WaitingRef.raw`, the
  `expected` next action. A mismatch cancels the write, leaves the file untouched, and the row is
  re-presented as it now reads (FR-040).

### Calendar items carry no action

There is no channel, no verb, and no ref for a calendar item. Information only (FR-042).

---

## 4. IPC and preload

### New channels

| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `shutdown:read` | invoke | — | `ShutdownView` |
| `shutdown:dismiss` | send | — | — (hides the window) |
| `shutdown:opened` | main → renderer | — | — |
| `waiting:record-follow-up` | invoke | `WaitingRef` | `WaitingOutcome` |
| `waiting:record-received` | invoke | `WaitingRef` | `WaitingOutcome` |

`shutdown:opened` exists because this window hides rather than closes and re-reads nothing on its own: it
is what makes the second opening a cold one (FR-010c, research R8). It carries no payload — it is a signal
to re-read, not data.

`shutdown:dismiss` is the window-hiding channel every other window already has. `capture:dismiss`,
`sort:dismiss`, `projects:dismiss`, `top-three:dismiss`, `review:dismiss`, and `retrospective:dismiss` all
mean the same thing and are all handled as `ipcMain.on(..., () => hide…())`; this one is handled the same
way and matched by a `dismiss()` on the bridge, as on all six. It writes nothing, decides nothing, and
carries no payload.

The name brushes against vocabulary FR-042 forbids — "no scheduling, no **dismissing**" — but that
prohibition is about *a calendar flag*, not about a window, and diverging from six shipped windows to avoid
the word would break Principle VII to fix nothing. The test that guards FR-042 is scoped to calendar items
and refs, never to channel names (T071, T073).

**No `shutdown:changed` channel exists.** This window subscribes to no change signal, by design
(FR-010a, FR-011a, research R7).

### Preload bridge

```ts
const shutdownApi = {
  read(): Promise<ShutdownView>,
  dismiss(): void,
  onOpened(handler: () => void): void,

  // The five actions, each forwarding to the channel the ordinary surface uses.
  completeOutcome(ref: OutcomeRef): Promise<TopThreeOutcomeResult>,
  completeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome>,
  /** Forwards to `projects:set-field` with field `"next-action"` — the projects window's own path. */
  setNextAction(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome>,
  recordFollowUp(ref: WaitingRef): Promise<WaitingOutcome>,
  recordReceived(ref: WaitingRef): Promise<WaitingOutcome>,

  // Capture, unchanged, on the existing channels.
  capture(text: string): Promise<{ ok: true; id: string } | { ok: false; error: "empty" }>,
  undoCapture(id: string): Promise<unknown>,
};
```

The bridge forwards; it decides nothing. It holds no threshold, no filter, no ordering, and no sentence
about the user's data.

---

## 5. Window behaviour

| Requirement | Behaviour |
|---|---|
| FR-006 | Opened only by the user: the tray's "Daily shutdown" entry. No schedule, timer, launch-on-open, end-of-day trigger, or prompt exists anywhere in the codebase to open it. |
| FR-007 | Nothing counts, stores, or displays days on which it was not opened, because nothing records that it was. |
| FR-001, FR-002 | Four panels rendered together, unnumbered, in no sequence, with no "next", no prerequisite, and no panel that must be visited first. |
| FR-003 | No condition prevents opening or prevents any part being used. `read()` never rejects. |
| FR-004, FR-005 | The window holds no state across openings. Nothing presents as complete, incomplete, passed, skipped, or in progress; nothing resumes. |
| FR-010a, FR-010b | Membership fixed at open. A row updates in place from the verb's own return value — `TopThreeOutcomeResult.week`, `ProjectOutcome`, `WaitingOutcome.item` — never from a re-read. |
| FR-012–FR-016 | The top-three panel shows the current week only. No control offers another week. |
| FR-023 | No paging, capping, collapsing, or "show more" on any panel. |

Closing while typing in the capture box captures nothing and saves no draft (US3 scenario 5).

---

## 6. Vocabulary check (Principle VII, FR-039)

Terms this feature uses, all of which already exist in the core with the same meaning: *top three*,
*outcome*, *done*, *project*, *active*, *DRI*, *next action*, *milestone*, *waiting for*, *followed up*,
*received*, *outstanding*, *calendar-flagged*, *stale*, *capture*, *inbox*, *undo*.

Terms this feature introduces into the core: **none**. "Shutdown" names a window and a read verb; no file,
field, record, or line of user data uses the word, and there is nowhere it could be written.
