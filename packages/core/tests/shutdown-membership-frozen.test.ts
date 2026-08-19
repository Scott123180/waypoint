import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { WaitingService } from "../src/waiting/waiting-service";
import { actingVault, populatedVault } from "./shutdown-fakes";

/**
 * Membership is fixed when the screen opens (FR-010a, FR-010c).
 *
 * **This file ships in two halves, and neither may ship without the other.**
 *
 * The (b) half — "the value returned before the writes is unchanged by them" —
 * is true of *any* immutable value, and `ShutdownView` is one: `ShutdownService`
 * performs no action, so nothing could have changed it. On its own that half
 * asserts nothing about this feature.
 *
 * The (a) half is the one with teeth. It asserts from the other side that a
 * **fresh** `read()` after the same writes *does* change: the chased item leaves
 * the stale list, the received item is gone for good. Together they say the thing
 * that actually matters — the screen does not re-read while it is open, and
 * reopening rebuilds.
 *
 * The on-screen half of SC-012 — "the row updated in place and its neighbours did
 * not move" — is `shutdown-actions.spec.ts`'s, in the running app, because that
 * is a renderer fact core cannot express.
 */

describe("(a) a fresh read after the writes does change", () => {
  test("a chased item leaves the stale list", async () => {
    const { shutdown, waiting } = actingVault(populatedVault());

    const before = await shutdown.read();
    const chased = before.waiting.items.find((s) => s.item.owner === "Priya");
    assert.ok(chased, "the fixture must list Priya's item as stale");

    assert.ok((await waiting.recordFollowUp({ index: chased.item.index, raw: chased.item.raw })).ok);

    const after = await shutdown.read();
    assert.ok(
      !after.waiting.items.some((s) => s.item.owner === "Priya"),
      "chasing it touched it, so it is no longer untouched — this is the half with teeth",
    );
  });

  test("a received item is gone for good, at any age", async () => {
    const { shutdown, waiting } = actingVault(populatedVault());

    const before = await shutdown.read();
    const item = before.waiting.items.find((s) => s.item.owner === "Lee");
    assert.ok(item);

    assert.ok((await waiting.recordReceived({ index: item.item.index, raw: item.item.raw })).ok);

    const after = await shutdown.read();
    assert.ok(!after.waiting.items.some((s) => s.item.owner === "Lee"));
  });

  test("a completed outcome reads as done", async () => {
    const { shutdown, topThree } = actingVault(populatedVault());

    const before = await shutdown.read();
    const week = before.topThree.week;
    const outcome = week?.outcomes.find((o) => !o.done);
    assert.ok(week && outcome);

    assert.ok((await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw })).ok);

    const after = await shutdown.read();
    const same = after.topThree.week?.outcomes[outcome.index];
    assert.equal(same?.done, true);
    assert.equal(same?.completedOn, "2026-08-19");
  });

  test("a completed milestone leaves the open list", async () => {
    const { shutdown, projects } = actingVault(populatedVault());

    const before = await shutdown.read();
    const milestone = before.projects.items.find((p) => p.summary.slug === "alpha")?.openMilestones[0];
    assert.ok(milestone);

    assert.ok((await projects.completeMilestone("alpha", { index: milestone.index, raw: milestone.raw })).ok);

    const after = await shutdown.read();
    assert.deepEqual(
      after.projects.items.find((p) => p.summary.slug === "alpha")?.openMilestones,
      [],
    );
  });
});

describe("(b) the value taken before the writes is unchanged by them", () => {
  test("the whole view is byte-identical after all four writes", async () => {
    const { shutdown, projects, topThree, waiting } = actingVault(populatedVault());

    const view = await shutdown.read();
    const frozen = JSON.stringify(view);

    const week = view.topThree.week;
    const outcome = week?.outcomes.find((o) => !o.done);
    const milestone = view.projects.items.find((p) => p.summary.slug === "alpha")?.openMilestones[0];
    const chased = view.waiting.items.find((s) => s.item.owner === "Priya");
    const received = view.waiting.items.find((s) => s.item.owner === "Lee");
    assert.ok(week && outcome && milestone && chased && received);

    await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw });
    await projects.completeMilestone("alpha", { index: milestone.index, raw: milestone.raw });
    await waiting.recordFollowUp({ index: chased.item.index, raw: chased.item.raw });
    await waiting.recordReceived({ index: received.item.index, raw: received.item.raw });

    assert.equal(JSON.stringify(view), frozen, "the reading is a value, not a live view of a file");
  });

  test("and by a concurrent write from a second handle on the same vault", async () => {
    const { shutdown, vault, clock } = actingVault(populatedVault());

    const view = await shutdown.read();
    const frozen = JSON.stringify(view);

    // A second window, or a hand-edit, writing while the screen sits open.
    const elsewhere = new WaitingService({ vault, clock });
    const item = (await elsewhere.list()).find((i) => i.owner === "Priya");
    assert.ok(item);
    assert.ok((await elsewhere.recordReceived({ index: item.index, raw: item.raw })).ok);

    assert.equal(JSON.stringify(view), frozen);
  });

  test("nor does the screen re-read on its own — the day counts stay put", async () => {
    const { shutdown, clock } = actingVault(populatedVault());

    const view = await shutdown.read();
    const ages = view.waiting.items.map((s) => s.untouchedDays);

    clock.set("2026-12-25T10:00:00-05:00");

    assert.deepEqual(view.waiting.items.map((s) => s.untouchedDays), ages);
    assert.equal(view.today, "2026-08-19");
  });
});

describe("the two halves together", () => {
  test("the same writes leave the held value alone and change the next reading", async () => {
    const { shutdown, waiting } = actingVault(populatedVault());

    const held = await shutdown.read();
    const owners = held.waiting.items.map((s) => s.item.owner);
    const chased = held.waiting.items.find((s) => s.item.owner === "Priya");
    assert.ok(chased);

    assert.ok((await waiting.recordFollowUp({ index: chased.item.index, raw: chased.item.raw })).ok);

    assert.deepEqual(held.waiting.items.map((s) => s.item.owner), owners, "(b) — nothing moved");
    assert.notDeepEqual(
      (await shutdown.read()).waiting.items.map((s) => s.item.owner),
      owners,
      "(a) — and reopening rebuilt",
    );
  });
});
