import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED, STUB } from "./project-fixtures";

/**
 * Marking a project done (FR-034, FR-034a–FR-034e, SC-009a).
 *
 * With open milestones this asks rather than refuses. A hard refusal would be
 * routed around by deleting the milestone, which destroys its record — so the
 * confirmation is the honest version of the same guardrail. A project that
 * closes with a milestone that stopped mattering keeps that fact visible, which
 * is more truthful than a history edited to look tidy (research R8).
 *
 * The guardrail lives in the core so Feature 6's API and Feature 7's LLM layer
 * inherit it — and the LLM layer is exactly the caller that should not be able
 * to close projects quietly.
 */

const path = "projects/roof-repair.md";

function service(content = STRUCTURED, slug = "roof-repair") {
  const vault = seedProject(slug, content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }), slug };
}

describe("with open milestones", () => {
  test("refuses with open-milestones rather than completing", async () => {
    const { projects } = service();
    const outcome = await projects.complete("roof-repair");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "open-milestones");
  });

  test("names the still-open milestones, so the caller computes nothing", async () => {
    const { projects } = service();
    const outcome = await projects.complete("roof-repair");
    assert.ok(outcome.ok === false);
    assert.deepEqual(outcome.open, [
      "Materials delivered on site",
      "Work signed off and claim paid",
    ]);
  });

  test("writes nothing at all while unconfirmed", async () => {
    const { vault, projects } = service();
    await projects.complete("roof-repair");
    assert.deepEqual(vault.writeLog, []);
    assert.equal(vault.files.get(path), STRUCTURED);
  });

  test("is a refusal, not a thrown error — the caller renders it", async () => {
    const { projects } = service();
    const outcome = await projects.complete("roof-repair");
    assert.equal(typeof (outcome as { message?: string }).message, "string");
  });

  describe("once confirmed", () => {
    test("marks the project done and records the date", async () => {
      const { projects } = service();
      const outcome = await projects.complete("roof-repair", { confirmOpenMilestones: true });
      assert.ok(outcome.ok);
      assert.equal(outcome.project.status, "done");
      assert.equal(outcome.project.completedOn, "2026-08-12");
    });

    test("leaves the open milestones open, with no date invented for them", async () => {
      const { projects } = service();
      const outcome = await projects.complete("roof-repair", { confirmOpenMilestones: true });
      assert.ok(outcome.ok);
      assert.equal(outcome.project.milestones[1]?.done, false);
      assert.equal(outcome.project.milestones[1]?.completedOn, null);
      assert.equal(outcome.project.milestones[2]?.done, false);
      assert.equal(outcome.project.milestones[2]?.completedOn, null);
    });

    test("does not auto-complete, delete, or hide them", async () => {
      const { projects } = service();
      const outcome = await projects.complete("roof-repair", { confirmOpenMilestones: true });
      assert.ok(outcome.ok);
      assert.equal(outcome.project.milestones.length, 3);
    });

    test("drops the project out of the active list", async () => {
      const { projects } = service();
      await projects.complete("roof-repair", { confirmOpenMilestones: true });
      assert.deepEqual(await projects.listActive(), []);
      assert.equal((await projects.list()).length, 1, "but it still exists");
    });
  });

  test("declining changes nothing — the caller simply does not call again", async () => {
    const { vault, projects } = service();
    await projects.complete("roof-repair");
    const p = await projects.get("roof-repair");
    assert.equal(p?.status, "active");
    assert.equal(p?.completedOn, null);
    assert.equal(vault.files.get(path), STRUCTURED);
  });
});

describe("when no confirmation is needed (FR-034d)", () => {
  test("a project whose milestones are all done completes immediately", async () => {
    const { projects } = service();
    for (const i of [1, 2]) {
      const p = await projects.get("roof-repair");
      const m = p?.milestones[i];
      assert.ok(m);
      await projects.completeMilestone("roof-repair", { index: m.index, raw: m.raw });
    }

    const outcome = await projects.complete("roof-repair");
    assert.ok(outcome.ok, "all milestones done needs no confirmation");
    assert.equal(outcome.project.completedOn, "2026-08-12");
  });

  test("a project with no milestones at all completes immediately", async () => {
    const { projects } = service(STUB);
    const outcome = await projects.complete("roof-repair");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.status, "done");
  });
});

describe("the structure flag never gates completion (FR-034e)", () => {
  test("a project missing its outcome closes with no extra confirmation", async () => {
    const { projects } = service("# Roof repair\n\nstatus: active\nnext action: something\n");
    const outcome = await projects.complete("roof-repair");
    assert.ok(outcome.ok, "an incomplete project must close as freely as a complete one");
  });

  test("a bare stub closes with no extra confirmation", async () => {
    const { projects } = service(STUB);
    const outcome = await projects.complete("roof-repair");
    assert.ok(outcome.ok);
  });
});

describe("the completed file", () => {
  test("carries `completed:` and `status: done` in the preamble", async () => {
    const { vault, projects } = service(STUB);
    await projects.complete("roof-repair");
    const content = vault.files.get(path) ?? "";
    assert.match(content, /^status: done$/m);
    assert.match(content, /^completed: 2026-08-12$/m);
  });

  test("leaves everything else byte-for-byte alone", async () => {
    const { vault, projects } = service();
    await projects.complete("roof-repair", { confirmOpenMilestones: true });
    const after = vault.files.get(path) ?? "";
    assert.match(after, /^## Outcome$/m);
    assert.match(after, /- \[x\] Estimate approved by insurer — @Priya — done 2026-08-14/);
    assert.match(after, /Call the roofer back about the estimate/);
  });
});

test("completing a project that does not exist refuses", async () => {
  const { projects } = service();
  const outcome = await projects.complete("ghost");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.reason, "not-found");
});
