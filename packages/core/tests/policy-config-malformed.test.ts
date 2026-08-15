import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * A broken config line degrades to a default and blocks nothing (FR-060,
 * SC-015).
 *
 * Two properties, and the second is the one that is easy to get wrong:
 *
 *   1. The problem is surfaced, never thrown. A typo in a file the user is
 *      invited to hand-edit must not take the application down.
 *
 *   2. Fallback is **per value**. A typo in `wip limit` must not silently
 *      restore a milestone cap of four when the user deliberately set six —
 *      that would be one mistake quietly undoing an unrelated decision.
 */

const NOW = "2026-08-14T10:00:00-04:00";

describe("malformed policy configuration", () => {
  test("one broken value does not disturb the others", async () => {
    const vault = seedVault({
      "policy.md": ["wip limit: banana", "milestone cap: 6", "weekly outcome cap: 5"].join("\n"),
      "projects/p.md": "# P\n\nstatus: active\n",
    });
    const clock = new FixedClock(NOW);
    const projects = new ProjectService({ vault, clock });
    const topThree = new TopThreeService({ vault, clock });

    // The deliberate settings survive.
    for (const label of ["One", "Two", "Three", "Four", "Five", "Six"]) {
      assert.ok((await projects.addMilestone("p", label, null)).ok, `${label} within a cap of six`);
    }
    assert.ok(!(await projects.addMilestone("p", "Seven", null)).ok, "and six is still a cap");

    for (const text of ["a", "b", "c", "d", "e"]) {
      assert.ok((await topThree.addOutcome(text)).ok, `${text} within a cap of five`);
    }
  });

  test("the broken value falls back to its own default", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: banana\n",
      "projects/a.md": "# A\n\nstatus: active\ndri: Scott Rodgers\n",
      "projects/b.md": "# B\n\nstatus: active\ndri: Scott Rodgers\n",
      "projects/c.md": "# C\n\nstatus: parked\ndri: Scott Rodgers\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    // Default of three: two active, so a third is allowed.
    assert.ok((await projects.setStatus("c", "parked", "active")).ok);
  });

  test("the problem is surfaced to the user", async () => {
    const vault = seedVault({ "policy.md": "wip limit: banana\n" });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    const state = await projects.overLimitState();
    assert.match(state.message, /wip limit/, "the offending key is named so it can be found");
    assert.match(state.message, /whole number/i, "and what is wrong with it");
  });

  test("nothing throws, whatever the file contains", async () => {
    const nonsense = [
      "wip limit: -1",
      "milestone cap: 2.5",
      "weekly outcome cap:",
      "wip limit: ",
      "::::",
      "# just a heading",
      "",
    ];
    for (const content of nonsense) {
      const vault = seedVault({ "policy.md": content, "projects/p.md": "# P\n\nstatus: active\n" });
      const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

      const state = await projects.overLimitState();
      assert.equal(typeof state.driving, "number", `${JSON.stringify(content)} produced a usable answer`);
      assert.ok((await projects.addMilestone("p", "A milestone", null)).ok);
    }
  });

  test("a configuration error blocks no operation", async () => {
    const vault = seedVault({
      "policy.md": "wip limit: banana\nmilestone cap: nonsense\n",
      "identity.md": "me: Scott Rodgers\n",
      "projects/p.md": "# P\n\nstatus: parked\ndri: Scott Rodgers\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    assert.ok((await projects.setStatus("p", "parked", "active")).ok);
    assert.ok((await projects.addMilestone("p", "A milestone", null)).ok);
    assert.ok((await projects.setOutcome("p", null, "An outcome")).ok);
    assert.ok((await projects.complete("p", { confirmOpenMilestones: true })).ok);
  });

  test("a malformed file is never rewritten", async () => {
    // Repairing it would be the app editing a file the user owns, and would
    // destroy whatever they were mid-way through typing.
    const content = "wip limit: banana\n";
    const vault = seedVault({ "policy.md": content, "projects/p.md": "# P\n\nstatus: active\n" });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    await projects.overLimitState();
    await projects.addMilestone("p", "A milestone", null);

    assert.equal(vault.files.get("policy.md"), content);
    assert.ok(!vault.writeLog.includes("policy.md"));
  });
});
