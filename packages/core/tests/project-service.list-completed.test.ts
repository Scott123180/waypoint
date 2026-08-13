import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { COMPLETED, STRUCTURED, STUB } from "./project-fixtures";

/**
 * The completed list — the mirror of `listActive()`.
 *
 * It exists so a client can show finished work without deciding for itself what
 * "finished" means. A renderer filtering `list()` on `status === "done"` would
 * be holding a business rule, which is the same Principle II problem that put
 * `listActive()` in the core in the first place (FR-029, FR-032, SC-012).
 *
 * Without it there is no way to reach a project completed in an earlier
 * session, and `reopen()` becomes unreachable.
 */

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("listCompleted", () => {
  test("returns only projects whose status is done", async () => {
    const { projects } = service({
      "projects/active.md": STRUCTURED,
      "projects/fence.md": COMPLETED,
      "projects/stub.md": STUB,
    });
    assert.deepEqual(
      (await projects.listCompleted()).map((p) => p.slug),
      ["fence"],
    );
  });

  test("is exactly the complement of listActive", async () => {
    const { projects } = service({
      "projects/a.md": STRUCTURED,
      "projects/b.md": COMPLETED,
      "projects/c.md": "# C\n\nstatus: parked\n",
      "projects/d.md": "# D\n\nstatus: waiting\n",
    });

    const all = (await projects.list()).map((p) => p.slug).sort();
    const split = [
      ...(await projects.listActive()).map((p) => p.slug),
      ...(await projects.listCompleted()).map((p) => p.slug),
    ].sort();

    assert.deepEqual(split, all, "every project belongs to exactly one of the two lists");
  });

  test("carries the completion date, so finished work can be dated without opening it", async () => {
    const { projects } = service({ "projects/fence.md": COMPLETED });
    const [summary] = await projects.listCompleted();
    assert.equal(summary?.completedOn, "2026-03-14");
  });

  test("still reports gaps — status has no effect on the flag (FR-021)", async () => {
    // A project closed while still missing its outcome is still missing it.
    const { projects } = service({
      "projects/bare.md": "# Bare\n\nstatus: done\ncompleted: 2026-03-01\n",
    });
    const [summary] = await projects.listCompleted();
    assert.deepEqual(summary?.gaps, ["outcome", "milestones", "next-action"]);
  });

  test("a project completed then reopened moves between the lists", async () => {
    const { projects } = service({ "projects/fence.md": COMPLETED });
    assert.equal((await projects.listCompleted()).length, 1);

    await projects.reopen("fence", "active");
    assert.equal((await projects.listCompleted()).length, 0);
    assert.equal((await projects.listActive()).length, 1);

    await projects.complete("fence");
    assert.equal((await projects.listCompleted()).length, 1);
  });

  test("is empty when nothing has been finished", async () => {
    const { projects } = service({ "projects/a.md": STUB });
    assert.deepEqual(await projects.listCompleted(), []);
  });

  test("never writes", async () => {
    const { vault, projects } = service({ "projects/fence.md": COMPLETED });
    await projects.listCompleted();
    assert.deepEqual(vault.writeLog, []);
  });
});
