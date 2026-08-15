import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { COMPLETED, STRUCTURED, STUB, SIX_MILESTONES } from "./project-fixtures";

/**
 * The list carries everything needed to render a project without opening it
 * (FR-031, SC-007).
 *
 * That is the whole point of User Story 3: eleven projects, and the four that
 * need attention are obvious at a glance rather than after eleven clicks.
 */

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("ProjectSummary", () => {
  test("carries slug, title, and status", async () => {
    const { projects } = service({ "projects/roof-repair.md": STRUCTURED });
    const [s] = await projects.list();
    assert.equal(s?.slug, "roof-repair");
    assert.equal(s?.title, "Roof repair");
    assert.equal(s?.status, "active");
  });

  test("carries milestone progress as done out of total", async () => {
    const { projects } = service({ "projects/roof-repair.md": STRUCTURED });
    const [s] = await projects.list();
    assert.equal(s?.milestonesDone, 1);
    assert.equal(s?.milestonesTotal, 3);
  });

  test("carries the gaps, so the client renders rather than computes them", async () => {
    const { projects } = service({ "projects/stub.md": STUB });
    const [s] = await projects.list();
    assert.deepEqual(s?.gaps, ["outcome", "milestones", "next-action"]);
  });

  test("carries the completion date for a done project", async () => {
    const { projects } = service({ "projects/fence.md": COMPLETED });
    const [s] = await projects.list();
    assert.equal(s?.completedOn, "2026-03-14");
    assert.equal(s?.status, "done");
  });

  test("a fully structured project has no gaps", async () => {
    const { projects } = service({
      "projects/full.md": STRUCTURED.replace("## Outcome", "## Outcome"),
    });
    const [s] = await projects.list();
    assert.deepEqual(s?.gaps, []);
  });

  test("reports a hand-written over-cap project honestly", async () => {
    const { projects } = service({ "projects/over.md": SIX_MILESTONES });
    const [s] = await projects.list();
    assert.equal(s?.milestonesTotal, 6);
    assert.equal(s?.milestonesDone, 1);
  });

  test("everything the list needs is present without a second call", async () => {
    const { vault, projects } = service({ "projects/a.md": STRUCTURED });
    const [s] = await projects.list();
    // 2026-08-14, Feature 4 added `dri` and `needsDri`. Additive: every field
    // this test was written to guarantee is still here, and the point of the
    // assertion — that a caller needs no second call to render a row — is
    // stronger now, not weaker.
    assert.deepEqual(
      Object.keys(s ?? {}).sort(),
      [
        "completedOn",
        "dri",
        "gaps",
        "milestonesDone",
        "milestonesTotal",
        "needsDri",
        "slug",
        "status",
        "title",
      ],
    );
    assert.deepEqual(vault.writeLog, [], "listing must not write");
  });
});

describe("what belongs to which list", () => {
  test("list includes done projects; listActive excludes them", async () => {
    const { projects } = service({
      "projects/a.md": STRUCTURED,
      "projects/b.md": COMPLETED,
      "projects/c.md": STUB,
    });
    assert.equal((await projects.list()).length, 3);
    assert.deepEqual(
      (await projects.listActive()).map((p) => p.slug).sort(),
      ["a", "c"],
    );
  });

  test("a project moved to done leaves the active list immediately", async () => {
    const { projects } = service({ "projects/a.md": STUB });
    assert.equal((await projects.listActive()).length, 1);
    await projects.complete("a");
    assert.equal((await projects.listActive()).length, 0);
  });

  test("a project moved back off done reappears immediately", async () => {
    const { projects } = service({ "projects/fence.md": COMPLETED });
    assert.equal((await projects.listActive()).length, 0);
    await projects.reopen("fence", "active");
    assert.equal((await projects.listActive()).length, 1);
  });
});
