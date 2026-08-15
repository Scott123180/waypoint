# Phase 0 Research: Weekly Review Ritual

**Feature**: 005-weekly-review-ritual | **Date**: 2026-08-15

Decisions taken before design, each with what was rejected. Everything here is constrained by three
inheritances: Feature 2's file grammars, Feature 3's project format and verify-before-write habit, and
Feature 4's policy seam and ISO week.

---

## R1 — Where the ritual lives

**Decision**: A new sibling module `packages/core/src/review/`, alongside `capture/`, `inbox/`, `sort/`,
`projects/`, `identity/`, `policy/`, and `weekly/`. `ReviewService` is the single entry point, in the shape
`SortService`, `ProjectService`, and `TopThreeService` already have: injected ports, fresh reads, refusals
as values.

**Rationale**: The organising principle in this repo is one module per bounded piece of domain, one service
class as its only entry point. The review is a piece of domain, not a client concern — the future HTTP API
must be able to run a review, which it cannot if the sequence lives in a renderer.

**Alternatives rejected**: *Putting the sequence in the desktop client* — the sequence is the feature; a
renderer holding it would mean Feature 7 reimplementing it to agree (Principle II). *Spreading the steps
across the existing services* — no single object would own "which step am I on", and resumability would
have nowhere to live.

---

## R2 — The in-progress review is the log file

**Decision**: One file per week at `log/YYYY-Www.md`, created when the review starts, carrying
`status: in progress` in its preamble until completion flips it to `complete`. No separate state file, no
journal, no promotion step.

**Rationale**: The spec requires both "each decision is saved as I go" and "when I finish, the review is
written to a log file for that week" — one file satisfies both if the file exists from the start and says
plainly that it is unfinished. It also means there is no machine state sitting beside the record that could
disagree with it, nothing orphaned when the process dies, and the partial review is inspectable by hand
exactly like the finished one.

**Alternatives rejected**: *A `.review-state.json` promoted at completion* — a second representation of the
same decisions, dot-prefixed and unreadable, in a vault whose whole promise is plain text (Principle IV).
*A write-ahead journal like `sort/`* — sort needs one because it commits across two files and must be
effectively-once; the review appends to a single file, where a crash costs at most the one line being
written.

---

## R3 — Position is derived from the record, not stored as a cursor

**Decision**: The preamble carries `step: <name>` — the step the review is on. Position *within* the project
walk is derived: the next project to present is the first in the walk set with no line recorded against it in
`## Projects`.

**Rationale**: The same habit as the structure flag and the DRI resolution — derived state cannot drift, and
a hand-edit is honoured for free. It also answers what a stored index cannot: if a project is completed in
another window mid-review, a stored index points at the wrong project, whereas "first one not yet recorded"
is still correct. `step:` itself must be stored because a step can be passed having decided nothing (an
empty waiting-for list), and "passed with no decisions" is otherwise indistinguishable from "not reached".

**Alternatives rejected**: *Storing a project index* — breaks the moment the walk set changes, which it
demonstrably does mid-review. *Deriving `step` too* — cannot represent a step passed with an empty result.

---

## R4 — The ledger entry shape

**Decision**: An append-only `## Ledger` section in the project file, oldest first, one line per action:

```text
- 2026-06-02 status active → waiting — after 21d active
- 2026-08-15 status waiting → active — after 74d waiting
```

Grammar: `- <date> <action> <detail>[ — after <N>d <state>]`. The duration tail is written only when the
ledger itself says when the ended state began; there is no other source, and none is invented.

**Rationale**: `<action> <detail>` generalises without renegotiating what an entry means — a later
`- 2026-08-15 milestone done Ship the migration` fits the same three fields, and a later record type
(an area, a waiting-for item) can carry the same section unchanged (FR-098). Oldest-first append keeps
writes at the section end, which is the cheapest surgical write and the smallest git diff, and makes
"the most recent entry that entered the current status" a last-match scan.

**Alternatives rejected**: *A `waiting since:` preamble field* — answers exactly one question and would need
a sibling the next time a feature wanted a duration; the user rejected it directly. *Newest-first, matching
`top-three.md`* — that file is ordered for reading, where the current week is what you want first; a ledger
is read by machine and appended to constantly, and prepending rewrites the section head on every write.
*A separate `ledger/<slug>.md`* — splits a project across two files, so a `git log` on the project no longer
shows its history.

---

## R5 — Ledger writes belong to the status verbs, in the same write

**Decision**: `ProjectService.setStatus`, `.complete`, and `.reopen` compose the ledger append into the same
content transform as the status field change, producing one `vault.write`. A no-op change (`from === to`)
appends nothing.

**Rationale**: One write means one atomic rename, one change signal, and no state where the status moved but
the ledger did not. Putting it in the verb rather than in the review is what makes the entry identical
whether the change came from the review, the projects window, or Feature 7's API (FR-092) — and
`writeField` already takes a content transform, so composition is the natural shape rather than a new path.

