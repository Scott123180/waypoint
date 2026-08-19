import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Shown, then edited in an editor, then written — the write is refused (FR-040).
 *
 * Every verb this screen reaches carries the value it was **shown**: an
 * `OutcomeRef.raw`, a `MilestoneRef.raw`, a `WaitingRef.raw`, or the `expected`
 * next action. A mismatch cancels the write, leaves the file untouched, and the
 * row is re-presented as it now reads.
 *
 * This screen is unusually exposed to that race, and it is worth saying why:
 * membership is fixed when it opens, and it is meant to be left open while the
 * user works through it. A reading taken at 17:40 and acted on at 17:55 is
 * ordinary use here, not an edge case — so "the file moved under me" is the
 * normal path, and the refusal is what makes leaving the screen open safe.
 */

const SLUG = "alpha";

/** What the user did in vim while the screen sat open. */
function handEdit(files: Map<string, string>, path: string, from: string, to: string): void {
  const content = files.get(path) ?? "";
  assert.ok(content.includes(from), `the fixture must contain "${from}"`);
  files.set(path, content.replace(from, to));
}

describe("an outcome edited between being shown and being written", () => {
  test("is refused, the file is unchanged, and it is re-presented as it now reads", async () => {
    const { shutdown, topThree, vault } = actingVault(populatedVault());

    const view = await shutdown.read();
    const week = view.topThree.week;
    const outcome = week?.outcomes.find((o) => !o.done);
    assert.ok(week && outcome);

    handEdit(vault.files, "top-three.md", "Ship the sort view", "Ship the sort view by Friday");
    const before = snapshot(vault);

    const result = await topThree.completeOutcome({
      week: week.id,
      index: outcome.index,
      raw: outcome.raw,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(snapshot(vault), before, "nothing was written");
    if (!result.ok) {
      assert.equal(result.reason, "entry-changed");
      // The message carries what it now says, so the user is not left guessing
      // which of their edits collided.
      assert.match(result.message, /It now reads: Ship the sort view by Friday/);
    }
  });

  test("and a fresh read shows the edited text, so the row can be re-presented", async () => {
    const { shutdown, vault } = actingVault(populatedVault());

    await shutdown.read();
    handEdit(vault.files, "top-three.md", "Ship the sort view", "Ship the sort view by Friday");

    const again = await shutdown.read();
    assert.ok(
      again.topThree.week?.outcomes.some((o) => o.text === "Ship the sort view by Friday"),
      "reopening is how the user gets the current picture",
    );
  });
});

describe("a milestone edited between being shown and being written", () => {
  test("is refused and the project file is untouched", async () => {
    const { shutdown, projects, vault } = actingVault(populatedVault());

    const view = await shutdown.read();
    const milestone = view.projects.items.find((p) => p.summary.slug === SLUG)?.openMilestones[0];
    assert.ok(milestone);

    handEdit(vault.files, `projects/${SLUG}.md`, "Cutover rehearsed", "Cutover rehearsed end to end");
    const before = snapshot(vault);

    const result = await projects.completeMilestone(SLUG, {
      index: milestone.index,
      raw: milestone.raw,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(snapshot(vault), before);
  });
});

describe("a next action edited between being shown and being written", () => {
  test("is refused because `expected` no longer matches", async () => {
    const { shutdown, projects, vault } = actingVault(populatedVault());

    const view = await shutdown.read();
    const project = view.projects.items.find((p) => p.summary.slug === SLUG);
    assert.ok(project);

    handEdit(
      vault.files,
      `projects/${SLUG}.md`,
      "next action: Draft the migration note",
      "next action: Draft the migration note and send it",
    );
    const before = snapshot(vault);

    const result = await projects.setNextAction(SLUG, project.nextAction, "Book the cutover window");

    assert.equal(result.ok, false);
    assert.deepEqual(snapshot(vault), before);
  });
});

describe("a waiting item edited between being shown and being written", () => {
  test("neither verb writes", async () => {
    for (const verb of ["recordFollowUp", "recordReceived"] as const) {
      const { shutdown, waiting, vault } = actingVault(populatedVault());

      const view = await shutdown.read();
      const stale = view.waiting.items.find((s) => s.item.owner === "Priya");
      assert.ok(stale);

      handEdit(vault.files, "waiting.md", "@Priya — Confirm", "@Priya — Please confirm");
      const before = snapshot(vault);

      const result = await waiting[verb]({ index: stale.item.index, raw: stale.item.raw });

      assert.equal(result.ok, false, `${verb} wrote over an edited item`);
      assert.deepEqual(snapshot(vault), before);
    }
  });

  test("an unrelated edit elsewhere in the file does not cancel the write", async () => {
    // Verification covers the entry being written, not the whole file.
    // Cancelling because a *different* line changed would be a refusal the user
    // cannot act on.
    const { shutdown, waiting, vault } = actingVault(populatedVault());

    const view = await shutdown.read();
    const stale = view.waiting.items.find((s) => s.item.owner === "Priya");
    assert.ok(stale);

    handEdit(vault.files, "waiting.md", "@Sam — Sign-off on the copy", "@Sam — Sign-off on the new copy");

    const result = await waiting.recordFollowUp({ index: stale.item.index, raw: stale.item.raw });

    assert.equal(result.ok, true);
    assert.ok((vault.files.get("waiting.md") ?? "").includes("Sign-off on the new copy"), "and the hand-edit survives");
  });
});
