import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { ProjectService } from "../src/projects/project-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * No file is created unless the user asks for one (FR-018, FR-019, FR-059).
 *
 * Absence is the normal case, not an error branch: every vault already on disk
 * has none of these three files. An application that quietly wrote
 * `policy.md`, `identity.md` or `top-three.md` into a git-tracked directory on
 * first run would be putting its own scaffolding into the user's repository and
 * their next commit — the plain-text promise cuts both ways.
 */

const NOW = "2026-08-14T10:00:00-04:00";
const NEW_FILES = ["policy.md", "identity.md", "top-three.md"];

describe("configuration files are never created unasked", () => {
  test("running every project and area verb creates none of them", async () => {
    const vault = seedVault({
      "projects/p.md": "# P\n\nstatus: active\n",
      "areas/a.md": "# A\n\nstatus: active\n",
    });
    const clock = new FixedClock(NOW);
    const projects = new ProjectService({ vault, clock });
    const areas = new AreaService({ vault, clock });

    await projects.list();
    await projects.listActive();
    await projects.listCompleted();
    await projects.get("p");
    await projects.getResolved("p");
    await projects.identityConfigured();
    await projects.overLimitState();
    await projects.create("Another");
    await projects.setOutcome("p", null, "An outcome");
    await projects.setNextAction("p", null, "A next action");
    await projects.setDri("p", null, "Someone");
    await projects.setTitle("p", "P", "P renamed");
    await projects.setStatus("p", "active", "parked");
    await projects.addMilestone("p", "A milestone", null);
    await projects.complete("p", { confirmOpenMilestones: true });
    await projects.reopen("p", "active");
    await areas.list();
    await areas.get("a");

    for (const file of NEW_FILES) {
      assert.ok(!vault.files.has(file), `${file} was created without being asked for`);
      assert.ok(!vault.writeLog.includes(file), `${file} appeared in the write log`);
    }
  });

  test("reading the top three creates nothing", async () => {
    const vault = seedVault({});
    const topThree = new TopThreeService({ vault, clock: new FixedClock(NOW) });

    await topThree.current();
    await topThree.history();

    assert.deepEqual(vault.writeLog, []);
    for (const file of NEW_FILES) assert.ok(!vault.files.has(file));
  });

  test("a refused write creates nothing either", async () => {
    const vault = seedVault({});
    const topThree = new TopThreeService({ vault, clock: new FixedClock(NOW) });

    const refused = await topThree.addOutcome("   ");
    assert.ok(!refused.ok);
    assert.ok(!vault.files.has("top-three.md"), "a refusal must not leave an empty file behind");
  });

  test("recording an outcome creates top-three.md and nothing else", async () => {
    // The one file a verb does create — because the user asked it to.
    const vault = seedVault({});
    const topThree = new TopThreeService({ vault, clock: new FixedClock(NOW) });

    assert.ok((await topThree.addOutcome("Something")).ok);

    assert.ok(vault.files.has("top-three.md"));
    assert.ok(!vault.files.has("policy.md"), "policy.md is still the user's to create");
    assert.ok(!vault.files.has("identity.md"), "and so is identity.md");
  });

  test("an empty vault produces working defaults with no files at all", async () => {
    const vault = seedVault({});
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    assert.deepEqual(await projects.list(), []);
    const state = await projects.overLimitState();
    assert.equal(state.driving, 0);
    assert.equal(state.identityConfigured, false);

    assert.equal(vault.files.size, 0, "nothing was written into an empty vault");
  });
});
