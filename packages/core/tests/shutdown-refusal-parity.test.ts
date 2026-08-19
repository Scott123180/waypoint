import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * A refusal here reads exactly as it reads anywhere else (FR-038, SC-005).
 *
 * Character for character — the same `reason` and the same `message` — because
 * the shutdown is not producing them. It calls the verb the ordinary surface
 * calls, and a refusal is a value that verb returns.
 *
 * **On the policy `block` the task list names.** None of the five actions on this
 * screen reaches a blocking rule, and that is a fact worth asserting rather than
 * a gap: `completeOutcome`, `completeMilestone`, `setNextAction`,
 * `recordFollowUp` and `recordReceived` consult no decision point at all. The
 * points that can block — the WIP limit, the milestone cap, the outcome cap —
 * are reached by *adding* things, and this screen adds nothing. The last block
 * below asserts that positively, so the claim is checked rather than assumed.
 */

const SLUG = "alpha";

describe("an outcome that changed on disk", () => {
  test("is refused with the same reason and message on both paths", async () => {
    const shutdown = actingVault(populatedVault());
    const view = await shutdown.shutdown.read();
    const outcome = view.topThree.week?.outcomes.find((o) => !o.done);
    assert.ok(outcome && view.topThree.week);

    // Edited in a text editor between being shown and being written.
    shutdown.vault.files.set(
      "top-three.md",
      (shutdown.vault.files.get("top-three.md") ?? "").replace("Ship the sort view", "Ship the sort view, properly"),
    );
    const fromShutdown = await shutdown.topThree.completeOutcome({
      week: view.topThree.week.id,
      index: outcome.index,
      raw: outcome.raw,
    });

    const window = actingVault(populatedVault());
    const week = await window.topThree.current();
    const same = week.outcomes.find((o) => !o.done);
    assert.ok(same);
    window.vault.files.set(
      "top-three.md",
      (window.vault.files.get("top-three.md") ?? "").replace("Ship the sort view", "Ship the sort view, properly"),
    );
    const fromWindow = await window.topThree.completeOutcome({
      week: week.id,
      index: same.index,
      raw: same.raw,
    });

    assert.equal(fromShutdown.ok, false);
    assert.deepEqual(fromShutdown, fromWindow);
    if (!fromShutdown.ok) assert.equal(fromShutdown.reason, "entry-changed");
  });
});

describe("a milestone that changed on disk", () => {
  test("is refused identically", async () => {
    const dirty = (files: Map<string, string>): void => {
      files.set(
        `projects/${SLUG}.md`,
        (files.get(`projects/${SLUG}.md`) ?? "").replace("Cutover rehearsed", "Cutover rehearsed twice"),
      );
    };

    const shutdown = actingVault(populatedVault());
    const view = await shutdown.shutdown.read();
    const shown = view.projects.items.find((p) => p.summary.slug === SLUG)?.openMilestones[0];
    assert.ok(shown);
    dirty(shutdown.vault.files);
    const fromShutdown = await shutdown.projects.completeMilestone(SLUG, {
      index: shown.index,
      raw: shown.raw,
    });

    const window = actingVault(populatedVault());
    const project = await window.projects.get(SLUG);
    const same = project?.milestones.find((m) => !m.done);
    assert.ok(same);
    dirty(window.vault.files);
    const fromWindow = await window.projects.completeMilestone(SLUG, {
      index: same.index,
      raw: same.raw,
    });

    assert.equal(fromShutdown.ok, false);
    assert.deepEqual(fromShutdown, fromWindow);
  });
});

