import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * Editing and removing milestones, and the per-milestone verification unit
 * (FR-015, FR-016, FR-045d).
 *
 * A milestone's identity is position plus text. A hand-edit to a *different*
 * milestone must not cancel a write, or the guarantee becomes a nuisance the
 * user routes around.
 */

const path = "projects/roof-repair.md";

function service() {
  const vault = seedProject("roof-repair", STRUCTURED);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

async function refAt(projects: ProjectService, index: number) {
  const p = await projects.get("roof-repair");
  const m = p?.milestones[index];
  assert.ok(m, `expected a milestone at ${index}`);
  return { index: m.index, raw: m.raw };
}

describe("editMilestone", () => {
  test("changes the definition of done and leaves the others alone", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      await refAt(projects, 1),
      "Materials delivered and counted",
      "me",
    );
    assert.ok(outcome.ok);
    assert.deepEqual(
      outcome.project.milestones.map((m) => m.definitionOfDone),
      ["Estimate approved by insurer", "Materials delivered and counted", "Work signed off and claim paid"],
    );
  });

  test("changes the verifier", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      await refAt(projects, 1),
      "Materials delivered on site",
      "Sam",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[1]?.verifier, "Sam");
  });

  test("can clear a verifier back to none", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      await refAt(projects, 1),
      "Materials delivered on site",
      null,
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.project.milestones[1]?.verifier, null);
  });

  test("refuses an empty definition of done", async () => {
    const { vault, projects } = service();
    const outcome = await projects.editMilestone("roof-repair", await refAt(projects, 1), "  ", "me");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "empty-value");
    assert.equal(vault.files.get(path), STRUCTURED);
  });

  test("order is stable — editing does not reshuffle", async () => {
    const { projects } = service();
    await projects.editMilestone("roof-repair", await refAt(projects, 0), "Renamed first", "Priya");
    const p = await projects.get("roof-repair");
    assert.equal(p?.milestones[0]?.definitionOfDone, "Renamed first");
    assert.deepEqual(p?.milestones.map((m) => m.index), [0, 1, 2]);
  });
});

describe("removeMilestone", () => {
  test("removes exactly one and keeps the rest in order", async () => {
    const { projects } = service();
    const outcome = await projects.removeMilestone("roof-repair", await refAt(projects, 1));
    assert.ok(outcome.ok);
    assert.deepEqual(
      outcome.project.milestones.map((m) => m.definitionOfDone),
      ["Estimate approved by insurer", "Work signed off and claim paid"],
    );
  });

  test("reindexes the survivors", async () => {
    const { projects } = service();
    const outcome = await projects.removeMilestone("roof-repair", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.project.milestones.map((m) => m.index), [0, 1]);
  });

  test("removing a done milestone discards its date with it", async () => {
    // A deliberate destructive edit, not a breach of the durability guarantee
    // that protects dates from incidental edits.
    const { projects } = service();
    const outcome = await projects.removeMilestone("roof-repair", await refAt(projects, 0));
    assert.ok(outcome.ok);
    assert.ok(!outcome.project.milestones.some((m) => m.completedOn === "2026-08-14"));
  });

  test("leaves the rest of the file alone", async () => {
    const { vault, projects } = service();
    await projects.removeMilestone("roof-repair", await refAt(projects, 1));
    const after = vault.files.get(path) ?? "";
    assert.match(after, /^## Outcome$/m);
    assert.match(after, /^## Unprocessed$/m);
    assert.match(after, /Call the roofer back about the estimate/);
  });
});

describe("MilestoneRef verification (FR-045d)", () => {
  test("a milestone reworded on disk refuses the write", async () => {
    const { vault, projects } = service();
    const ref = await refAt(projects, 1);
    vault.files.set(path, (vault.files.get(path) ?? "").replace("Materials delivered on site", "Something else"));

    const outcome = await projects.editMilestone("roof-repair", ref, "New text", "me");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });

  test("a refused milestone write leaves the file byte-for-byte unchanged", async () => {
    const { vault, projects } = service();
    const ref = await refAt(projects, 1);
    const edited = (vault.files.get(path) ?? "").replace("Materials delivered on site", "Something else");
    vault.files.set(path, edited);
    vault.writeLog.length = 0;

    await projects.editMilestone("roof-repair", ref, "New text", "me");
    assert.equal(vault.files.get(path), edited);
    assert.deepEqual(vault.writeLog, []);
  });

  test("editing one milestone is NOT cancelled by a hand-edit to another", async () => {
    // Each milestone is its own verification unit. Anything coarser would make
    // a shared file unusable the moment two things changed.
    const { vault, projects } = service();
    const ref = await refAt(projects, 1);
    vault.files.set(path, (vault.files.get(path) ?? "").replace("Work signed off and claim paid", "Reworded by hand"));

    const outcome = await projects.editMilestone("roof-repair", ref, "Materials counted", "me");
    assert.ok(outcome.ok, "an edit to a different milestone must not cancel this one");
    assert.equal(outcome.project.milestones[2]?.definitionOfDone, "Reworded by hand");
  });

  test("a milestone removed on disk refuses rather than deleting the wrong one", async () => {
    const { vault, projects } = service();
    const ref = await refAt(projects, 2);
    vault.files.set(
      path,
      (vault.files.get(path) ?? "").replace("- [ ] Work signed off and claim paid — @Priya\n", ""),
    );

    const outcome = await projects.removeMilestone("roof-repair", ref);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });

  test("a stale index past the end of the list refuses", async () => {
    const { projects } = service();
    const outcome = await projects.editMilestone(
      "roof-repair",
      { index: 9, raw: "- [ ] Never existed" },
      "New",
      null,
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });
});