**Alternatives rejected**: *The review writing its own entries* — the same action from another surface would
go unrecorded, and the review would hold behavior no other client has. *A second write after the status
write* — a crash between them leaves a lie on disk, and it doubles the change signal.

---

## R6 — Two decision points, named for their subjects

**Decision**: `DECISION_POINTS` grows from three to five:

| Point | Consulted | Context | Default rule |
|---|---|---|---|
| `review.inbox.advance` | Advancing past the inbox step | `{ inboxCount }` | `warn` when count > 0, configurable to `block` |
| `waiting.stale.check` | Per waiting-for item **and** per waiting project | `{ subject, since, today }` | `warn` when older than the threshold, else `allow` |

One point serves both staleness subjects, with `subject: "item" | "project"` carried for the message only.

**Rationale**: The user's instruction is explicit — same rule, same point, same threshold, not separately
configurable — and a single point is the only shape that makes that structural rather than a promise. The
staleness point is *not* namespaced under `review.` because the thing being judged is a waiting subject, not
a review step; Feature 9's daily shutdown will consult it for the same reason.

`warn` is the natural verdict for staleness: the closed set is `allow`/`warn`/`block`, "this has gone quiet"
is exactly a warning with a displayable reason, and `block` would be wrong because nothing is being refused.

**Alternatives rejected**: *A generic `review.step.advance`* — would be declared for four steps with a rule
registered against one, which FR-080 forbids. *Separate item and project staleness points* — invites two
thresholds, which the user ruled out. *Core reading `staleness days` and comparing itself* — that is the rule
back in core wearing a different hat; asking policy per subject keeps the threshold, the comparison, and the
wording of "21 days" all on the policy side.

**Cost, recorded**: `packages/core/tests/decision-points.test.ts` asserts `DECISION_POINTS.length === 3` and
the exact set. It must change to 5. This is the one existing test this feature edits, and it is legitimate:
the count is the thing that changed, not behavior that drifted. Feature 4's `ports/index.ts` anticipates it
in as many words — "when a future feature needs a fourth, it adds it then". Every other Feature 3 and
Feature 4 test must pass unmodified.

---

## R7 — Staleness cost is per subject, and configuration is read per decision

**Decision**: Accept one `policy.md` read per staleness decision, as `DefaultPolicy.decide` already does for
every other point. Budget the waiting-for step at 200 items.

**Rationale**: `decide()` re-reads config every call deliberately — it is what lets a user edit `policy.md`
and see the rule change without restarting. A waiting-for list is tens of items, not thousands, and the read
is a single small file the OS has cached. Introducing a per-step config cache to save it would reintroduce
exactly the staleness the fresh read exists to avoid.

**Alternatives rejected**: *Batching one decision for the whole list* — the reason string is per subject
("21 days"), so a batch decision could not carry it. *Caching config for the duration of a step* — a
measurable complication for an unmeasured cost.

---

## R8 — Waiting-for actions are nested list items, not bare continuation lines

**Decision**: An action is an indented `  - ` line beneath its item:

```text
- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved
  - followed up 2026-08-20
  - received 2026-08-27
```

Parse rule: an indented line matching `^\s+- (followed up|received) (\d{4}-\d{2}-\d{2})\s*$` is an action;
any other indented line is item text.

**Rationale**: Feature 2's item grammar already uses two-space indentation for *continuation lines of the
item's own text*, so a bare `  followed up 2026-08-20` would be ambiguous with the second line of a
multi-line thought — and resolving that ambiguity wrongly would either swallow the user's text or invent a
follow-up. A nested bullet is unambiguous against that grammar, reads correctly as markdown, and greps
cleanly (`grep -A2 '@Priya' waiting.md`).

**Alternatives rejected**: *Appending dates to the item's own line* — makes a long line longer and puts three
dates where the format has one slot. *A separate `received.md`* — the user chose to keep the record in place.
*Rewriting the `waiting-since` date on follow-up* — destroys total age, which the user explicitly wanted
preserved.

---

## R9 — Widening the writable window without a second write path

**Decision**: `weekly/iso-week.ts` gains `weekStart(id: WeekId): Date` and `nextWeek(id: WeekId): WeekId`,
both built on the existing `isoWeek`. `TopThreeService` gains a writable window of `[current, next]`:
`addOutcome(text, week?)` takes an optional week defaulting to current; `verify()` keeps the existing
`past-week` refusal for anything earlier and adds `future-week` for anything beyond next.

**Rationale**: The widening is a property of the top three, not of the review, so it lands in
`TopThreeService` and every surface inherits it (FR-049a). `nextWeek` is defined as
`isoWeek(weekStart(id) + 7 days)`, so there is exactly one implementation of week arithmetic in the repo and
the round trip `isoWeek(weekStart(id)) === id` is assertable over a multi-year fixture.

Keeping `past-week` untouched matters: `top-three-preservation.test.ts` asserts that reason for writes to
earlier weeks, and that test must pass unmodified.

