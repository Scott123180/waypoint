import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED, STUB } from "./project-fixtures";

/**
 * Setting one field at a time, in any order, with no field demanding another
 * (FR-027, FR-028).
 *
 * Title is the exception that proves the rule: three fields are optional and
 * clear to null, and a title never can, because it is one of the two fields
 * always present (FR-003).
 */

function service(content = STUB, slug = "roof-repair") {
  const vault = seedProject(slug, content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }), slug };
}

describe("the optional scalar fields", () => {
  test("outcome persists on its own, demanding nothing else", async () => {
    const { projects, slug } = service();
    const outcome = await projects.setOutcome(slug, null, "The roof stops leaking.");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, "The roof stops leaking.");
    assert.equal(outcome.project.nextAction, null);
    assert.equal(outcome.project.dri, null);
    assert.deepEqual(outcome.project.milestones, []);
  });

  test("next action persists on its own", async () => {
    const { projects, slug } = service();
    const outcome = await projects.setNextAction(slug, null, "Call the roofer");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.nextAction, "Call the roofer");
    assert.equal(outcome.project.outcome, null);
  });

  test("dri persists on its own", async () => {
    const { projects, slug } = service();
    const outcome = await projects.setDri(slug, null, "me");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.dri, "me");
  });

  test("a multi-paragraph outcome survives intact", async () => {
    const { projects, slug } = service();
    const body = "One thing.\n\nAnd another, on a second paragraph.";
    const outcome = await projects.setOutcome(slug, null, body);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.outcome, body);
  });

  describe("clearing back to empty is a valid partial state (FR-028)", () => {
    test("outcome clears to null", async () => {
      const { projects, slug } = service(STRUCTURED);
      const before = (await projects.get(slug))?.outcome ?? null;
      const outcome = await projects.setOutcome(slug, before, null);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.outcome, null);
    });

    test("next action clears to null", async () => {
      const { projects, slug } = service(STRUCTURED);
      const before = (await projects.get(slug))?.nextAction ?? null;
      const outcome = await projects.setNextAction(slug, before, null);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.nextAction, null);
    });

    test("dri clears to null, and clearing it does not flag the project", async () => {
      const { projects, slug } = service(STRUCTURED);
      const outcome = await projects.setDri(slug, "me", null);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.dri, null);
    });

    test("an empty or whitespace value is stored as null, not as blank text", async () => {
      const { projects, slug } = service(STRUCTURED);
      const before = (await projects.get(slug))?.outcome ?? null;
      const outcome = await projects.setOutcome(slug, before, "   ");
      assert.ok(outcome.ok);
      assert.equal(outcome.project.outcome, null);
    });
  });
});

describe("title", () => {
  test("persists and keeps the value verbatim", async () => {
    const { projects, slug } = service();
    const outcome = await projects.setTitle(slug, "Roof repair", "Roof repair  (phase two)");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.title, "Roof repair  (phase two)");
  });

  test("does not rename the file, so the slug stays the identity", async () => {
    const { vault, projects, slug } = service();
    await projects.setTitle(slug, "Roof repair", "Something else");
    assert.ok(vault.files.has("projects/roof-repair.md"));
    assert.equal(vault.files.size, 1);
  });

  describe("cannot be cleared — a title is always present (FR-003)", () => {
    for (const attempt of ["", "   "]) {
      test(`refuses ${JSON.stringify(attempt)} and writes nothing`, async () => {
        const { vault, projects, slug } = service();
        const outcome = await projects.setTitle(slug, "Roof repair", attempt);
        assert.equal(outcome.ok, false);
        assert.equal(outcome.ok === false && outcome.reason, "empty-title");
        assert.deepEqual(vault.writeLog, []);
        assert.equal(vault.files.get("projects/roof-repair.md"), STUB);
      });
    }
  });
});

describe("setting a field on a project that is not there", () => {
  test("refuses with not-found rather than creating one", async () => {
    const { vault, projects } = service();
    const outcome = await projects.setOutcome("ghost", null, "Anything");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "not-found");
    assert.equal(vault.files.size, 1);
  });
});

describe("one field at a time", () => {
  test("four fields set across four separate calls all persist", async () => {
    // The user's actual working pattern: a bit of structure whenever they have
    // a minute, over days (SC-001).
    const { projects, slug } = service();
    await projects.setOutcome(slug, null, "No more leak.");
    await projects.setNextAction(slug, null, "Call the roofer");
    await projects.setDri(slug, null, "me");
    await projects.addMilestone(slug, "Estimate approved", "Priya");

    const p = await projects.get(slug);
    assert.equal(p?.outcome, "No more leak.");
    assert.equal(p?.nextAction, "Call the roofer");
    assert.equal(p?.dri, "me");
    assert.equal(p?.milestones.length, 1);
    assert.equal(p?.status, "active", "status was never touched");
  });

  test("editing one field leaves every other byte of the file alone", async () => {
    const { vault, projects, slug } = service(STRUCTURED);
    const before = vault.files.get("projects/roof-repair.md") ?? "";
    await projects.setDri(slug, "me", "Sam");
    const after = vault.files.get("projects/roof-repair.md") ?? "";

    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("dri:")).join("\n");
    assert.equal(strip(after), strip(before));
  });
});
