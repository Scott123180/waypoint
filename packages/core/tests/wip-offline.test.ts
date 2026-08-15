import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { createDefaultPolicy } from "../src/policy/default-policy";
import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Identity resolution and policy work with no network (FR-065, SC-016).
 *
 * Mirrors `project-offline.test.ts` and `top-three-offline.test.ts` for the two
 * modules Feature 4 adds. Principle III is structural — core imports nothing
 * that could reach a network — and these make it observable by breaking the
 * runtime's network primitive and running the whole surface anyway.
 */

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

describe("with the network broken", () => {
  test("identity resolution and the WIP limit still work", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const vault = seedVault({
        "identity.md": "me: Scott Rodgers\n\n## Aliases\n\n- Scott\n",
        "policy.md": "wip limit: 2\n",
        "projects/mine-0.md": project("Mine 0", "active", "Scott Rodgers"),
        "projects/mine-1.md": project("Mine 1", "active", "scott rodgers."),
        "projects/theirs.md": project("Theirs", "active", "Priya Sharma"),
        "projects/nobody.md": project("Nobody", "active", null),
        "projects/other-scott.md": project("Other", "parked", "Scott Kim"),
        "projects/ambiguous.md": project("Ambiguous", "parked", "Scott"),
        "projects/candidate.md": project("Candidate", "parked", "Scott Rodgers"),
      });
      const projects = new ProjectService({ vault, clock: new FixedClock() });

      // Every resolution.
      const summaries = await projects.list();
      const byTitle = new Map(summaries.map((s) => [s.title, s]));
      assert.equal(byTitle.get("Mine 0")?.dri.resolution, "mine");
      assert.equal(byTitle.get("Theirs")?.dri.resolution, "theirs");
      assert.equal(byTitle.get("Nobody")?.dri.resolution, "unassigned");
      assert.equal(byTitle.get("Ambiguous")?.dri.resolution, "ambiguous");
      assert.equal(byTitle.get("Nobody")?.needsDri, true);

      // Single-project resolution.
      assert.ok(await projects.getResolved("mine-0"));
      assert.equal(await projects.identityConfigured(), true);

      // The limit, from a policy file read off disk.
      const state = await projects.overLimitState();
      assert.equal(state.driving, 2);
      assert.equal(state.hasRoom, false);

      const refused = await projects.setStatus("candidate", "parked", "active");
      assert.ok(!refused.ok);
      assert.equal(refused.reason, "wip-limit");

      // And every other decision point.
      assert.ok((await projects.addMilestone("mine-0", "A milestone", null)).ok);
      assert.ok((await projects.complete("mine-0", { confirmOpenMilestones: true })).ok);

      assert.equal(fetchMock.mock.callCount(), 0, "nothing reached for the network");
    } finally {
      mock.restoreAll();
    }
  });

  test("the default policy module reaches for nothing but the vault", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const vault = seedVault({ "policy.md": "wip limit: 1\n" });
      const policy = createDefaultPolicy(vault);

      const decision = await policy.decide({
        point: "project.milestone.add",
        project: { slug: "p", title: "P", status: "active", dri: null },
        milestoneCount: 0,
      });

      assert.equal(decision.verdict, "allow");
      assert.equal(fetchMock.mock.callCount(), 0);
      assert.deepEqual(vault.writeLog, [], "deciding never writes");
    } finally {
      mock.restoreAll();
    }
  });
});
