import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The milestone cap fires on exactly the same inputs before and after it moves
 * behind a decision point (FR-061, FR-062a, SC-014a).
 *
 * A **characterization** test. It is written against current behaviour and
 * passes the moment it is written — there is no Red step, because a refactor
 * adds no behaviour. The Red is supplied deliberately by breaking the rule and
 * watching this fail (T069); a characterization test that has never been
 * observed failing is decoration.
 *
 * The silent rows matter as much as the refusing one. A relocated rule that
 * starts firing *more* is drift a cap test alone would never notice, and the
 * user-visible symptom — a fourth milestone suddenly refused — would look like
 * a deliberate change rather than a bug.
 */

const STUB = "# P\n\nstatus: active\n";

function service() {
  const vault = seedVault({ "projects/p.md": STUB });
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

async function withMilestones(count: number) {
  const { vault, projects } = service();
  for (let i = 0; i < count; i++) {
    const added = await projects.addMilestone("p", `Milestone ${i}`, null);
    assert.ok(added.ok, `fixture: milestone ${i} should have been accepted`);
  }
  return { vault, projects };
}

describe("milestone cap: the trigger boundary", () => {
  test("the first milestone is accepted silently", async () => {
    const { projects } = await withMilestones(0);
    const result = await projects.addMilestone("p", "First", null);
    assert.ok(result.ok);
  });

  test("the second is accepted silently", async () => {
    const { projects } = await withMilestones(1);
    assert.ok((await projects.addMilestone("p", "Second", null)).ok);
  });

  test("the third is accepted silently", async () => {
    const { projects } = await withMilestones(2);
    assert.ok((await projects.addMilestone("p", "Third", null)).ok);
  });

  test("the FOURTH is accepted silently", async () => {
    // The row most likely to break in a migration, and the one no
    // refusal-focused test would catch.
    const { projects } = await withMilestones(3);
    const result = await projects.addMilestone("p", "Fourth", null);

    assert.ok(result.ok, "four milestones is within the cap and must stay so");
    assert.equal(result.project.milestones.length, 4);
  });

  test("the FIFTH is refused", async () => {
    const { projects } = await withMilestones(4);
    const result = await projects.addMilestone("p", "Fifth", null);

    assert.ok(!result.ok);
    assert.equal(result.reason, "milestone-cap");
  });

  test("the refusal explains itself and names the count", async () => {
    const { projects } = await withMilestones(4);
    const result = await projects.addMilestone("p", "Fifth", null);

    assert.ok(!result.ok);
    assert.match(result.message, /four/i, "the cap is stated");
    assert.match(result.message, /4/, "and so is the current count");
  });

  test("a refusal writes nothing and leaves the four intact", async () => {
    const { vault, projects } = await withMilestones(4);
    const before = vault.files.get("projects/p.md");

    await projects.addMilestone("p", "Fifth", null);

    assert.equal(vault.files.get("projects/p.md"), before);
    assert.equal((await projects.get("p"))?.milestones.length, 4);
  });

  test("removing one makes room for another", async () => {
    const { projects } = await withMilestones(4);
    const project = await projects.get("p");
    const last = project?.milestones[3];
    assert.ok(last);

    assert.ok((await projects.removeMilestone("p", { index: 3, raw: last.raw })).ok);
    assert.ok((await projects.addMilestone("p", "A replacement", null)).ok);
  });

  test("editing a milestone at the cap is never refused", async () => {
    const { projects } = await withMilestones(4);
    const project = await projects.get("p");
    const first = project?.milestones[0];
    assert.ok(first);

    assert.ok((await projects.editMilestone("p", { index: 0, raw: first.raw }, "Reworded", null)).ok);
  });

  test("completing a milestone at the cap is never refused", async () => {
    const { projects } = await withMilestones(4);
    const project = await projects.get("p");
    const first = project?.milestones[0];
    assert.ok(first);

    assert.ok((await projects.completeMilestone("p", { index: 0, raw: first.raw })).ok);
  });

  test("an empty definition of done is refused before the cap is consulted", async () => {
    // Ordering matters: the empty-value refusal must win, so the user is told
    // the actionable thing rather than being told about a cap they are not at.
    const { projects } = await withMilestones(4);
    const result = await projects.addMilestone("p", "   ", null);

    assert.ok(!result.ok);
    assert.equal(result.reason, "empty-value");
  });
});
