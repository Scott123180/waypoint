# Quickstart: Daily Shutdown

**Feature**: 009-daily-shutdown | **Date**: 2026-08-18 | **Plan**: [plan.md](./plan.md)

How to run this feature's checks and prove it works end to end. Shapes and rules live in
[data-model.md](./data-model.md) and [contracts/](./contracts/); this file is the run guide.

## Prerequisites

```bash
node --version          # 22.x — `nvm use` if the shell has an older one on PATH
npm install             # workspaces: packages/core, packages/desktop
```

No new dependency is added by this feature. If `npm install` wants to change `package-lock.json`, something
is wrong with the change, not with the lockfile.

## Commands

```bash
npm run typecheck              # core + desktop main + desktop renderer
npm run test:core              # fast loop while building the service
npm test                       # everything, TZ=America/New_York
npm run test:e2e               # Playwright, packages/desktop/tests/e2e only
npm run dev                    # the app, against the configured vault
```

`TZ=America/New_York` is set by the test scripts and is load-bearing: staleness and ISO week membership are
local-calendar facts, and a run in UTC will disagree at the boundaries.

**Playwright reads `packages/desktop/tests/e2e` and nothing else.** A spec written anywhere under
`packages/desktop/tests/` outside that directory is silently never run — the mistake Feature 6 recorded
after four of its specs were addressed to the wrong place.

---

## Red first

Every task starts with a failing test, and two of this feature's headline tests can fail *vacuously* — they
pass when the code under test never ran. Both ship paired:

| Test | How it fails wrongly | Its pair |
|---|---|---|
| Byte-for-byte immutability (SC-002) | Nothing was written because nothing ran | A sibling that dirties the same fixture through the same helper and asserts the comparison fails |
| "Adds no decision point" (FR-039) | No point was consulted because no panel was built | A spy asserting `waiting.stale.check` **was** consulted, with `subject` `"item"` and `"calendar"` |

Run each new test and read its failure before writing the implementation. "Cannot find module
`../src/shutdown/shutdown-service`" is a legitimate Red for the first test in the suite; a green on first
run is not.

---

## Scenario 1 — the glance changes nothing (US1, SC-002, SC-011)

```bash
npm run test:core -- --test-name-pattern="shutdown"
```

Proves, without a filesystem:

- Four panels from a fixture with data in all four areas — the current week's outcomes open and done
  together, exactly the active-and-mine projects with their next actions and open milestones, exactly the
  waiting items at or past the threshold, exactly the calendar flags at or past it.
- An empty vault gives four explicit empty panels and zero errors.
- Opening, reading, and discarding leaves every file byte-identical — asserted over a snapshot of the whole
  fixture, and by the vault stub itself, which throws on any property but `list` and `read` with a message
  naming the requirement.
- Six DRI resolutions (mine, theirs, unassigned, ambiguous) against four statuses (active, waiting, parked,
  done) produce exactly the active-and-mine set.

Manual check for SC-001, which no unit test can make:

```bash
npm run dev     # tray → "Daily shutdown"
```

Read all four panels. The whole point is that this takes well under two minutes and needs no clicking
through. If you find yourself scrolling to see whether there is more, the panels are wrong.

## Scenario 2 — one threshold, three subjects (US1, SC-006)

```bash
npm run test:core -- --test-name-pattern="threshold"
```

Against a fixture of waiting items and calendar items dated 0–30 days old plus projects in `waiting`:

- At the default of 7: everything at or past 7 days is listed, everything at 6 or fewer is not, in **both**
  panels, and the same value governs waiting projects.
- Change `staleness days` to one other value: all three sets move. The test asserts them together — a
  second threshold anywhere makes it fail.
- The boundary day itself is asserted explicitly, on both sides.
- An unreadable date, a future date, and a threshold of zero each behave as the shipped rule already
  behaves.

## Scenario 3 — acting changes exactly what it would have changed (US2, SC-004, SC-005, SC-012)

```bash
npm run test:core -- --test-name-pattern="parity"
npm run test:e2e -- shutdown-actions.spec.ts
```

For each of the five actions: two identical vaults, the action taken from the shutdown's path in one and
from the ordinary surface's path in the other, the file the verb owns compared byte for byte. Then:

