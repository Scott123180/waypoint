import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Marking a milestone done from the shutdown == doing it from the projects view
 * (FR-034, SC-004).
 *
 * The project file is compared **whole**, so the ledger line the verb writes is
 * part of the comparison rather than something the test could miss by looking
 * only at the milestone list.
 *
 * As with the outcome, what is really under test is the ref: the shutdown builds
 * a `MilestoneRef` from the `openMilestones` its panel displayed, and the
 * projects window builds one from `get()`. A screen that showed a re-rendered
 * milestone would produce a ref that fails verification, and the files would
 * differ.
 */

const SLUG = "alpha";

/** The shutdown's path: the ref comes from the panel's open milestones. */
async function fromShutdown(): Promise<Record<string, string>> {
  const { shutdown, projects, vault } = actingVault(populatedVault());

  const view = await shutdown.read();
  const project = view.projects.items.find((p) => p.summary.slug === SLUG);
  assert.ok(project, "the panel must list the project");

  const milestone = project.openMilestones[0];
  assert.ok(milestone, "and offer an open milestone");

  const result = await projects.completeMilestone(SLUG, {
    index: milestone.index,
    raw: milestone.raw,
  });
  assert.ok(result.ok, "the shutdown's path must not be refused");

  return snapshot(vault);
}

/** The ordinary surface's path: the ref comes from `get()`. */
async function fromProjectsWindow(): Promise<Record<string, string>> {
  const { projects, vault } = actingVault(populatedVault());

  const project = await projects.get(SLUG);
  assert.ok(project);

  const milestone = project.milestones.find((m) => !m.done);
  assert.ok(milestone);

  const result = await projects.completeMilestone(SLUG, {
    index: milestone.index,
    raw: milestone.raw,
  });
  assert.ok(result.ok);

  return snapshot(vault);
}

describe("completing a milestone", () => {
  test("produces a byte-identical project file", async () => {
    const shutdown = await fromShutdown();
    const window = await fromProjectsWindow();

    assert.equal(shutdown[`projects/${SLUG}.md`], window[`projects/${SLUG}.md`]);
  });

  test("the whole vault matches, so nothing else was written by either path", async () => {
    assert.deepEqual(await fromShutdown(), await fromProjectsWindow());
  });

  test("the milestone is marked done with today's date", async () => {
    const file = (await fromShutdown())[`projects/${SLUG}.md`] ?? "";

    assert.match(file, /- \[x\] Cutover rehearsed — done 2026-08-19/);
  });

  test("the already-done milestone keeps its own date", async () => {
    const file = (await fromShutdown())[`projects/${SLUG}.md`] ?? "";

    assert.ok(
      file.includes("- [x] Estimate approved — done 2026-08-01"),
      "completing one milestone must not rewrite another's date",
    );
  });

  test("no other project file is touched", async () => {
    const before = populatedVault();
    const after = await fromShutdown();

    for (const path of Object.keys(before)) {
      if (path === `projects/${SLUG}.md`) continue;
      assert.equal(after[path], before[path], `${path} changed`);
    }
  });
});
