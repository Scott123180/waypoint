# Quickstart: Validating the Weekly Review Ritual

**Feature**: 005-weekly-review-ritual

How to prove this feature works, end to end, on the development machine. Formats are in
[contracts/](./contracts/); shapes are in [data-model.md](./data-model.md). Nothing here needs a network.

---

## Prerequisites

```bash
nvm use                 # .nvmrc pins Node 22; the system node is stale
npm install             # only if node_modules is absent
```

Everything runs on the Ubuntu development machine. macOS builds come from GitHub Actions on a macOS runner
and are downloaded as release artifacts — nothing is built or installed on the work machine.

## Build and test

```bash
npm run typecheck       # core + desktop main + renderer
npm test                # node --test over compiled output, TZ=America/New_York
npm run test:core       # faster loop while working in packages/core
```

`TZ` is pinned and load-bearing: week boundaries and staleness are local-date facts, and a machine in UTC
would silently disagree about which day a review belongs to.

### The three guard suites

These fail for reasons ordinary tests do not catch. Run them deliberately after any change to the walk, the
seam, or the port.

```bash
# Every rule gives the same answer inside the review as outside it.
node --test packages/core/dist/tests/review-parity-*.test.js

# The walk reads each project file at most once — counted, not timed, so a
# quadratic implementation fails on fast hardware too.
node --test packages/core/dist/tests/review-read-count.test.js

# A provider sees the review record and nothing else.
node --test packages/core/dist/tests/summary-payload.test.js
```

### Regression net

```bash
git stash list                 # confirm nothing local is masking a failure
npm test 2>&1 | tail -40
```

Feature 3 and Feature 4 suites must pass. **Ten existing test files changed** — corrected during
implementation from the "exactly one" this section originally claimed. Nine changed because a *shape* grew
(a decision point added, a config key added, a field added to `Project` or `ProjectSummary`); one,
`project-service.status.test.ts`, because a *behaviour* changed: a status change now also appends a ledger
entry, and that test asserted it changed nothing but the status line. Every one is listed with its reason in
[tasks.md](./tasks.md) under "The existing tests that change".

The rule still stands, and is what makes the list worth keeping: **an edit to an old test that is not
recorded there is a behaviour regression wearing a test change as a disguise.**

```bash
git diff --stat packages/core/tests/    # every file listed must appear in tasks.md
```

---

## Manual validation in the running app

```bash
npm run dev
```

Use a scratch vault, not your real one:

```bash
export WAYPOINT_VAULT=/tmp/waypoint-review-check
mkdir -p "$WAYPOINT_VAULT/projects"
```

### 1. The ritual writes a record

Seed a project, an inbox item, and a waiting-for item, then run the review through all four steps.

**Expect**: `log/<current ISO week>.md` exists. While you are mid-review it reads `status: in progress` with
a `step:` naming where you are. After completion it reads `status: complete` with a `completed:` date. Open
it in an editor with the app closed — every decision is legible without the application
([review-log-format.md](./contracts/review-log-format.md)).

### 2. Pause and resume

Get four projects into the walk, quit the app entirely, reopen, and start the review again.

**Expect**: it resumes on the fifth project, not the first. The four decisions are still in the file. Nothing
asks you about a project you already handled. Confirm the resume position is *derived* by deleting one
project's line from `## Projects` by hand and reopening — that project is offered again.

### 3. The inbox gate is a rule

With items in the inbox, reach the end of the inbox step.

**Expect**: a warning naming the count, which you can proceed past. Now add `inbox gate: block` to
`policy.md`, reopen, and try again: you cannot advance, and the message says sorting the inbox is what
unblocks it. Remove the line — the default returns with no file needed
([policy-seam.md](./contracts/policy-seam.md)).

### 4. Staleness is one rule with two subjects

Hand-write a `waiting.md` item dated 30 days ago and take a project to `waiting`, then backdate its ledger
entry by hand.

**Expect**: both are surfaced as stale, both say how long, and both quiet down when you set
`staleness days: 60`. One key governs both — there is no way to configure them apart.

### 5. The ledger records how a project got here

Change a project's status from the review, then from the projects window.

**Expect**: identical entries in `## Ledger`, differing only in date and states — the entry is written by the
verb, not by the surface. Now hand-edit a project's `status:` to `waiting` without touching its ledger.

**Expect**: it is walked, its waiting duration reads as unknown, and it is never flagged stale. No date is
invented ([project-ledger.md](./contracts/project-ledger.md)).

### 6. Actions accumulate; nothing is deleted

Follow up on a waiting-for item twice, then mark it received.

**Expect**: two `followed up` lines and a `received` line nested under the item, the original
`waiting-since` date untouched, the item gone from the outstanding count, and its full history still in the
file.

### 7. The week ahead

Complete the top-three step.

**Expect**: the reviewed week's outcomes shown with their done state and markable done; commitments land in
the **next** week's section in `top-three.md`. Open the ordinary top-three window: next week is editable
there too — the widening is not a review-only power. Try to write a week two ahead: refused, with the
message naming the writable weeks. Try to write last week: refused with `past-week`, unchanged from
Feature 4.

### 8. Offline, and no provider

Disable networking entirely and run a full review.

**Expect**: every step works, including completion. No summary affordance appears at all — not a disabled
one ([summary-port.md](./contracts/summary-port.md)). The note is empty until you type in it, and skipping it
completes the review with the log recording that none was written.

---

## Verifying the ledger by hand

```bash
grep -A5 '## Ledger' "$WAYPOINT_VAULT/projects/"*.md
```

Entries are oldest first, one line each, with a ` — after Nd <state>` tail only where the ledger itself knew
when the ended state began. Nothing above the newest line should ever change between runs — if an older entry
moved or was rewritten, the append-only guarantee is broken.

## Verifying nothing was migrated

```bash
git -C "$WAYPOINT_VAULT" status --short
```

A project you did not act on must not appear. A project gains its ledger the first time an action is recorded
against it, never by being rewritten on read.
