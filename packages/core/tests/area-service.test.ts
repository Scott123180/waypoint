import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { AREA_STATUSES } from "../src/projects/types";
import { FixedClock, seedArea, seedVault } from "./project-fakes";
import { AREA, AREA_HAND_MANGLED } from "./project-fixtures";

/**
 * An area is an ongoing responsibility: a title and a status, and nothing that
 * implies an end (FR-040, FR-041).
 *
 * "Home maintenance" will never be done, and pretending it needs four
 * milestones would be a lie the tool tells the user every time they open it.
 */

function service(files: Record<string, string> = { "areas/home-maintenance.md": AREA }) {
  const vault = seedVault(files);
  return { vault, areas: new AreaService({ vault, clock: new FixedClock() }) };
}

describe("reading", () => {
  test("get returns a title and a status", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    assert.equal(a?.title, "Home maintenance");
    assert.equal(a?.status, "active");
  });

  test("get returns null for an area that does not exist", async () => {
    const { areas } = service();
    assert.equal(await areas.get("nope"), null);
  });

  test("list returns a summary per area and ignores projects", async () => {
    const { areas } = service({ "areas/a.md": AREA, "projects/p.md": AREA });
    const all = await areas.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]?.slug, "a");
  });

  test("reading never writes", async () => {
    const { vault, areas } = service();
    await areas.get("home-maintenance");
    await areas.list();
    assert.deepEqual(vault.writeLog, []);
    assert.equal(vault.files.get("areas/home-maintenance.md"), AREA);
  });
});

describe("create", () => {
  test("writes a stub with a title and a status", async () => {
    const { vault, areas } = service({});
    const outcome = await areas.create("Home maintenance");
    assert.ok(outcome.ok);
    assert.equal(vault.files.get("areas/home-maintenance.md"), "# Home maintenance\n\nstatus: active\n");
  });

  test("returns the existing area when the title already exists", async () => {
    const { vault, areas } = service();
    const outcome = await areas.create("Home maintenance");
    assert.ok(outcome.ok);
    assert.equal(vault.files.size, 1);
    assert.deepEqual(vault.writeLog, []);
  });

  test("refuses an empty title", async () => {
    const { vault, areas } = service({});
    const outcome = await areas.create("   ");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "empty-title");
    assert.equal(vault.files.size, 0);
  });

  test("writes no outcome, milestone, next action, or DRI", async () => {
    const { vault, areas } = service({});
    await areas.create("Home maintenance");
    const content = vault.files.get("areas/home-maintenance.md") ?? "";
    for (const field of ["outcome", "milestone", "next action", "dri", "completed"]) {
      assert.doesNotMatch(content, new RegExp(field, "i"));
    }
  });
});

describe("setStatus", () => {
  test("moves between active and parked, both ways", async () => {
    const { areas } = service();
    const parked = await areas.setStatus("home-maintenance", "active", "parked");
    assert.ok(parked.ok);
    assert.equal(parked.area.status, "parked");

    const active = await areas.setStatus("home-maintenance", "parked", "active");
    assert.ok(active.ok);
    assert.equal(active.area.status, "active");
  });

  test("offers exactly two statuses", () => {
    // `done` is excluded by definition and `waiting` describes work blocked on
    // someone else's deliverable, which an ongoing responsibility does not have.
    assert.deepEqual([...AREA_STATUSES], ["active", "parked"]);
  });

  test("verifies before writing, like every other field", async () => {
    const { vault, areas } = service();
    vault.files.set("areas/home-maintenance.md", AREA.replace("status: active", "status: parked"));
    vault.writeLog.length = 0;

    const outcome = await areas.setStatus("home-maintenance", "active", "parked");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
    assert.deepEqual(vault.writeLog, []);
  });
});

describe("setTitle", () => {
  test("changes the heading and keeps the file", async () => {
    const { vault, areas } = service();
    const outcome = await areas.setTitle("home-maintenance", "Home maintenance", "House upkeep");
    assert.ok(outcome.ok);
    assert.equal(outcome.area.title, "House upkeep");
    assert.ok(vault.files.has("areas/home-maintenance.md"));
  });

  test("refuses an empty title", async () => {
    const { areas } = service();
    const outcome = await areas.setTitle("home-maintenance", "Home maintenance", "  ");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "empty-title");
  });
});

describe("a hand-edited status outside the area range (FR-041c)", () => {
  test("is shown as recorded rather than silently rewritten", async () => {
    const { vault, areas } = service({ "areas/home-maintenance.md": AREA_HAND_MANGLED });
    const a = await areas.get("home-maintenance");
    assert.equal(a?.rawStatus, "done");
    assert.deepEqual(vault.writeLog, [], "reading must not repair the file");
    assert.equal(vault.files.get("areas/home-maintenance.md"), AREA_HAND_MANGLED);
  });

  test("still resolves to a usable status, so the area works", async () => {
    const { areas } = service({ "areas/home-maintenance.md": AREA_HAND_MANGLED });
    const a = await areas.get("home-maintenance");
    assert.equal(a?.status, "active");
  });

  test("the user can move it back into range through the app", async () => {
    const { areas } = service({ "areas/home-maintenance.md": AREA_HAND_MANGLED });
    const outcome = await areas.setStatus("home-maintenance", "active", "parked");
    assert.ok(outcome.ok);
    assert.equal(outcome.area.status, "parked");
    assert.equal(outcome.area.rawStatus, "parked");
  });
});

describe("the verbs an area does NOT have (FR-024, FR-040, FR-041a)", () => {
  const surface = new Set(Object.getOwnPropertyNames(AreaService.prototype));

  for (const verb of [
    "setOutcome",
    "setNextAction",
    "setDri",
    "addMilestone",
    "editMilestone",
    "removeMilestone",
    "completeMilestone",
    "reopenMilestone",
    "complete",
    "reopen",
    "listActive",
  ]) {
    test(`has no ${verb}()`, () => {
      assert.ok(!surface.has(verb), `an area must not be able to ${verb}`);
    });
  }

  test("cannot be marked done through any status verb", async () => {
    const { areas } = service();
    // @ts-expect-error `done` is not an AreaStatus — this is the point.
    const outcome = await areas.setStatus("home-maintenance", "active", "done");
    assert.equal(outcome.ok, false);
  });
});
