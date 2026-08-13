# Contract: Projects IPC

**Renderer ↔ main** | **Feature**: 003-project-structure

Every channel is a pass-through to `ProjectService` or `AreaService`. Follows
[Feature 2's sort IPC](../../002-inbox-view-sort/contracts/ipc-sort.md) exactly: the main process
translates types that cannot cross the bridge and does nothing else.

**Deliberately absent**: any channel that would let the renderer write a project file directly, set a
completion date, compute the incomplete flag, or mark a project done without going through the confirmation
path. The client cannot hold domain logic it has no way to express.

---

## Invoke channels

| Channel | Args | Returns |
|---|---|---|
| `projects:list-active` | — | `ProjectSummary[]` — the active list, decided by the core |
| `projects:list-completed` | — | `ProjectSummary[]` — finished projects, likewise decided by the core |
| `projects:list` | — | `ProjectSummary[]` — every project, done included |
| `projects:get` | `slug` | `Project & { gaps }` \| `null` — the gaps travel with the project |
| `projects:create` | `title` | `ProjectOutcome` |
| `projects:set-field` | `slug`, `field`, `expected`, `next` | `ProjectOutcome` |
| `projects:add-milestone` | `slug`, `definitionOfDone`, `verifier` | `ProjectOutcome` |
| `projects:edit-milestone` | `slug`, `ref`, `definitionOfDone`, `verifier` | `ProjectOutcome` |
| `projects:remove-milestone` | `slug`, `ref` | `ProjectOutcome` |
| `projects:complete-milestone` | `slug`, `ref` | `ProjectOutcome` |
| `projects:reopen-milestone` | `slug`, `ref` | `ProjectOutcome` |
| `projects:complete` | `slug`, `opts?` | `ProjectOutcome` |
| `projects:reopen` | `slug`, `to` | `ProjectOutcome` |
| `projects:dismiss-unprocessed` | `slug`, `index`, `expectedRaw` | `ProjectOutcome` |
| `areas:list` | — | `AreaSummary[]` |
| `areas:get` | `slug` | `Area \| null` |
| `areas:create` | `title` | `AreaOutcome` |
| `areas:set-field` | `slug`, `field`, `expected`, `next` | `AreaOutcome` |
| `areas:dismiss-unprocessed` | `slug`, `index`, `expectedRaw` | `AreaOutcome` |

`projects:set-field` collapses the four scalar setters into one channel with a `field` discriminator rather
than four near-identical handlers. The core keeps them as distinct verbs; the bridge is plumbing, and this
is the one place a small amount of dispatch is cheaper than the repetition.

`capturedAt` on an unprocessed item crosses as an ISO string or `null` — never a `Date`, and never a
substituted date for a hand-written item, matching `sort:next`'s handling of the same field.

## Send channels

| Channel | Direction | Meaning |
|---|---|---|
| `projects:dismiss` | renderer → main | Hide the window. |
| `projects:refresh` | main → renderer | The window was shown. Redraw everything. |
| `vault:changed` | main → renderer | Something wrote a project or area file. Re-read; do not disturb what the user is editing. |

`vault:changed` is named for the fact, never the cause — the counterpart to Feature 2's `inbox:changed`. It
says nothing about whether an outcome was edited, a milestone completed, or a status changed, so a future
writer (Feature 6's API, Feature 8's LLM layer) needs no new channel and no view needs to learn it exists
(research R7).

It is a **separate** channel from `inbox:changed` rather than a reuse: `inbox:changed` fires on every
capture, which for a projects window is pure noise. Both are generic with respect to cause; they differ in
subject.

The split between `projects:refresh` and `vault:changed` mirrors `sort:refresh` versus `inbox:changed`:
opening the window redraws everything, while a mid-session signal must not throw away what the user is
currently typing into a field.

---

## What the renderer does

Reads what it is given, sends back what the user typed. Specifically it does **not**:

- decide whether a project is incomplete — it renders the `gaps` that arrive with the project. They are
  attached by the core's own `structureGaps`, not looked up from a list, because status must have no
  effect on the flag: sourcing them from the *active* list would report every finished project as fully
  structured (FR-020, FR-021)
- count milestone progress — it renders `milestonesDone` / `milestonesTotal` (FR-017)
- decide or filter which projects belong in the active list — it calls `projects:list-active` and renders
  what comes back (FR-032). Filtering on `status` in the renderer would put the rule in the client.
- decide whether completing a project needs confirming — it renders the `open-milestones` refusal it gets
  back and calls again with the flag when the user confirms (FR-034a, research R8)
- know what a milestone cap is — it renders the `milestone-cap` refusal (FR-013)
- format a completion date — dates arrive as strings already formatted by the core (research R10)
