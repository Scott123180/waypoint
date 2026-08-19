import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Nothing records that a shutdown happened (FR-050, FR-051, FR-052, SC-003).
 *
 * This is the requirement the whole feature is shaped around, and the one that
 * could most easily be lost without a single other test going red: reaching the
 * waiting verbs through `ReviewService` would write a line into `log/YYYY-Www.md`
 * — the review's record of *its* ritual — while every assertion about
 * `waiting.md` still passed.
 *
 * So the assertion is a **whole-vault** comparison. After all five actions, the
 * only bytes that differ from the same five made through the ordinary surfaces
 * are in the files those verbs own. No daily log, no history, no counter, no
 * timestamp, no tomorrow list, no carried-over item, and no day's state appears
 * anywhere, because there is nowhere for one to be written and no verb that
 * would write it.
 */

const SLUG = "alpha";

/** All five actions, taken from the screen, against one vault. */
async function actFromShutdown(): Promise<{
  after: Record<string, string>;
  before: Record<string, string>;
}> {
  const before = populatedVault();
  const { shutdown, projects, topThree, waiting, vault } = actingVault({ ...before });

  const view = await shutdown.read();

  const week = view.topThree.week;
  assert.ok(week);
  const outcome = week.outcomes.find((o) => !o.done);
  assert.ok(outcome);
  assert.ok((await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw })).ok);

  const project = view.projects.items.find((p) => p.summary.slug === SLUG);
  assert.ok(project);
  const milestone = project.openMilestones[0];
  assert.ok(milestone);
  assert.ok((await projects.completeMilestone(SLUG, { index: milestone.index, raw: milestone.raw })).ok);
  assert.ok((await projects.setNextAction(SLUG, project.nextAction, "Book the cutover window")).ok);

  const chased = view.waiting.items.find((s) => s.item.owner === "Priya");
  const received = view.waiting.items.find((s) => s.item.owner === "Lee");
  assert.ok(chased && received);
  assert.ok((await waiting.recordFollowUp({ index: chased.item.index, raw: chased.item.raw })).ok);
  assert.ok((await waiting.recordReceived({ index: received.item.index, raw: received.item.raw })).ok);

  return { after: snapshot(vault), before };
}

/** The same five, taken the way the ordinary surfaces take them. */
async function actFromOrdinarySurfaces(): Promise<Record<string, string>> {
  const { projects, topThree, waiting, vault } = actingVault(populatedVault());

  const week = await topThree.current();
  const outcome = week.outcomes.find((o) => !o.done);
  assert.ok(outcome);
  assert.ok((await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw })).ok);

  const project = await projects.get(SLUG);
  assert.ok(project);
  const milestone = project.milestones.find((m) => !m.done);
  assert.ok(milestone);
  assert.ok((await projects.completeMilestone(SLUG, { index: milestone.index, raw: milestone.raw })).ok);
  assert.ok((await projects.setNextAction(SLUG, project.nextAction, "Book the cutover window")).ok);

  const items = await waiting.list();
  const chased = items.find((i) => i.owner === "Priya");
  const received = items.find((i) => i.owner === "Lee");
  assert.ok(chased && received);
  assert.ok((await waiting.recordFollowUp({ index: chased.index, raw: chased.raw })).ok);
  assert.ok((await waiting.recordReceived({ index: received.index, raw: received.raw })).ok);

  return snapshot(vault);
}

describe("after all five actions", () => {
  test("the whole vault matches the ordinary surfaces', byte for byte", async () => {
    const { after } = await actFromShutdown();

    assert.deepEqual(after, await actFromOrdinarySurfaces());
  });

  test("only the files the verbs own changed", async () => {
    const { after, before } = await actFromShutdown();

    const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
    assert.deepEqual(changed.sort(), ["projects/alpha.md", "top-three.md", "waiting.md"]);
  });

  test("no file appeared that was not there before", async () => {
    const { after, before } = await actFromShutdown();

    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  });

  test("nothing under `log/` was created or modified", async () => {
    const { after } = await actFromShutdown();

    assert.deepEqual(
      Object.keys(after).filter((p) => p.startsWith("log/")),
      [],
      "the one way this feature could quietly write a record of itself",
    );
  });
});

describe("nothing anywhere resembles a record of a day", () => {
  test("no file is named for one", async () => {
    const { after } = await actFromShutdown();

    for (const path of Object.keys(after)) {
      assert.doesNotMatch(
        path,
        /shutdown|daily|today|tomorrow|carried|streak|history|state\.json/i,
        `${path} is a record this feature must not create`,
      );
    }
  });

  test("no line in any file names one either", async () => {
    const { after, before } = await actFromShutdown();

    for (const [path, content] of Object.entries(after)) {
      const added = content
        .split("\n")
        .filter((line) => !(before[path] ?? "").includes(line) && line.trim().length > 0);

      for (const line of added) {
        assert.doesNotMatch(
          line,
          /shutdown|end of day|reviewed on|opened|skipped|carried over|tomorrow/i,
          `${path} gained a line about the ritual: ${line}`,
        );
      }
    }
  });

  test("the lines that were added are the ordinary ones each verb writes", async () => {
    const { after, before } = await actFromShutdown();

    const added = Object.entries(after).flatMap(([path, content]) =>
      content
        .split("\n")
        .filter((line) => !(before[path] ?? "").includes(line) && line.trim().length > 0),
    );

    assert.deepEqual(added.sort(), [
      "- [x] Ship the sort view — done 2026-08-19",
      "- [x] Cutover rehearsed — done 2026-08-19",
      "  - followed up 2026-08-19",
      "  - received 2026-08-19",
      "next action: Book the cutover window",
    ].sort());
  });
});

describe("taking no action at all", () => {
  test("changes nothing, marks nothing, and defaults nothing", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();

    assert.deepEqual(snapshot(vault), before);
    assert.deepEqual(vault.writeLog, []);
  });
});
