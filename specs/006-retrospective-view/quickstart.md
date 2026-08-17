# Quickstart: Retrospective View

**Feature**: 006-retrospective-view | **Date**: 2026-08-16 | **Plan**: [plan.md](./plan.md)

How to run and validate this feature end to end. Scenarios map to the spec's success criteria; the shapes they
exercise are in [data-model.md](./data-model.md) and the text they assert against is in
[contracts/report-format.md](./contracts/report-format.md).

---

## Prerequisites

```bash
nvm use              # .nvmrc pins Node 22; the system node is stale
npm install
```

`TZ=America/New_York` is set by the test scripts and is load-bearing — week spans and completion-date
comparison are local-calendar facts, and a machine in another zone would otherwise disagree with CI about
which week a Sunday belongs to.

---

## Build and test

```bash
npm run build          # core, then desktop + renderer
npm run test:core      # the fast loop while building this feature
npm test               # core + desktop
npm run test:e2e       # Playwright, for the window behaviour in scenarios 6–8
npm run typecheck
```

While iterating on core only, `npm run test:core` is the loop. The `Pick<>` dependency boundary means a stray
write attempt fails `typecheck` rather than a test — run it before assuming a red test is the whole story.

---

## Run the app

```bash
npm run dev
```

Open the retrospective from the tray menu. It opens with no range chosen and reads nothing until one is
submitted — the window never runs a query the user did not ask for.

---

## Fixture vault

Most scenarios below need a vault with history. Build one under a scratch directory and point the app at it
with the existing vault-path config:

```text
<vault>/
├── projects/
│   ├── payments-migration.md     # done 2026-09-30, 4 milestones, ledger with 4 entries
│   ├── vendor-consolidation.md   # active, 2 milestones done, 1 undated
│   ├── onboarding-rewrite.md     # done, no completion date  → undated
│   └── legacy-cleanup.md         # hand-edited: completedOn set, status: active
├── top-three.md                  # ~14 weeks, outcomes done in and out of range,
│                                 # one unparseable line, one done with no date
└── log/
    ├── 2026-W20.md               # complete, note + slipped + waiting records
    ├── 2026-W21.md               # complete, no note
    ├── 2026-W22.md               # status: in progress
    └── 2026-W12 copy.md          # not a week file → unreadable source
```

The fixture is deliberately unkind: every "shown as it reads, never repaired" requirement has a file that
exercises it.

---

## Scenario 1 — A range answers with what was completed in it (SC-002, US1)

1. Open the retrospective, set `2026-01-01` to `2026-12-31`, submit.
2. Expect a `## Completions` section counting every dated completion in range, newest first, each milestone
   naming its project.
3. Change the start to `2026-09-14` — the day one milestone was completed. It is still present: endpoints are
   inclusive.
4. Change it to `2026-09-15`. It is gone, and the count dropped by one.

**Also verify**: submit `2026-12-31` to `2026-01-01`. Refused, naming both dates and stating that the end
precedes the start. Nothing is read and nothing is shown.

---

## Scenario 2 — Undated work is shown as undated, never placed (SC-005, US1)

1. With the full-year range, find `## Undated`.
2. `onboarding-rewrite` (done, no date) is listed there and nowhere else.
3. The milestone whose date reads `2026-13-45` is listed as `(undated: "2026-13-45")` — verbatim, quoted, and
   absent from `## Completions` however plausible the string looks.
4. Open `vendor-consolidation.md` in an editor. Nothing has been corrected.

---

## Scenario 3 — Completions do not depend on reviews (SC-006, US3)

1. `2026-W22` has a completion recorded in it and its review is still in progress; `2026-W23` has a completion
   and no log at all.
2. Both completions appear in `## Completions`.
3. `2026-W23` appears in the unreviewed report at the foot of `## Weekly notes`, named by identifier.
4. `2026-W21` shows `Note: none recorded.` — a reviewed week that wrote nothing, distinct from an unreviewed
   one (SC-007).
5. `2026-W22` is marked `— review incomplete` and shows what it has, completed by nobody.

**Then**: delete the whole `log/` directory and re-read. Every week in range is named in the unreviewed
report, nothing errors, and `log/` is **not** recreated.

---

## Scenario 4 — Narrowing (SC-010, SC-014a, US4, US6)