**Alternatives rejected**: *A review-only path that writes next week* — behavior existing only inside the
ritual, which the architecture forbids. *Reusing `past-week` for future weeks* — one reason for two opposite
situations, and the message could not name what to do. *Making the window configurable* — nobody asked, and
it would be a rule, which means policy, which means a sixth decision point for no demand.

---

## R10 — The summary port, and why absent means absent

**Decision**: `SummaryProvider` joins `TranscriptionPort` in `ports/index.ts`. `ReviewService` takes it as an
optional dependency. **Absent means no summary** — the opposite of `PolicyModule`, where absent means the
default rules.

Acceptance is structural: `draftSummary()` returns a draft or "unavailable"; `complete({ note, summary? })`
records only what the caller passes back. Core has no path that writes a draft it produced.

**Rationale**: The asymmetry is the point and needs saying out loud, because the two look alike. A rule that
could be dropped by forgetting an argument is a bypass, so policy must default to enforcing. A summary that
appeared because an argument was forgotten would be generated text nobody asked for, so summaries must
default to nothing. Making acceptance an argument rather than a flag means "record without asking" is not
expressible.

The provider receives the parsed review record for that week and nothing else, which is enforced by the
signature: it takes a `ReviewRecord`, not a vault.

**Alternatives rejected**: *A `summary.generate` decision point* — the seam returns text, not
allow/warn/block; overloading it would corrupt the closed decision set. *Shipping a stub provider* — a
provider is a provider, and the spec says none ships. *Passing the vault to the provider* — the privacy
boundary would then be a promise rather than a type.

---

## R11 — A third copy of markdown section handling, deliberately

**Decision**: `review/review-document.ts` parses and writes `log/YYYY-Www.md` with its own local
`sectionRange`/preamble helpers, as `weekly/top-three-document.ts` already does beside
`projects/document.ts`.

**Rationale**: The repo's established habit is a document module per document type, because the semantics
differ where it counts and a shared parser makes every difference a special case. Extracting a generic
`vault/markdown.ts` now would mean refactoring two shipped, heavily tested files to serve a third that does
not exist yet.

**Recorded as debt with a trigger**: this is the third copy. When a **fourth** document type needs section
handling, extract `vault/markdown.ts` from all four at once rather than adding a fifth. Written down here
because "we'll extract it later" is otherwise a sentence nobody can act on.

---

## R12 — Listing past reviews needs one port widening

**Decision**: `VaultStore.list(dir: "projects" | "areas")` widens to include `"log"`. `FsVaultStore`'s
implementation is already directory-generic; only the type changes, plus the `.md`-stripping which yields
the week id.

**Rationale**: Past reviews cannot be enumerated by guessing week ids — only the directory knows which weeks
exist. The alternative, deriving candidate ids and probing each with `read()`, is 52 reads a year to avoid a
one-word type change.

**Alternatives rejected**: *A new `listLogs()` port method* — a second listing verb for the same operation.
*Storing an index of reviews* — derived state that drifts the first time a file is added by hand.

---

## R13 — What the client gets

**Decision**: A fourth window — `review-window.ts`, `review.html`, `review.ts` — plus `registerReviewIpc`,
a `reviewApi` in the preload, a tray entry, and the `build:renderer` script copying `review.html`. It
subscribes to the existing generic `vault:changed` signal, as the projects and top-three windows do.

**Rationale**: Every existing view is its own window with its own IPC namespace; a fifth mode inside the
projects window would mix two vocabularies in one surface. The change signal is raised by `FsVaultStore`,
so a review write announces itself to the projects and top-three views with nothing new to remember
— which is exactly the behavior recorded in `fs-vault-store.ts` as the reason the signal lives there.

**Alternatives rejected**: *A review mode in the projects window* — the walk is one of four steps, and the
step list has no home there. *No client at all this feature* — core-only would ship a ritual nobody can run.

---

## R14 — Test strategy

**Decision**: `node --test` over compiled output under `TZ=America/New_York`, as the existing suites run.
Three specific guards beyond ordinary unit coverage:

1. **Parity tests.** Each of the WIP limit, the milestone cap, and the open-milestone confirmation is
   exercised twice — once through the ordinary verb, once through the review — asserting identical verdict,
   message, and subjects. Same fixture, same assertions, one test file per rule.
2. **Read counting.** The fake `VaultStore` counts `read()` calls per path; the project step asserts one read
   per project file, so a quadratic walk fails on a fast machine (SC-016).
3. **Payload containment.** A stub `SummaryProvider` records what it was handed; the fixture puts distinctive
   marker strings in a project file, `inbox.md`, and `identity.md`, and the test asserts none appears in the
   payload (SC-015c).

**Rationale**: Each guards a property that is invisible to ordinary testing and expensive to lose: behavioral
divergence between surfaces, an algorithmic regression hidden by fast hardware, and a privacy boundary.

**Alternatives rejected**: *Timing-based performance assertions* — flaky, and they pass on a fast machine
with a quadratic algorithm. *Trusting review-side parity by inspection* — the divergence this guards against
is exactly what nobody notices.
