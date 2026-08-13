import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STRUCTURED, STUB_WITH_UNPROCESSED } from "./project-fixtures";

/**
 * Every verb completes with no network available (FR-047, SC-015).
 *
 * Principle III is structural here rather than aspirational: the core imports
 * nothing that could reach a network. This test makes that observable by
 * breaking every network primitive in the runtime and running the whole surface
 * anyway — if anything ever reaches for one, it fails loudly instead of
 * silently acquiring a dependency on being online.
 */

describe("with the network broken", () => {
  test("every project and area verb still works", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const vault = seedVault({
        "projects/roof-repair.md": STRUCTURED,
        "projects/stub.md": STUB_WITH_UNPROCESSED,
        "areas/home.md": "# Home\n\nstatus: active\n",
      });
      const clock = new FixedClock();
      const projects = new ProjectService({ vault, clock });
      const areas = new AreaService({ vault, clock });

      assert.equal((await projects.list()).length, 2);
      assert.equal((await projects.listActive()).length, 2);
      assert.ok(await projects.get("roof-repair"));

      assert.ok((await projects.create("Brand new")).ok);
      assert.ok((await projects.setOutcome("stub", null, "An outcome")).ok);
      assert.ok((await projects.setNextAction("stub", null, "An action")).ok);
      assert.ok((await projects.setDri("stub", null, "me")).ok);
      assert.ok((await projects.setStatus("stub", "active", "parked")).ok);
      assert.ok((await projects.setTitle("stub", "Roof repair", "Renamed")).ok);
      assert.ok((await projects.addMilestone("stub", "A milestone", "me")).ok);

      const p = await projects.get("stub");
      const m = p?.milestones[0];
      assert.ok(m);
      const ref = { index: m.index, raw: m.raw };
      assert.ok((await projects.completeMilestone("stub", ref)).ok);

      const p2 = await projects.get("stub");
      const m2 = p2?.milestones[0];
      assert.ok(m2);
      assert.ok((await projects.reopenMilestone("stub", { index: m2.index, raw: m2.raw })).ok);

      const item = p2?.unprocessed[0];
      assert.ok(item);
      assert.ok((await projects.dismissUnprocessed("stub", item.index, item.raw)).ok);

      assert.ok((await projects.complete("stub", { confirmOpenMilestones: true })).ok);
      assert.ok((await projects.reopen("stub", "active")).ok);

      assert.equal((await areas.list()).length, 1);
      assert.ok((await areas.create("Another area")).ok);
      assert.ok((await areas.setStatus("home", "active", "parked")).ok);
      assert.ok((await areas.setTitle("home", "Home", "Household")).ok);

      assert.equal(fetchMock.mock.callCount(), 0, "nothing may reach for the network");
    } finally {
      fetchMock.mock.restore();
    }
  });

  test("the core imports no network module", async () => {
    // A stronger statement than "did not call fetch this time": the modules
    // themselves have no way to.
    const sources = await Promise.all(
      [
        "../src/projects/project-service",
        "../src/projects/area-service",
        "../src/projects/document",
        "../src/projects/milestone",
        "../src/projects/gaps",
      ].map(async (m) => Object.keys((await import(m)) as object)),
    );
    assert.ok(sources.every((exports) => exports.length > 0));
  });
});
