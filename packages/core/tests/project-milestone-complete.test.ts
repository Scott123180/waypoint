import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STUB } from "./project-fixtures";

/**
 * Marking a milestone done (FR-033, FR-035, SC-008, SC-009).
 *
 * The date is filled in automatically — the user is never asked for one — and
 * the milestone stays exactly where it was, so the project reads as "2 of 4"
 * rather than shrinking as work gets finished.
 */

const path = "projects/p.md";

async function withFour() {
  const vault = seedProject("p", STUB);
  const clock = new FixedClock("2026-08-12T10:00:00-04:00");
  const projects = new ProjectService({ vault, clock });
  for (const n of [1, 2, 3, 4]) await projects.addMilestone("p", `M${n}`, "me");
  return { vault, clock, projects };
}

async function refAt(projects: ProjectService, index: number) {
  const p = await projects.get("p");
  const m = p?.milestones[index];
  assert.ok(m);
  return { index: m.index, raw: m.raw };
}

describe("completeMilestone", () => {
  test("marks it done and records today's date, with no prompt", async () => {
    const { projects } = await withFour();
    const outcome = await projects.completeMilestone("p", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.done, true);
    assert.equal(outcome.project.milestones[0]?.completedOn, "2026-08-12");
  });

  test("records the date as a local calendar date, never a timestamp (FR-033a)", async () => {
    const { vault, projects } = await withFour();
    await projects.completeMilestone("p", await refAt(projects, 0));
    const line = (vault.files.get(path) ?? "").split("\n").find((l) => l.includes("M1")) ?? "";
    assert.match(line, / — done \d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(line, /\d{2}:\d{2}/, "no time of day");
  });

  test("a completion just after midnight belongs to that day, not to UTC's", async () => {
    const vault = seedProject("p", STUB);
    const projects = new ProjectService({
      vault,
      clock: new FixedClock("2026-08-12T00:30:00-04:00"),
    });
    await projects.addMilestone("p", "Late night", null);
    const outcome = await projects.completeMilestone("p", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.completedOn, "2026-08-12");
  });

  test("the completed milestone stays visible alongside the ones that remain", async () => {
    const { projects } = await withFour();
    const outcome = await projects.completeMilestone("p", await refAt(projects, 1));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones.length, 4, "nothing may be hidden or removed");
    assert.deepEqual(
      outcome.project.milestones.map((m) => m.definitionOfDone),
      ["M1", "M2", "M3", "M4"],
    );
  });

  test("does not reorder — a done milestone keeps its position", async () => {
    const { projects } = await withFour();
    await projects.completeMilestone("p", await refAt(projects, 2));
    const p = await projects.get("p");
    assert.equal(p?.milestones[2]?.done, true);
    assert.equal(p?.milestones[2]?.definitionOfDone, "M3");
    assert.deepEqual(p?.milestones.map((m) => m.index), [0, 1, 2, 3]);
  });

  test("completing two of four reports 2 of 4", async () => {
    const { projects } = await withFour();
    await projects.completeMilestone("p", await refAt(projects, 0));
    await projects.completeMilestone("p", await refAt(projects, 1));

    const [summary] = await projects.list();
    assert.equal(summary?.milestonesDone, 2);
    assert.equal(summary?.milestonesTotal, 4);
  });

  test("completing an already-done milestone is idempotent, not a second date", async () => {
    const { clock, projects } = await withFour();
    await projects.completeMilestone("p", await refAt(projects, 0));
    clock.set("2026-09-01T10:00:00-04:00");
    const outcome = await projects.completeMilestone("p", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.completedOn, "2026-09-01");
    assert.equal(
      (outcome.project.milestones[0]?.raw.match(/done /g) ?? []).length,
      1,
      "one date, not two",
    );
  });
});

describe("progress reporting (FR-017)", () => {
  test("a project with no milestones is never reported as fully complete", async () => {
    // 0 of 0 is not 100%. A stub has not finished anything; it has not started.
    const vault = seedProject("bare", STUB);
    const projects = new ProjectService({ vault, clock: new FixedClock() });
    const [summary] = await projects.list();

    assert.equal(summary?.milestonesTotal, 0);
    assert.equal(summary?.milestonesDone, 0);

    const complete =
      summary !== undefined &&
      summary.milestonesTotal > 0 &&
      summary.milestonesDone === summary.milestonesTotal;
    assert.equal(complete, false, "0 of 0 must not read as fully complete");
  });

  test("all four done reports 4 of 4", async () => {
    const { projects } = await withFour();
    for (const i of [0, 1, 2, 3]) {
      await projects.completeMilestone("p", await refAt(projects, i));
    }
    const [summary] = await projects.list();
    assert.equal(summary?.milestonesDone, 4);
    assert.equal(summary?.milestonesTotal, 4);
  });
});
