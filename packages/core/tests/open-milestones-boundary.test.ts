import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The open-milestone confirmation fires on exactly the same inputs before and
 * after it moves behind a decision point (FR-062, FR-062a, SC-014a).
 *
 * A characterization test, like its milestone-cap sibling: written against
 * current behaviour, passing on arrival, with the Red supplied by T069.
 *
 * The silent row — marking done with nothing open asks nothing — is the one
 * that matters most here. A relocated rule that started asking every time
 * would turn every completion into a dialog, and no test that only checks
 * "does it ask when milestones are open" would notice.
 */

const NOW = "2026-08-14T10:00:00-04:00";

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock(NOW) }) };
}

function projectWith(milestones: string[]): string {
  return ["# P", "", "status: active", "", "## Milestones", "", ...milestones, ""].join("\n");
}

describe("open-milestone confirmation: the trigger boundary", () => {
  test("a project with NO milestones completes without asking", async () => {
    const { projects } = service({ "projects/p.md": "# P\n\nstatus: active\n" });
    const result = await projects.complete("p");

    assert.ok(result.ok, "nothing is open, so there is nothing to confirm");
    assert.equal(result.project.status, "done");
  });

  test("a project with ALL milestones complete completes without asking", async () => {
    const { projects } = service({
      "projects/p.md": projectWith([
        "- [x] One — done 2026-08-01",
        "- [x] Two — done 2026-08-02",
      ]),
    });
    const result = await projects.complete("p");

    assert.ok(result.ok, "every milestone is done, so no confirmation is warranted");
    assert.equal(result.project.completedOn, "2026-08-14");
  });

  test("ONE open milestone asks", async () => {
    const { projects } = service({
      "projects/p.md": projectWith(["- [x] One — done 2026-08-01", "- [ ] Two"]),
    });
    const result = await projects.complete("p");

    assert.ok(!result.ok);
    assert.equal(result.reason, "open-milestones");
  });

  test("SEVERAL open milestones ask, and all are named", async () => {
    const { projects } = service({
      "projects/p.md": projectWith(["- [ ] One", "- [ ] Two", "- [x] Three — done 2026-08-01"]),
    });
    const result = await projects.complete("p");

    assert.ok(!result.ok);
    assert.equal(result.reason, "open-milestones");
    assert.deepEqual(result.open, ["One", "Two"], "named, so the user can decide knowing what is left");
  });

  test("the message reports how many are open, with correct grammar", async () => {
    const one = service({ "projects/p.md": projectWith(["- [ ] Only one"]) });
    const single = await one.projects.complete("p");
    assert.ok(!single.ok);
    assert.match(single.message, /1 milestone is still open/);

    const two = service({ "projects/p.md": projectWith(["- [ ] One", "- [ ] Two"]) });
    const plural = await two.projects.complete("p");
    assert.ok(!plural.ok);
    assert.match(plural.message, /2 milestones are still open/);
  });

  test("confirming completes and leaves the open milestones open", async () => {
    // The honest version of the guardrail: it asks rather than refusing,
    // because a hard refusal would be routed around by deleting the milestone,
    // which destroys its record.
    const { projects } = service({
      "projects/p.md": projectWith(["- [ ] One", "- [x] Two — done 2026-08-01"]),
    });
    const result = await projects.complete("p", { confirmOpenMilestones: true });

    assert.ok(result.ok);
    assert.equal(result.project.status, "done");
    assert.equal(result.project.milestones[0]?.done, false, "still open, recorded as never completed");
    assert.equal(result.project.milestones[0]?.completedOn, null, "and no date invented for it");
  });

  test("declining leaves the project and every milestone byte-for-byte unchanged", async () => {
    const { vault, projects } = service({
      "projects/p.md": projectWith(["- [ ] One", "- [ ] Two"]),
    });
    const before = vault.files.get("projects/p.md");

    await projects.complete("p");

    assert.equal(vault.files.get("projects/p.md"), before);
    assert.deepEqual(vault.writeLog, []);
  });

  test("confirming when nothing is open is harmless", async () => {
    const { projects } = service({ "projects/p.md": projectWith(["- [x] One — done 2026-08-01"]) });
    assert.ok((await projects.complete("p", { confirmOpenMilestones: true })).ok);
  });

  test("the structure flag does not gate completion", async () => {
    // Feature 3 FR-034e, re-asserted here because the migration touches the
    // same code path: a project missing its outcome closes as freely as a
    // fully structured one.
    const { projects } = service({ "projects/p.md": "# P\n\nstatus: active\n" });
    assert.ok((await projects.complete("p")).ok);
  });
});
