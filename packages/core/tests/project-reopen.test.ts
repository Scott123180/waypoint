import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { COMPLETED } from "./project-fixtures";

/**
 * Reopening a completed project (FR-036, FR-039, SC-012).
 *
 * The project's own date goes, because it is no longer complete. Its
 * milestones' dates stay, because those milestones really were finished on
 * those days — reopening the project does not un-happen the work.
 */

const path = "projects/fix-the-fence.md";

function service() {
  const vault = seedProject("fix-the-fence", COMPLETED);
  const clock = new FixedClock("2026-08-12T10:00:00-04:00");
  return { vault, clock, projects: new ProjectService({ vault, clock }) };
}

describe("reopen", () => {
  test("moves the project back to an open status", async () => {
    const { projects } = service();
    const outcome = await projects.reopen("fix-the-fence", "active");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.status, "active");
  });

  test("clears the project's completion date", async () => {
    const { projects } = service();
    const outcome = await projects.reopen("fix-the-fence", "active");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.completedOn, null);
  });

  test("removes the completed line from the file", async () => {
    const { vault, projects } = service();
    await projects.reopen("fix-the-fence", "active");
    assert.doesNotMatch(vault.files.get(path) ?? "", /^completed:/m);
  });

  test("leaves every milestone date untouched", async () => {
    const { projects } = service();
    const outcome = await projects.reopen("fix-the-fence", "active");
    assert.ok(outcome.ok);
    assert.deepEqual(
      outcome.project.milestones.map((m) => m.completedOn),
      ["2026-03-02", "2026-03-14"],
    );
    assert.ok(outcome.project.milestones.every((m) => m.done));
  });

  test("puts the project back in the active list immediately", async () => {
    const { projects } = service();
    assert.deepEqual(await projects.listActive(), []);
    await projects.reopen("fix-the-fence", "active");
    assert.equal((await projects.listActive()).length, 1);
  });

  test("can reopen to parked or waiting, not only active", async () => {
    for (const to of ["parked", "waiting"] as const) {
      const { projects } = service();
      const outcome = await projects.reopen("fix-the-fence", to);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.status, to);
    }
  });

  test("keeps the outcome and every other field", async () => {
    const { projects } = service();
    const outcome = await projects.reopen("fix-the-fence", "active");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, "The fence stands through a gale.");
    assert.equal(outcome.project.dri, "me");
  });
});

describe("completing again after a reopen (FR-039)", () => {
  test("records the new date, not the old one", async () => {
    const { clock, projects } = service();
    await projects.reopen("fix-the-fence", "active");
    clock.set("2026-09-20T10:00:00-04:00");

    const outcome = await projects.complete("fix-the-fence");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.completedOn, "2026-09-20");
  });

  test("leaves exactly one completed line in the file", async () => {
    const { clock, vault, projects } = service();
    await projects.reopen("fix-the-fence", "active");
    clock.set("2026-09-20T10:00:00-04:00");
    await projects.complete("fix-the-fence");

    const lines = (vault.files.get(path) ?? "").split("\n").filter((l) => l.startsWith("completed:"));
    assert.deepEqual(lines, ["completed: 2026-09-20"]);
  });

  test("the milestone dates still say March", async () => {
    const { clock, projects } = service();
    await projects.reopen("fix-the-fence", "active");
    clock.set("2026-09-20T10:00:00-04:00");
    const outcome = await projects.complete("fix-the-fence");
    assert.ok(outcome.ok);
    assert.deepEqual(
      outcome.project.milestones.map((m) => m.completedOn),
      ["2026-03-02", "2026-03-14"],
    );
  });
});
