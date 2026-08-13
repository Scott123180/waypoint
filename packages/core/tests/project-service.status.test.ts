import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { PROJECT_STATUSES, type ProjectStatus } from "../src/projects/types";
import { FixedClock, seedProject } from "./project-fakes";
import { STUB } from "./project-fixtures";

/**
 * Status moves freely among the four, in both directions, at any time
 * (FR-002, FR-029).
 */

function service(content = STUB) {
  const vault = seedProject("p", content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("setStatus", () => {
  for (const from of PROJECT_STATUSES) {
    for (const to of PROJECT_STATUSES) {
      if (from === to) continue;
      test(`${from} → ${to}`, async () => {
        const { projects } = service(`# P\n\nstatus: ${from}\n`);
        const outcome = await projects.setStatus("p", from as ProjectStatus, to as ProjectStatus);
        assert.ok(outcome.ok, `${from} → ${to} should be allowed`);
        assert.equal(outcome.project.status, to);
      });
    }
  }

  test("takes effect immediately, with no separate confirm", async () => {
    const { vault, projects } = service();
    await projects.setStatus("p", "active", "parked");
    assert.match(vault.files.get("projects/p.md") ?? "", /^status: parked$/m);
  });

  test("changes only the status line", async () => {
    const { vault, projects } = service();
    const before = vault.files.get("projects/p.md") ?? "";
    await projects.setStatus("p", "active", "waiting");
    const after = vault.files.get("projects/p.md") ?? "";
    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("status:")).join("\n");
    assert.equal(strip(after), strip(before));
  });

  test("a stub with no status line can still be moved off active", async () => {
    const { projects } = service("# P\n");
    const outcome = await projects.setStatus("p", "active", "parked");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.status, "parked");
  });

  test("setting the status a project already has is accepted and idempotent", async () => {
    const { vault, projects } = service();
    const outcome = await projects.setStatus("p", "active", "active");
    assert.ok(outcome.ok);
    assert.equal(vault.files.get("projects/p.md"), STUB);
  });
});