1. Narrow to *Payments migration*.
2. `## Completions` holds that project's milestones and its own completion, and nothing else.
3. `## Weekly outcomes` and `## Weekly notes` are replaced by their stated reasons — not by empty lists.
4. `## Project history` appears, one line per ledger entry, with `— after 67d active` only where the entry
   records it.
5. Clear the filter. `## Project history` is gone entirely, and the report is byte-identical to the one from
   scenario 1.

**Also verify**: narrow to *legacy-cleanup* (the hand-edited one). Its status field and its last ledger entry
disagree; both are printed and neither is repaired.

---

## Scenario 5 — Export is the thing on screen (SC-011, SC-012, US5)

1. With any reading on screen, click Copy. Paste into a text editor.
2. It matches what the window shows, entry for entry, including the `(undated)` labels, the unreviewed report,
   and any "Not shown:" reasons.
3. Click Save. The dialog's default directory is **not** inside the vault. Save it anywhere.
4. Open the saved file with the app closed. It states its range, its filter if any, and reads as a document.
5. `git status` in the vault: clean. Exporting wrote nothing there (SC-004).

---

## Scenario 6 — The reading is held, and says when it is stale (SC-020, SC-021)

1. Open a retrospective over a range that includes this week.
2. With the window open, mark a milestone done in the projects window.
3. The retrospective's entries **do not move**. A notice appears saying the data has changed.
4. Copy the report now: it matches what is on screen, without the new completion (SC-021).
5. Click the notice's re-read action. The new completion appears.
6. Dismiss without re-reading and leave it: the reading stays readable and exportable as a true account of
   when it was read.

---

## Scenario 7 — Nothing is ever written (SC-004)

```bash
find <vault> -type f -exec sha256sum {} + | sort > /tmp/before
# in the app: read a range, narrow, view a history, copy, save (outside the vault)
find <vault> -type f -exec sha256sum {} + | sort > /tmp/after
diff /tmp/before /tmp/after     # expect no output
```

This is a regression net, not the primary guarantee — `RetrospectiveService` cannot reach a write verb,
because `Pick<VaultStore, "list" | "read">` does not have one.

---

## Scenario 8 — Offline (SC-016)

Disable networking entirely and repeat scenarios 1, 4, 5, and 6. Everything works, including the export.
Nothing in this feature has a network path to lose.

---

## Scenario 9 — Scale (SC-001, SC-019, SC-022)

Generate a fixture with 100 projects and ~2,000 completions spread over four years, then:

1. Read `2022-01-01` to `2026-12-31`. The first entry is visible within 10 seconds (SC-001).
2. The `## Completions` count equals the fixture's dated-in-range total — nothing capped, sampled, or held
   behind a page (SC-022). Scroll to the oldest entry and confirm it is reachable.
3. Export and count the lines: same total (SC-022).
4. The unreviewed report names every missed week of the ~209 in range, in one line, with no threshold
   behaviour (SC-007a).

The read-count assertion for this range lives in the core suite rather than here — counting reads is what
SC-019 asks for, and a stopwatch on a laptop proves nothing about the shape of the algorithm.

---

## Scenario 10 — Determinism (SC-003)

Read the same range twice without touching the vault and diff the two exports. No output. Include a fixture
where two milestones on different projects share a completion date — that is the case a naive implementation
gets wrong, and the tie-break exists for it.

---

## Where the assertions live

| Concern | Where |
|---|---|
| Selection, ordering, grouping, undated handling, unreadable sources | `packages/core/tests/retrospective-*.test.ts` |
| Report text, counts, stated reasons, empty sections | `packages/core/tests/report-format*.test.ts` |
| Byte-for-byte immutability, read counts, offline, determinism | `packages/core/tests/retrospective-{immutable,reads,offline,deterministic}.test.ts` |
| Nothing is generated, summarized, or reworded | `packages/core/tests/report-nothing-generated.test.ts` |
| Held reading, change notice, no pagination, save dialog default directory | `packages/desktop/tests/e2e/*.spec.ts` — `playwright.config.ts` sets `testDir` there, and a spec placed anywhere else is silently never run |
| Decision-point count unchanged at five | existing `packages/core/tests/decision-points.test.ts`, unmodified |

That last row is the point worth checking first on any change: if `decision-points.test.ts` needs editing,
something has gone wrong — this feature adds no rule.
