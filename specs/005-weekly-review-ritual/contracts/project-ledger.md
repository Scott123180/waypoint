# Contract: The project ledger, and waiting-for actions

**Feature**: 005-weekly-review-ritual

Two append-only histories, in two files that already exist. Both follow the same idea — a record keeps its
identity and accumulates what happened to it — expressed in whatever grammar each file already has.

---

## `## Ledger` in a project file

Extends Feature 3's format the way Feature 3 extended Feature 2's: a new section beside the existing ones,
above `## Unprocessed`, with **no file on disk rewritten to add it**. A project gains its ledger the first
time an action is recorded against it (FR-099).

```markdown
# Migration cutover

status: waiting
next action: chase the vendor contract
dri: Scott Rodgers

## Outcome

The old cluster is switched off and nothing is running on it.

## Milestones

- [x] Runbook reviewed by SRE — verified by Priya — done 2026-06-30
- [ ] Cutover rehearsed end to end — verified by Priya

## Ledger

- 2026-06-02 status active → waiting — after 21d active
- 2026-07-14 status waiting → active — after 42d waiting
- 2026-08-01 status active → waiting — after 18d active

## Unprocessed

- 2026-08-09T16:02:11-04:00 vendor said the contract needs legal review
```

### Grammar

```text
entry    := "- " date " " action " " detail [" — after " days "d " state]
date     := YYYY-MM-DD          # local calendar date
action   := a verb, lowercase   # "status" is the only one this feature writes
detail   := everything up to the optional tail, verbatim
days     := whole days the ended state lasted
state    := the state that ended
```

For a status change, `detail` is `<from> → <to>`.

### Rules

| Rule | Why |
|---|---|
| **Oldest first; appends land at the section's end.** | Cheapest surgical write, smallest git diff, and "the most recent entry that entered the current status" is a last-match scan. |
| **Written by the core verb performing the action** — `setStatus`, `complete`, `reopen` — never by the review or a client (FR-092). | The same action from the projects window, the review, or Feature 7's API must produce an identical entry. |
| **One atomic write.** The entry and the `status:` line are composed into a single content transform and written once. | A crash between two writes would leave a status the ledger does not explain. `writeField` already takes a transform, so this is the natural shape. |
| **A no-op status change appends nothing.** `from === to` writes no entry. | An entry records a change; recording a non-change would put noise in the record and reset the duration clock. |
| **The tail is written only when the ledger knows.** No prior entry entering the ended state means no ` — after …` (FR-094). | The date is only observable at the transition. Inferring one would be the invented capture timestamp the inbox already refuses. |
| **Never rewritten, reordered, compacted, or removed** (FR-091), including entries the user wrote by hand. | It is an append-only record; there is no verb that edits an entry. |
| **`status:` stays the source of truth** for what the project is; the ledger says how it got there. Where they disagree, both are shown as they read and neither is repaired (FR-095). | A hand-edit can always reach a state the app would not have written. Silently rewriting the user's file is the thing plain text exists to prevent. |
| **Only status changes this feature** (FR-090). | The shape generalises — `- 2026-08-15 milestone done Ship the runbook` fits it — but an entry must not duplicate state the file already carries, and a milestone's completion date stays on the milestone. |

### Derived: `statusSince`

```ts
/** `on` of the LAST entry whose detail ends "→ <project.status>", else null. */
statusSince: string | null
```

Exposed on `ProjectSummary` beside `gaps` and `needsDri` — derived on every read, never stored, for the same
reason those are: a stored copy drifts the first time the user edits the file in vim.

`null` means unknown, and unknown is never stale (FR-094). Last-match rather than first is what makes a
project that has bounced between statuses report its *current* spell rather than its first one.

---

## Actions in `waiting.md`

Feature 2's line shape is unchanged. Actions are **nested list items** beneath their item:

```markdown
- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved
  - followed up 2026-08-20
  - followed up 2026-08-27
- 2026-07-02 @roofer — Send the revised estimate
  - received 2026-08-14
- 2026-08-13 @legal — Contract review
  this one had a second line of text the user typed
```

```text
item-line   := "- " waiting-since " @" owner " — " [capture-timestamp " "] text   # unchanged
action-line := indent "- " ("followed up" | "received") " " date
continuation:= indent <anything else>                                            # item text, unchanged
```

### Why a nested bullet rather than a bare indented line

Feature 2's grammar already uses two-space indentation for continuation lines of the item's own text, so a
bare `  followed up 2026-08-20` would be ambiguous with the second line of a multi-line thought. Resolving
that ambiguity wrongly would either swallow the user's words or invent a follow-up. A nested bullet is
unambiguous against that grammar, renders correctly as markdown, and greps cleanly (research R8).

### Rules

| Rule | Why |
|---|---|
| **`waiting-since` is never rewritten** (FR-043a). | Total age is what tells "chased weekly for three months" from "delegated on Tuesday". |
| **Actions accumulate**; a second follow-up never replaces the first (FR-043b). | It is a history, not a status field. |
| **A received item stays in the file**, with its history (FR-043c). Nothing is deleted, moved, or archived. | The habit `trash.md` established: the file grows, and pruning is the user's business. |
| **A hand-written action line reads exactly like a written one** (FR-043d). | The file is the record, whoever wrote it. |
| **Writes verify the item's block first.** `WaitingRef { index, raw }` must still match on disk, or the write is refused with `entry-changed` and nothing is touched. | The deliberate analogue of `MilestoneRef` and `OutcomeRef`. |

### Derived

- **`outstanding`** = no `received` action. Only outstanding items are counted or surfaced (FR-039, FR-042).
- **`untouchedSince`** = the date of the last action, or `waiting-since` when there are none. This is what
  the staleness rule is asked about (FR-037) — chasing something is touching it, so it quiets for a week
  while its total age stays visible.
- **Unparseable lines** are shown as they read, never dropped, never rewritten (FR-044).
