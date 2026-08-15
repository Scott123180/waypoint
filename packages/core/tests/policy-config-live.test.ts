import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Rules travel with the data (FR-057, FR-058, SC-013).
 *
 * Editing `policy.md` alone changes what every client enforces, with no
 * application change and no restart. That is the whole reason configuration
 * lives in the vault rather than in app config: any client opening this
 * directory loads identical rules from the directory itself, so two clients
 * cannot disagree, and the rules travel across machines with the data.
 */

const NOW = "2026-08-14T10:00:00-04:00";

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

describe("policy configuration takes effect from the file", () => {
  test("changing the WIP limit changes where the refusal fires", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 2; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
    files["projects/candidate.md"] = project("Candidate", "parked", "Scott Rodgers");

    const vault = seedVault(files);
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    // Default of three: two active, so a third is allowed.
    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok);
    await projects.setStatus("candidate", "active", "parked");

    // Two: the same third attempt is now refused. Same code, same data, one
    // edited line.
    vault.files.set("policy.md", "wip limit: 2\n");
    const refused = await projects.setStatus("candidate", "parked", "active");
    assert.ok(!refused.ok);
    assert.equal(refused.reason, "wip-limit");

    // Four: allowed again.
    vault.files.set("policy.md", "wip limit: 4\n");
    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok);
  });

  test("the message reports the configured limit, not the default", async () => {
    const files: Record<string, string> = {
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: 1\n",
      "projects/mine.md": project("Mine", "active", "Scott Rodgers"),
      "projects/candidate.md": project("Candidate", "parked", "Scott Rodgers"),
    };
    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock(NOW) });

    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(!result.ok);
    assert.match(result.message, /limit is 1/);
  });

  test("changing the weekly outcome cap changes where that refusal fires", async () => {
    const vault = seedVault({});
    const topThree = new TopThreeService({ vault, clock: new FixedClock(NOW) });

    vault.files.set("policy.md", "weekly outcome cap: 1\n");
    assert.ok((await topThree.addOutcome("a")).ok);
    assert.ok(!(await topThree.addOutcome("b")).ok, "capped at one");

    vault.files.set("policy.md", "weekly outcome cap: 3\n");
    assert.ok((await topThree.addOutcome("b")).ok, "raised, with no restart");
    assert.ok((await topThree.addOutcome("c")).ok);
    assert.ok(!(await topThree.addOutcome("d")).ok);
  });

  test("changing the milestone cap changes where that refusal fires", async () => {
    const vault = seedVault({ "projects/p.md": "# P\n\nstatus: active\n" });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    vault.files.set("policy.md", "milestone cap: 2\n");
    assert.ok((await projects.addMilestone("p", "One", null)).ok);
    assert.ok((await projects.addMilestone("p", "Two", null)).ok);

    const third = await projects.addMilestone("p", "Three", null);
    assert.ok(!third.ok, "capped at two");
    assert.equal(third.reason, "milestone-cap");

    vault.files.set("policy.md", "milestone cap: 6\n");
    assert.ok((await projects.addMilestone("p", "Three", null)).ok, "raised, with no restart");
  });

  test("a change is picked up on the next decision, with no restart", async () => {
    // The service instance is reused throughout: nothing is cached at
    // construction, so the file is the live source of truth.
    const vault = seedVault({ "projects/p.md": "# P\n\nstatus: active\n" });
    const projects = new ProjectService({ vault, clock: new FixedClock(NOW) });

    vault.files.set("policy.md", "milestone cap: 1\n");
    assert.ok((await projects.addMilestone("p", "One", null)).ok);
    assert.ok(!(await projects.addMilestone("p", "Two", null)).ok);

    vault.files.set("policy.md", "milestone cap: 2\n");
    assert.ok((await projects.addMilestone("p", "Two", null)).ok);
  });

  test("two services over the same vault get the same decision", async () => {
    // The structural guarantee: clients cannot disagree about policy, because
    // both load it from the data rather than from their own configuration.
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: 1\n",
      "projects/mine.md": project("Mine", "active", "Scott Rodgers"),
      "projects/candidate.md": project("Candidate", "parked", "Scott Rodgers"),
    });

    const clientA = new ProjectService({ vault, clock: new FixedClock(NOW) });
    const clientB = new ProjectService({ vault, clock: new FixedClock(NOW) });

    const a = await clientA.setStatus("candidate", "parked", "active");
    const b = await clientB.setStatus("candidate", "parked", "active");

    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.ok(!a.ok && !b.ok);
    assert.equal(a.message, b.message, "same rules, same words");
  });
});
