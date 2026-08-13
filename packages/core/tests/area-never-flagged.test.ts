import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { FixedClock, seedVault } from "./project-fakes";
import { AREA } from "./project-fixtures";

/**
 * An area is never flagged as needing structure (FR-024, SC-013).
 *
 * Small, but it is what keeps User Story 3 working: if every ongoing
 * responsibility were permanently marked incomplete, the flag would become
 * noise the user learns to ignore, and the projects that genuinely need
 * attention would disappear into it.
 */

function service(files: Record<string, string> = { "areas/home-maintenance.md": AREA }) {
  const vault = seedVault(files);
  return { vault, areas: new AreaService({ vault, clock: new FixedClock() }) };
}

describe("an area exposes no structure concept at all", () => {
  test("its summary has no gaps field", async () => {
    const { areas } = service();
    const [summary] = await areas.list();
    assert.ok(summary);
    assert.ok(!("gaps" in summary), "an area cannot be asked whether it is structured");
  });

  test("its summary carries only what an area has", async () => {
    const { areas } = service();
    const [summary] = await areas.list();
    assert.deepEqual(Object.keys(summary ?? {}).sort(), ["rawStatus", "slug", "status", "title"]);
  });

  test("the full object carries no milestone, outcome, or completion field", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    for (const field of ["gaps", "milestones", "outcome", "nextAction", "dri", "completedOn"]) {
      assert.ok(!(field in (a ?? {})), `an area must have no ${field}`);
    }
  });

  test("a bare area with only a title is not flagged", async () => {
    const { areas } = service({ "areas/bare.md": "# Bare\n" });
    const [summary] = await areas.list();
    assert.ok(summary);
    assert.ok(!("gaps" in summary));
    assert.equal(summary.title, "Bare");
  });

  test("an area that has existed a long time with no structure is still fine", async () => {
    // There is no elapsed-time rule to trip. Time changes nothing about an area.
    const { areas } = service({ "areas/ancient.md": "# Ancient\n\nstatus: active\n" });
    const a = await areas.get("ancient");
    assert.equal(a?.status, "active");
  });
});
