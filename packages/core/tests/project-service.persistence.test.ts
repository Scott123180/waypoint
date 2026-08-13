import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STUB } from "./project-fixtures";

/**
 * No save step (FR-030).
 *
 * An edit is durable the moment the call returns. Unlike capture — which
 * returns before the disk so it never hesitates — structure editing awaits it,
 * because the user has already moved on to the next field and will not be told
 * later that the write failed.
 */

function service(content = STUB) {
  const vault = seedProject("p", content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("edits persist without an explicit save", () => {
  test("the file has changed by the time the call resolves", async () => {
    const { vault, projects } = service();
    await projects.setOutcome("p", null, "Done means done.");
    assert.match(vault.files.get("projects/p.md") ?? "", /Done means done\./);
  });

  test("there is no commit, save, or flush verb to forget to call", async () => {
    const surface = new Set(
      Object.getOwnPropertyNames(Object.getPrototypeOf(service().projects)),
    );
    for (const name of ["save", "commit", "flush", "persist", "sync"]) {
      assert.ok(!surface.has(name), `ProjectService must not expose ${name}()`);
    }
  });

  test("a fresh service — the equivalent of restarting the app — sees the edit", async () => {
    const { vault, projects } = service();
    await projects.setOutcome("p", null, "Survives a restart.");
    await projects.setDri("p", null, "me");

    const reopened = new ProjectService({ vault, clock: new FixedClock() });
    const p = await reopened.get("p");
    assert.equal(p?.outcome, "Survives a restart.");
    assert.equal(p?.dri, "me");
  });

  test("every mutating verb is durable on return, not merely queued", async () => {
    const { vault, projects } = service();
    await projects.addMilestone("p", "One", "me");
    await projects.setStatus("p", "active", "parked");

    const reopened = new ProjectService({ vault, clock: new FixedClock() });
    const p = await reopened.get("p");
    assert.equal(p?.milestones.length, 1);
    assert.equal(p?.status, "parked");
  });

  test("a failed write surfaces as an error rather than a silent success", async () => {
    // If the disk refuses, the user must not be told the edit was saved.
    const { vault, projects } = service();
    vault.failWrites.add("projects/p.md");
    await assert.rejects(() => projects.setOutcome("p", null, "Never lands"));
  });
});
