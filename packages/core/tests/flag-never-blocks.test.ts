import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STRUCTURED, STUB } from "./project-fixtures";

/**
 * The flag is informational and blocks nothing (FR-019, FR-034e, SC-006).
 *
 * This is the test that keeps the whole design honest. "Structure is never
 * forced" is easy to say and easy to erode one confirmation dialog at a time —
 * so every verb is exercised against a bare stub and a fully structured project
 * and required to behave identically.
 */

function service(content: string) {
  const vault = seedVault({ "projects/p.md": content });
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

/** Every mutating verb, run against whatever project it is handed. */
async function runEveryVerb(projects: ProjectService): Promise<string[]> {
  const refused: string[] = [];
  const check = (name: string, outcome: { ok: boolean }): void => {
    if (!outcome.ok) refused.push(name);
  };

  // Each verb is handed the value the file currently holds, exactly as a view
  // would after rendering it. Passing a guessed value would test verification,
  // which is a different file's job.
  const p0 = await projects.get("p");
  check("setOutcome", await projects.setOutcome("p", p0?.outcome ?? null, "An outcome"));
  const p1 = await projects.get("p");
  check("setNextAction", await projects.setNextAction("p", p1?.nextAction ?? null, "An action"));
  const p2 = await projects.get("p");
  check("setDri", await projects.setDri("p", p2?.dri ?? null, "me"));
  const p3 = await projects.get("p");
  check("setTitle", await projects.setTitle("p", p3?.title ?? "", "Renamed"));
  const p4 = await projects.get("p");
  check("setStatus", await projects.setStatus("p", p4?.status ?? "active", "waiting"));

  const before = await projects.get("p");
  if ((before?.milestones.length ?? 0) < 4) {
    check("addMilestone", await projects.addMilestone("p", "A milestone", "me"));
  }

  const withM = await projects.get("p");
  const m = withM?.milestones[0];
  if (m) {
    const ref = { index: m.index, raw: m.raw };
    check("completeMilestone", await projects.completeMilestone("p", ref));

    const after = await projects.get("p");
    const m2 = after?.milestones[0];
    if (m2) {
      const ref2 = { index: m2.index, raw: m2.raw };
      check("editMilestone", await projects.editMilestone("p", ref2, "Reworded", "Sam"));
      const after2 = await projects.get("p");
      const m3 = after2?.milestones[0];
      if (m3) check("reopenMilestone", await projects.reopenMilestone("p", { index: m3.index, raw: m3.raw }));
    }
  }

  check("complete", await projects.complete("p", { confirmOpenMilestones: true }));
  check("reopen", await projects.reopen("p", "active"));

  const last = await projects.get("p");
  const lm = last?.milestones[0];
  if (lm) check("removeMilestone", await projects.removeMilestone("p", { index: lm.index, raw: lm.raw }));

  return refused;
}

describe("every verb behaves identically on a flagged project", () => {
  test("a bare stub refuses nothing", async () => {
    const { projects } = service(STUB.replace("Roof repair", "P"));
    assert.deepEqual(await runEveryVerb(projects), []);
  });

  test("a fully structured project refuses nothing either", async () => {
    const { projects } = service(STRUCTURED);
    assert.deepEqual(await runEveryVerb(projects), []);
  });

  test("the two produce the same refusal set — the flag changes nothing", async () => {
    const stub = service(STUB.replace("Roof repair", "P"));
    const full = service(STRUCTURED);
    assert.deepEqual(await runEveryVerb(stub.projects), await runEveryVerb(full.projects));
  });
});

describe("no extra confirmation is required of an incomplete project", () => {
  test("completing a stub needs no confirmation at all", async () => {
    const { projects } = service(STUB.replace("Roof repair", "P"));
    const outcome = await projects.complete("p");
    assert.ok(outcome.ok, "a stub must close without being asked anything");
  });

  test("completing a project missing only its outcome needs no confirmation", async () => {
    const { projects } = service("# P\n\nstatus: active\nnext action: Do it\n\n## Milestones\n\n- [x] One — done 2026-01-01\n");
    const outcome = await projects.complete("p");
    assert.ok(outcome.ok);
  });

  test("the only confirmation in the feature is about open milestones, not about gaps", async () => {
    // A stub has three gaps and no milestones: it closes silently. A structured
    // project with open milestones asks. The trigger is work, never structure.
    const stub = service(STUB.replace("Roof repair", "P"));
    assert.ok((await stub.projects.complete("p")).ok);

    const full = service(STRUCTURED);
    const outcome = await full.projects.complete("p");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "open-milestones");
  });
});

describe("reading a flagged project is not degraded", () => {
  test("a stub returns a complete, usable project object", async () => {
    const { projects } = service(STUB.replace("Roof repair", "P"));
    const p = await projects.get("p");
    assert.ok(p);
    assert.equal(p.title, "P");
    assert.equal(p.status, "active");
    assert.deepEqual(p.milestones, []);
  });

  test("a flagged project appears in both lists like any other", async () => {
    const { projects } = service(STUB.replace("Roof repair", "P"));
    assert.equal((await projects.list()).length, 1);
    assert.equal((await projects.listActive()).length, 1);
  });
});
