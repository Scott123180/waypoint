import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * Un-marking a milestone, and the durability of a date that stays (FR-036,
 * FR-037, SC-011).
 *
 * The rule is narrow on purpose: only an explicit reversal clears a date.
 * Editing the wording of something you finished in March does not un-finish it.
 */

function service() {
  const vault = seedProject("roof-repair", STRUCTURED);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

async function refAt(projects: ProjectService, index: number) {
  const p = await projects.get("roof-repair");
  const m = p?.milestones[index];
  assert.ok(m);
  return { index: m.index, raw: m.raw };
}

describe("reopenMilestone", () => {
  test("returns it to not-done", async () => {
    const { projects } = service();
    const outcome = await projects.reopenMilestone("roof-repair", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.done, false);
  });

  test("removes its completion date", async () => {
    const { projects } = service();
    const outcome = await projects.reopenMilestone("roof-repair", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.completedOn, null);
  });

  test("removes the date from the file, not just from the reading", async () => {
    const { vault, projects } = service();
    await projects.reopenMilestone("roof-repair", await refAt(projects, 0));
    const line =
      (vault.files.get("projects/roof-repair.md") ?? "")
        .split("\n")
        .find((l) => l.includes("Estimate approved")) ?? "";
    assert.equal(line, "- [ ] Estimate approved by insurer — @Priya");
  });

  test("updates the progress count", async () => {
    const { projects } = service();
    const before = (await projects.list())[0];
    assert.equal(before?.milestonesDone, 1);

    await projects.reopenMilestone("roof-repair", await refAt(projects, 0));
    const after = (await projects.list())[0];
    assert.equal(after?.milestonesDone, 0);
    assert.equal(after?.milestonesTotal, 3);
  });

  test("leaves the other milestones alone", async () => {
    const { projects } = service();
    const outcome = await projects.reopenMilestone("roof-repair", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[1]?.verifier, "me");
    assert.equal(outcome.project.milestones[2]?.definitionOfDone, "Work signed off and claim paid");
  });
});

describe("a completion date survives an ordinary edit (FR-037)", () => {
  test("rewording a done milestone keeps its date", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      await refAt(projects, 0),
      "Estimate approved by the insurer, in writing",
      "Priya",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.done, true);
    assert.equal(outcome.project.milestones[0]?.completedOn, "2026-08-14");
  });

  test("changing a done milestone's verifier keeps its date", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      await refAt(projects, 0),
      "Estimate approved by insurer",
      "Sam",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.verifier, "Sam");
    assert.equal(outcome.project.milestones[0]?.completedOn, "2026-08-14");
  });

  test("editing a different field of the project keeps every date", async () => {
    const { projects } = service();
    await projects.setDri("roof-repair", "me", "Alex");
    await projects.setStatus("roof-repair", "active", "waiting");
    const p = await projects.get("roof-repair");
    assert.equal(p?.milestones[0]?.completedOn, "2026-08-14");
  });

  test("adding a new milestone does not disturb an existing date", async () => {
    const { projects } = service();
    await projects.addMilestone("roof-repair", "A fourth thing", null);
    const p = await projects.get("roof-repair");
    assert.equal(p?.milestones[0]?.completedOn, "2026-08-14");
  });
});
