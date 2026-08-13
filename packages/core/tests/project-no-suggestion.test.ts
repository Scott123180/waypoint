import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { AreaService } from "../src/projects/area-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STUB_WITH_UNPROCESSED } from "./project-fixtures";

/**
 * Nothing is generated, ranked, defaulted, or pre-filled (FR-048, SC-016).
 *
 * Every stored outcome, milestone, next action, DRI, and verifier traces to an
 * explicit keystroke. This is the boundary that keeps Feature 7's LLM layer a
 * separate, opt-in thing rather than something that quietly leaked in here.
 */

function service(content = STUB_WITH_UNPROCESSED) {
  const vault = seedVault({ "projects/p.md": content, "areas/a.md": "# A\n\nstatus: active\n" });
  const clock = new FixedClock();
  return {
    vault,
    projects: new ProjectService({ vault, clock }),
    areas: new AreaService({ vault, clock }),
  };
}

describe("a newly created project", () => {
  test("has no outcome, milestone, next action, or DRI", async () => {
    const { projects } = service();
    const outcome = await projects.create("Brand new");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, null);
    assert.equal(outcome.project.nextAction, null);
    assert.equal(outcome.project.dri, null);
    assert.deepEqual(outcome.project.milestones, []);
  });

  test("writes no placeholder text into the file", async () => {
    const { vault, projects } = service();
    await projects.create("Brand new");
    const content = vault.files.get("projects/brand-new.md") ?? "";
    assert.equal(content, "# Brand new\n\nstatus: active\n");
  });
});

describe("unprocessed items are never turned into structure", () => {
  test("reading a project does not populate any field from them", async () => {
    const { projects } = service();
    const p = await projects.get("p");
    assert.equal(p?.unprocessed.length, 3);
    assert.equal(p?.outcome, null);
    assert.equal(p?.nextAction, null);
    assert.deepEqual(p?.milestones, []);
  });

  test("dismissing one populates nothing", async () => {
    const { projects } = service();
    const p = await projects.get("p");
    const item = p?.unprocessed[0];
    assert.ok(item);

    const outcome = await projects.dismissUnprocessed("p", item.index, item.raw);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, null);
    assert.equal(outcome.project.nextAction, null);
    assert.deepEqual(outcome.project.milestones, []);
  });

  test("no verb exists that would promote or convert one", () => {
    const surface = Object.getOwnPropertyNames(ProjectService.prototype);
    for (const name of surface) {
      assert.doesNotMatch(
        name,
        /suggest|promote|convert|infer|generate|autofill|rank/i,
        `${name}() would put suggestion in the core; that is Feature 7's job`,
      );
    }
  });
});

describe("stored values equal what was passed, exactly", () => {
  test("an outcome is stored verbatim, not reworded or capitalized", async () => {
    const { projects } = service();
    const typed = "no leak. and the claim settled";
    const outcome = await projects.setOutcome("p", null, typed);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, typed);
  });

  test("a milestone is stored verbatim", async () => {
    const { projects } = service();
    const typed = "estimate approved BY THE insurer";
    const outcome = await projects.addMilestone("p", typed, "priya");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.definitionOfDone, typed);
    assert.equal(outcome.project.milestones[0]?.verifier, "priya");
  });

  test("a milestone with no verifier gets none invented", async () => {
    const { projects } = service();
    const outcome = await projects.addMilestone("p", "Something", null);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.verifier, null);
  });

  test("a next action is not derived from a milestone", async () => {
    const { projects } = service();
    await projects.addMilestone("p", "The first milestone", "me");
    const p = await projects.get("p");
    assert.equal(p?.nextAction, null, "a next action must be typed, not inferred");
  });

  test("an outcome is not derived from the title", async () => {
    const { projects } = service();
    const outcome = await projects.create("Fix the roof properly");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, null);
  });

  test("an area gets nothing pre-filled either", async () => {
    const { vault, areas } = service();
    await areas.create("Household");
    assert.equal(vault.files.get("areas/household.md"), "# Household\n\nstatus: active\n");
  });
});
