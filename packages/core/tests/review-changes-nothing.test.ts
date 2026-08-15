import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The broadest guard in the suite.
 *
 * Snapshot an entire vault, run a complete review in which the user changes
 * nothing at any step, and assert every file is byte-for-byte what it was —
 * apart from the review's own log, which is the one thing the ritual is
 * supposed to produce.
 *
 * This is the assertion that catches a *helpful* write nobody asked for: the
 * auto-park of a stale project, the tidied-up section, the milestone quietly
 * closed because the project was marked done, the `policy.md` written on first
 * read. None of those would fail a narrower test, and all of them would be the
 * application editing the user's data on its own initiative (FR-073, SC-014).
 */

const VAULT: Record<string, string> = {
  "identity.md": "me: Scott Rodgers\n",

  "policy.md": "wip limit: 3\nstaleness days: 7\n",

  "projects/migration-cutover.md": `# Migration cutover

status: waiting
next action: Chase the vendor contract
dri: Scott Rodgers

## Outcome

The old cluster is switched off and nothing is running on it.

## Milestones

- [x] Runbook reviewed by SRE — @Priya — done 2026-06-30
- [ ] Cutover rehearsed end to end — @Priya

## Ledger

- 2026-06-01 status active → waiting

## Unprocessed

- 2026-08-09T16:02:11-04:00 vendor said the contract needs legal review
`,

  "projects/hiring-loop.md": "# Hiring loop\n\nstatus: active\n",

  "projects/old-fence.md": "# Fix the fence\n\nstatus: done\ncompleted: 2026-03-14\n",

  "areas/home.md": "# Home maintenance\n\nstatus: active\n",

  "waiting.md": `- 2026-06-02 @Priya — Confirm the migration window moved
  - followed up 2026-06-20
- 2026-07-02 @roofer — Send the revised estimate
`,

  "top-three.md": `## 2026-W33

- [x] Ship the migration runbook — done 2026-08-12
- [ ] Rewrite the on-call rota

## 2026-W31

- [x] Fix the fence — done 2026-07-31
`,

  "calendar.md": "- 2026-08-01 — Renew the parking permit\n",
  "trash.md": "- 2026-07-15 — something discarded\n",

  "log/2026-W32.md": `# Weekly review 2026-W32

status: complete
started: 2026-08-07
completed: 2026-08-07
step: top-three

## Inbox

- 2026-08-07 inbox clear

## Projects

- 2026-08-07 hiring-loop no change

## Waiting for

## Top three

## Note

Last week's review, finished.
`,
};

const INBOX = "- 2026-08-13T10:00:00-04:00 an unsorted thought\n- another one\n";

/** A complete pass in which the user is shown everything and changes nothing. */
async function reviewChangingNothing() {
  const harness = makeReview({ files: { ...VAULT }, inbox: INBOX });
  const { service } = harness;

  await service.start();

  // Every step is *looked at* — this must exercise the read paths, or it would
  // prove only that unused code writes nothing.
  await service.inboxStep();
  await service.advance({ confirmed: true });

  const walk = await service.projectStep();
  assert.ok(walk.length > 0, "the fixture has projects to walk");
  assert.ok(walk.some((e) => e.stale !== null), "and a stale one, so that path runs too");
  await service.nextProject();
  await service.advance();

  const waiting = await service.waitingStep();
  assert.ok(waiting.total > 0, "and outstanding items");
  await service.advance();

  const top = await service.topThreeStep();
  assert.ok(top.reviewed.outcomes.length > 0);

  await service.complete({ note: null });
  return harness;
}

describe("a review in which nothing was changed", () => {
  test("leaves every existing file byte-for-byte identical", async () => {
    const { vault } = await reviewChangingNothing();

    for (const [path, content] of Object.entries(VAULT)) {
      assert.equal(vault.files.get(path), content, `${path} was modified by a review that changed nothing`);
    }
  });

  test("creates nothing but this week's log", async () => {
    const { vault } = await reviewChangingNothing();

    const created = [...vault.files.keys()].filter((p) => !(p in VAULT));
    assert.deepEqual(created, ["log/2026-W33.md"]);
  });

  test("writes to nothing but this week's log", async () => {
    const { vault } = await reviewChangingNothing();

    assert.deepEqual(
      [...new Set(vault.writeLog)],
      ["log/2026-W33.md"],
      "every other file was read and left alone",
    );
  });

  test("does not touch the inbox", async () => {
    const { inbox } = await reviewChangingNothing();
    assert.equal(inbox.content, INBOX, "the review reads the inbox and never writes it (FR-077)");
  });

  test("does not park the stale project it surfaced", async () => {
    const { vault } = await reviewChangingNothing();

    assert.match(
      vault.files.get("projects/migration-cutover.md") ?? "",
      /^status: waiting$/m,
      "surfacing is not acting — no auto-park, ever (FR-022b)",
    );
  });

  test("does not chase, receive, or reword a waiting-for item", async () => {
    const { vault } = await reviewChangingNothing();
    assert.equal(vault.files.get("waiting.md"), VAULT["waiting.md"]);
  });

  test("does not create next week's top-three section by looking at it", async () => {
    const { vault } = await reviewChangingNothing();

    assert.doesNotMatch(
      vault.files.get("top-three.md") ?? "",
      /## 2026-W34/,
      "a section appears when the user commits to something, not when they look",
    );
  });

  test("does not add a ledger to a project it merely read", async () => {
    const { vault } = await reviewChangingNothing();

    assert.doesNotMatch(vault.files.get("projects/hiring-loop.md") ?? "", /## Ledger/);
    assert.equal(vault.files.get("projects/hiring-loop.md"), VAULT["projects/hiring-loop.md"]);
  });

  test("does not rewrite last week's log", async () => {
    const { vault } = await reviewChangingNothing();
    assert.equal(vault.files.get("log/2026-W32.md"), VAULT["log/2026-W32.md"]);
  });
});

describe("what it does produce", () => {
  test("a complete log for this week, and that is all", async () => {
    const { service } = await reviewChangingNothing();

    const review = await service.get("2026-W33");
    assert.equal(review?.status, "complete");
    assert.equal(review?.note, null, "no note was written, and none was invented");
    assert.equal(review?.summary, null, "no provider, so no summary");
    assert.deepEqual(review?.projects, [], "nothing was decided about a project");
  });

  test("with the week's outcomes recorded as they actually stood", async () => {
    const { service } = await reviewChangingNothing();

    const review = await service.get("2026-W33");
    assert.deepEqual(review?.topThree?.finished, ["Ship the migration runbook"]);
    assert.deepEqual(review?.topThree?.slipped, ["Rewrite the on-call rota"]);
    assert.deepEqual(review?.topThree?.committed, [], "nothing was committed to, so nothing is claimed");
  });
});
