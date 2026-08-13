import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { structureGaps } from "../src/projects/gaps";
import { FixedClock, seedProject } from "./project-fakes";
import { STUB } from "./project-fixtures";

/**
 * The cap is enforced, the floor is not (FR-013, FR-013a).
 *
 * Four is where the scope-creep discipline actually lives, so the core refuses
 * a fifth. One milestone is just a project mid-typing, so nothing objects to
 * it — and zero remains the only count that flags, which keeps the structure
 * flag meaning "nothing here yet" rather than "not shaped the way we prefer".
 */

function service(content = STUB) {
  const vault = seedProject("p", content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("addMilestone", () => {
  test("adds one with its definition of done and verifier", async () => {
    const { projects } = service();
    const outcome = await projects.addMilestone("p", "Estimate approved by insurer", "Priya");
    assert.ok(outcome.ok);
    const m = outcome.project.milestones[0];
    assert.equal(m?.definitionOfDone, "Estimate approved by insurer");
    assert.equal(m?.verifier, "Priya");
    assert.equal(m?.done, false);
    assert.equal(m?.completedOn, null);
  });

  test("a verifier may be the user, recorded like any other name", async () => {
    const { projects } = service();
    const outcome = await projects.addMilestone("p", "Ship it", "me");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.verifier, "me");
  });

  test("a milestone may be added before its verifier is decided", async () => {
    const { projects } = service();
    const outcome = await projects.addMilestone("p", "Figure out who signs this off", null);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[0]?.verifier, null);
  });

  test("keeps them in the order they were added", async () => {
    const { projects } = service();
    await projects.addMilestone("p", "First", null);
    await projects.addMilestone("p", "Second", null);
    await projects.addMilestone("p", "Third", null);
    const p = await projects.get("p");
    assert.deepEqual(p?.milestones.map((m) => m.definitionOfDone), ["First", "Second", "Third"]);
  });

  describe("the first four are accepted without objection", () => {
    test("one through four all succeed", async () => {
      const { projects } = service();
      for (const n of [1, 2, 3, 4]) {
        const outcome = await projects.addMilestone("p", `M${n}`, null);
        assert.ok(outcome.ok, `milestone ${n} should be accepted`);
        assert.equal(outcome.project.milestones.length, n);
      }
    });

    test("a single milestone is not flagged for being below two", async () => {
      const { projects } = service();
      await projects.addMilestone("p", "The only one", null);
      const p = await projects.get("p");
      assert.ok(p);
      assert.ok(!structureGaps(p).includes("milestones"));
    });
  });

  describe("the fifth is refused (FR-013)", () => {
    async function withFour() {
      const s = service();
      for (const n of [1, 2, 3, 4]) await s.projects.addMilestone("p", `M${n}`, null);
      s.vault.writeLog.length = 0;
      return s;
    }

    test("refuses with milestone-cap", async () => {
      const { projects } = await withFour();
      const outcome = await projects.addMilestone("p", "A fifth", null);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok === false && outcome.reason, "milestone-cap");
    });

    test("leaves all four existing milestones untouched and writes nothing", async () => {
      const { vault, projects } = await withFour();
      const before = vault.files.get("projects/p.md");
      await projects.addMilestone("p", "A fifth", null);
      assert.equal(vault.files.get("projects/p.md"), before);
      assert.deepEqual(vault.writeLog, []);
    });

    test("explains that four is the cap and removing one is the way forward", async () => {
      const { projects } = await withFour();
      const outcome = await projects.addMilestone("p", "A fifth", null);
      assert.ok(outcome.ok === false);
      assert.match(outcome.message, /four/i);
    });

    test("removing one then adding a different one works", async () => {
      const { projects } = await withFour();
      const p = await projects.get("p");
      const ref = p?.milestones[1];
      assert.ok(ref);
      await projects.removeMilestone("p", { index: ref.index, raw: ref.raw });
      const outcome = await projects.addMilestone("p", "The replacement", null);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.milestones.length, 4);
    });
  });

  describe("a milestone with no definition of done", () => {
    for (const value of ["", "   "]) {
      test(`refuses ${JSON.stringify(value)} and writes nothing`, async () => {
        const { vault, projects } = service();
        const outcome = await projects.addMilestone("p", value, "Priya");
        assert.equal(outcome.ok, false);
        assert.equal(outcome.ok === false && outcome.reason, "empty-value");
        assert.deepEqual(vault.writeLog, []);
      });
    }
  });

  test("refuses on a project that does not exist", async () => {
    const { projects } = service();
    const outcome = await projects.addMilestone("ghost", "Anything", null);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "not-found");
  });
});
