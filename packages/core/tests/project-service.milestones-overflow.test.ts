import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { SIX_MILESTONES } from "./project-fixtures";

/**
 * A file the user hand-wrote past the cap (FR-013b).
 *
 * The app refuses to *add* a fifth. It does not get to delete what the user
 * already wrote — the cap is a discipline on this tool's behaviour, not a
 * licence to edit somebody's file down to size.
 */

function service() {
  const vault = seedProject("overcommitted", SIX_MILESTONES);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("a hand-written six-milestone project", () => {
  test("is returned in full", async () => {
    const { projects } = service();
    const p = await projects.get("overcommitted");
    assert.equal(p?.milestones.length, 6);
    assert.deepEqual(
      p?.milestones.map((m) => m.definitionOfDone),
      ["One", "Two", "Three", "Four", "Five", "Six"],
    );
  });

  test("keeps every milestone's state, including the done one", async () => {
    const { projects } = service();
    const p = await projects.get("overcommitted");
    assert.equal(p?.milestones[2]?.done, true);
    assert.equal(p?.milestones[2]?.completedOn, "2026-08-01");
  });

  test("appears in the list with a progress count over the cap", async () => {
    const { projects } = service();
    const [summary] = await projects.list();
    assert.equal(summary?.milestonesTotal, 6);
    assert.equal(summary?.milestonesDone, 1);
  });

  test("adding a seventh is still refused", async () => {
    const { vault, projects } = service();
    const outcome = await projects.addMilestone("overcommitted", "Seven", null);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "milestone-cap");
    assert.equal(vault.files.get("projects/overcommitted.md"), SIX_MILESTONES);
  });

  test("the others remain editable and completable — the file is not frozen", async () => {
    const { projects } = service();
    const p = await projects.get("overcommitted");
    const fifth = p?.milestones[4];
    assert.ok(fifth);

    const outcome = await projects.completeMilestone("overcommitted", {
      index: fifth.index,
      raw: fifth.raw,
    });
    assert.ok(outcome.ok, "an over-cap project must still be workable");
    assert.equal(outcome.project.milestones[4]?.done, true);
  });

  test("removing one does not silently truncate the rest toward four", async () => {
    const { projects } = service();
    const p = await projects.get("overcommitted");
    const first = p?.milestones[0];
    assert.ok(first);

    const outcome = await projects.removeMilestone("overcommitted", {
      index: first.index,
      raw: first.raw,
    });
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones.length, 5);
  });
});
