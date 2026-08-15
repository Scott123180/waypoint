import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The limit guards becoming active, and nothing else (FR-043, FR-048).
 *
 * Every other transition must stay open, especially the ones that make room —
 * a limit that made parking harder would be actively hostile.
 */

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

function atTheLimit(extra: Record<string, string> = {}) {
  const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n", ...extra };
  for (let i = 0; i < 3; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("which transitions the limit touches", () => {
  test("active to parked, waiting and done are never blocked", async () => {
    for (const to of ["parked", "waiting", "done"] as const) {
      const { projects } = atTheLimit();
      const result = await projects.setStatus("mine-0", "active", to);
      assert.ok(result.ok, `active → ${to} must not be blocked`);
    }
  });

  test("parked to waiting is not blocked", async () => {
    const { projects } = atTheLimit({ "projects/p.md": project("P", "parked", "Scott Rodgers") });
    assert.ok((await projects.setStatus("p", "parked", "waiting")).ok);
  });

  test("waiting projects are not counted (FR-043)", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 8; i++) files[`projects/w-${i}.md`] = project(`Waiting ${i}`, "waiting", "Scott Rodgers");
    files["projects/candidate.md"] = project("Candidate", "parked", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    assert.ok(
      (await projects.setStatus("candidate", "parked", "active")).ok,
      "waiting is blocked on someone else, not being driven",
    );
  });

  test("parked and done projects are not counted", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 6; i++) files[`projects/p-${i}.md`] = project(`Parked ${i}`, "parked", "Scott Rodgers");
    for (let i = 0; i < 6; i++) files[`projects/d-${i}.md`] = project(`Done ${i}`, "done", "Scott Rodgers");
    files["projects/candidate.md"] = project("Candidate", "waiting", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    assert.ok((await projects.setStatus("candidate", "waiting", "active")).ok);
  });

  test("re-setting an already-active project to active does not count itself", async () => {
    // Otherwise a no-op write would refuse at the limit rather than above it.
    const { projects } = atTheLimit();
    const result = await projects.setStatus("mine-0", "active", "active");
    assert.ok(result.ok, "a project cannot push itself over the limit");
  });

  test("completing a project at the limit is never blocked", async () => {
    const { projects } = atTheLimit();
    assert.ok((await projects.complete("mine-0", { confirmOpenMilestones: true })).ok);
  });

  test("creating a project at the limit is never blocked", async () => {
    // Sort creates stubs mid-flow. A limit that could refuse a capture would
    // be a limit that breaks the inbox.
    const { projects } = atTheLimit();
    const created = await projects.create("Something new");
    assert.ok(created.ok);
    assert.equal(created.project.status, "active", "the stub is active and has no DRI, so it does not count");
  });

  test("editing any other field at the limit is never blocked", async () => {
    const { projects } = atTheLimit();
    assert.ok((await projects.setOutcome("mine-0", null, "An outcome")).ok);
    assert.ok((await projects.setNextAction("mine-0", null, "A next action")).ok);
    assert.ok((await projects.addMilestone("mine-0", "A milestone", null)).ok);
    assert.ok((await projects.setTitle("mine-0", "Mine 0", "Renamed")).ok);
  });

  test("setting a DRI at the limit is not blocked, even when it goes over", async () => {
    // The limit guards the status transition it mediates. A DRI change can
    // reach an over-limit state, and that is surfaced rather than refused —
    // in a plain-text system the user can always reach it by hand anyway
    // (FR-050).
    const { projects } = atTheLimit({ "projects/theirs.md": project("Theirs", "active", "Priya") });
    const result = await projects.setDri("theirs", "Priya", "Scott Rodgers");

    assert.ok(result.ok);
    const state = await projects.overLimitState();
    assert.equal(state.driving, 4);
    assert.equal(state.hasRoom, false);
  });
});