- **No file under `log/` is created or modified by any shutdown action.** This is the assertion that keeps
  the waiting verbs from being reached through `ReviewService` — the one way this feature could quietly
  write a record of itself.
- A refused attempt produces the same `reason` and the same `message` as the same attempt elsewhere.
- A hand-edit between display and write is refused and the row is re-presented as it now reads.
- After each action, every panel's membership and order is unchanged for the rest of the opening; only the
  acted-on row shows its new state. Asserted again with a concurrent write from a second window.
- Reopening rebuilds: the chased item is gone from the stale list, the received item is gone for good.

In the app, the same pass by hand: mark an outcome done, mark a milestone done, replace a next action,
chase one waiting item and receive another, then try something a rule refuses and confirm the message is
the one the weekly review gives.

## Scenario 4 — capture lands in the ordinary inbox (US3, SC-008)

```bash
npm run test:e2e -- shutdown-capture.spec.ts
```

Three thoughts typed in a row from the shutdown, and the resulting `inbox.md` compared byte for byte
against the same three captured from the capture window. Focus stays on the shutdown throughout; the box is
ready for the next thought; an empty or whitespace-only entry captures nothing; undo works as it does at
the capture surface; closing mid-typing saves no draft.

## Scenario 5 — degradation (SC-011a)

```bash
npm run test:core -- --test-name-pattern="degrad"
```

Five paths, each leaving the shutdown openable with every unaffected panel displayed and actionable: no
`policy.md`; a `staleness days` value that will not parse; no `waiting.md`; no `calendar.md`; an unreadable
project file. A missing file gives the empty state and creates nothing; an unreadable one names what failed
and reads differently from empty.

## Scenario 6 — read counting, not timing (SC-013)

```bash
npm run test:core -- --test-name-pattern="reads"
```

100 projects, one `read()`, `maxReadCount() === 1`. The failure message names the repeated path. A
stopwatch on a laptop proves nothing about the shape of the algorithm; this proves the thing that matters,
which is that nothing reads inside a per-item loop.

## Scenario 7 — offline (SC-009)

```bash
npm run test:core -- --test-name-pattern="offline"
```

Then, with networking actually off:

```bash
nmcli networking off       # or unplug; whatever your machine does
npm run dev                # open the shutdown, read every panel, take every action
nmcli networking on
```

Everything must behave identically. Nothing in this feature has a network path to lose, and the test asserts
no outbound attempt is made the way `review-no-outbound.test.ts` does.

## Scenario 8 — nothing rots when you walk away (US1, SC-003, SC-010)

By hand, because it is a statement about time:

1. Open the shutdown, close it halfway through reading. Reopen: the same screen a cold opening gives, with
   no resume, no prompt, and no partial state.
2. Close it mid-capture. Nothing was captured, nothing was drafted.
3. `git status` in the vault after a shutdown with no actions: clean.
4. Leave it unopened for two weeks. Nothing prompts, reminds, nags, counts, or reports the days it was not
   opened — there is nowhere that count could have been kept.

---

## Scenario 9 — the two-minute read (US1, SC-001)

By hand, because no unit test can make this judgement. The point is not the stopwatch; it is whether the
screen answers "is anything hanging, and what am I walking into tomorrow?" without being worked through.

Against the populated fixture — a current-week top three, four active projects of yours, a handful of stale
waiting-for items, a stale calendar flag or two:

1. Open the shutdown from the tray. Start a timer.
2. Read all four panels once, top to bottom. Do not act on anything.
3. Stop the timer when you could close the laptop and say what is hanging and what tomorrow starts with.

It must come in **under two minutes**, and the reading must not require scrolling within a panel to learn
whether that panel has anything in it, clicking to expand anything, or visiting one panel to make sense of
another.

If it does not come in under two minutes, the failure is a design one and belongs in the spec, not in a
test: something is being read that should have been shown, or something is shown that is not worth reading.
Note which panel cost the time.

---

## Ship checks

```bash
npm run typecheck && npm test && npm run test:e2e
```

- Features 1–8 suites pass **unmodified**. `decision-points.test.ts` is untouched and still asserts five
  points.
- `git diff --stat` shows no change to `package-lock.json` and no new dependency in either workspace.
- macOS build: pushed to CI, produced by GitHub Actions on a macOS runner, downloaded as a release
  artifact. Nothing is built or packaged on the work machine.