describe("a next action that changed on disk", () => {
  test("is refused identically, and the file is left alone", async () => {
    const shutdown = actingVault(populatedVault());
    const view = await shutdown.shutdown.read();
    const shown = view.projects.items.find((p) => p.summary.slug === SLUG);
    assert.ok(shown);

    shutdown.vault.files.set(
      `projects/${SLUG}.md`,
      (shutdown.vault.files.get(`projects/${SLUG}.md`) ?? "").replace(
        "next action: Draft the migration note",
        "next action: Something else entirely",
      ),
    );
    const before = snapshot(shutdown.vault);
    const fromShutdown = await shutdown.projects.setNextAction(SLUG, shown.nextAction, "Book it");

    const window = actingVault(populatedVault());
    const project = await window.projects.get(SLUG);
    assert.ok(project);
    window.vault.files.set(
      `projects/${SLUG}.md`,
      (window.vault.files.get(`projects/${SLUG}.md`) ?? "").replace(
        "next action: Draft the migration note",
        "next action: Something else entirely",
      ),
    );
    const fromWindow = await window.projects.setNextAction(SLUG, project.nextAction, "Book it");

    assert.equal(fromShutdown.ok, false);
    assert.deepEqual(fromShutdown, fromWindow);
    assert.deepEqual(snapshot(shutdown.vault), before, "a refusal writes nothing");
  });
});

describe("a waiting item that is no longer there", () => {
  test("`not-found` reads the same on both paths", async () => {
    const shutdown = actingVault(populatedVault());
    const view = await shutdown.shutdown.read();
    const stale = view.waiting.items[0];
    assert.ok(stale);

    shutdown.vault.files.delete("waiting.md");
    const fromShutdown = await shutdown.waiting.recordFollowUp({
      index: stale.item.index,
      raw: stale.item.raw,
    });

    const window = actingVault(populatedVault());
    const item = (await window.waiting.list())[0];
    assert.ok(item);
    window.vault.files.delete("waiting.md");
    const fromWindow = await window.waiting.recordFollowUp({ index: item.index, raw: item.raw });

    assert.equal(fromShutdown.ok, false);
    assert.deepEqual(fromShutdown, fromWindow);
    if (!fromShutdown.ok) {
      assert.equal(fromShutdown.reason, "not-found");
      assert.match(fromShutdown.message, /Nothing was written\./);
    }
  });

  test("and an item edited on disk refuses with `entry-changed`, identically", async () => {
    const rewrite = (files: Map<string, string>): void => {
      files.set(
        "waiting.md",
        (files.get("waiting.md") ?? "").replace("Confirm the migration window moved", "Confirm the window"),
      );
    };

    const shutdown = actingVault(populatedVault());
    const view = await shutdown.shutdown.read();
    const stale = view.waiting.items.find((s) => s.item.owner === "Priya");
    assert.ok(stale);
    rewrite(shutdown.vault.files);
    const fromShutdown = await shutdown.waiting.recordReceived({
      index: stale.item.index,
      raw: stale.item.raw,
    });

    const window = actingVault(populatedVault());
    const item = (await window.waiting.list()).find((i) => i.owner === "Priya");
    assert.ok(item);
    rewrite(window.vault.files);
    const fromWindow = await window.waiting.recordReceived({ index: item.index, raw: item.raw });

    assert.deepEqual(fromShutdown, fromWindow);
    if (!fromShutdown.ok) assert.equal(fromShutdown.reason, "entry-changed");
  });
});

describe("no action on this screen can reach a blocking rule", () => {
  test("none of the five consults a decision point", async () => {
    const { shutdown, projects, topThree, waiting, policy } = actingVault(populatedVault());

    const view = await shutdown.read();
    const before = policy.calls.length;

    const week = view.topThree.week;
    const outcome = week?.outcomes.find((o) => !o.done);
    const project = view.projects.items.find((p) => p.summary.slug === SLUG);
    const milestone = project?.openMilestones[0];
    const chased = view.waiting.items[0];
    assert.ok(week && outcome && project && milestone && chased);

    await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw });
    await projects.completeMilestone(SLUG, { index: milestone.index, raw: milestone.raw });
    await projects.setNextAction(SLUG, project.nextAction, "Book it");
    await waiting.recordFollowUp({ index: chased.item.index, raw: chased.item.raw });
    await waiting.recordReceived({ index: chased.item.index, raw: chased.item.raw });

    assert.equal(
      policy.calls.length,
      before,
      "the blocking points are reached by adding things, and this screen adds nothing",
    );
  });
});
