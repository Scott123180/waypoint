import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { AREA_HAND_MANGLED, STRUCTURED } from "./project-fixtures";

/**
 * An area hand-edited into something it is not stays an area (FR-043).
 *
 * The content is preserved because it is the user's, and ignored because an
 * area has no concept that would read it. Neither adopting it nor deleting it
 * is the app's call.
 */

function service(content = AREA_HAND_MANGLED) {
  const vault = seedVault({ "areas/home-maintenance.md": content });
  return {
    vault,
    areas: new AreaService({ vault, clock: new FixedClock() }),
    projects: new ProjectService({ vault, clock: new FixedClock() }),
  };
}

describe("an area with a hand-added Milestones section", () => {
  test("is still read as an area", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    assert.equal(a?.title, "Home maintenance");
    assert.ok(!("milestones" in (a ?? {})));
  });

  test("keeps the content byte-for-byte on read", async () => {
    const { vault, areas } = service();
    await areas.get("home-maintenance");
    await areas.list();
    assert.equal(vault.files.get("areas/home-maintenance.md"), AREA_HAND_MANGLED);
  });

  test("keeps the content when the area is edited", async () => {
    const { vault, areas } = service();
    await areas.setStatus("home-maintenance", "active", "parked");
    const after = vault.files.get("areas/home-maintenance.md") ?? "";
    assert.match(after, /^## Milestones$/m);
    assert.match(after, /This does not belong here and must survive anyway/);
  });

  test("does not appear in the project list", async () => {
    // Areas live in areas/. Nothing about their contents changes that.
    const { projects } = service();
    assert.deepEqual(await projects.list(), []);
  });
});

describe("a project file is not reachable through the area service", () => {
  test("an area slug matching a project name reads nothing", async () => {
    const vault = seedVault({ "projects/roof-repair.md": STRUCTURED });
    const areas = new AreaService({ vault, clock: new FixedClock() });
    assert.equal(await areas.get("roof-repair"), null);
    assert.deepEqual(await areas.list(), []);
  });

  test("creating an area does not collide with a project of the same title", async () => {
    const vault = seedVault({ "projects/roof-repair.md": STRUCTURED });
    const areas = new AreaService({ vault, clock: new FixedClock() });

    const outcome = await areas.create("Roof repair");
    assert.ok(outcome.ok);
    assert.ok(vault.files.has("areas/roof-repair.md"));
    assert.equal(vault.files.get("projects/roof-repair.md"), STRUCTURED, "the project is untouched");
  });
});
