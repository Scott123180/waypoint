import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { FixedClock, seedVault } from "./project-fakes";
import { AREA } from "./project-fixtures";

/**
 * Sort routes items into areas as well as projects, so an area's `## Unprocessed`
 * items must be readable and dismissable on the same terms (FR-046a, FR-046b,
 * FR-046d, FR-046e).
 *
 * Without this, anything sorted into an area would pile up with nothing able to
 * clear it — the loop this feature exists to close would stay open on half the
 * destinations.
 */

const path = "areas/home-maintenance.md";

const TWO_ITEMS = `# Home maintenance

status: active

## Unprocessed

- 2026-08-11T14:02:55-04:00 Gutters need clearing before autumn
- Book the boiler service
`;

function service(content = TWO_ITEMS) {
  const vault = seedVault({ [path]: content });
  return { vault, areas: new AreaService({ vault, clock: new FixedClock() }) };
}

describe("reading", () => {
  test("returns the routed items in order", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    assert.equal(a?.unprocessed.length, 2);
    assert.equal(a?.unprocessed[0]?.text, "Gutters need clearing before autumn");
    assert.equal(a?.unprocessed[1]?.text, "Book the boiler service");
  });

  test("keeps a capture timestamp, and leaves a hand-written one null", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    assert.ok(a?.unprocessed[0]?.capturedAt instanceof Date);
    assert.equal(a?.unprocessed[1]?.capturedAt, null);
  });

  test("an area with no Unprocessed section reports none", async () => {
    const { areas } = service("# Home maintenance\n\nstatus: active\n");
    const a = await areas.get("home-maintenance");
    assert.deepEqual(a?.unprocessed, []);
  });
});

describe("dismissUnprocessed", () => {
  test("removes the item and keeps the other", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    const item = a?.unprocessed[0];
    assert.ok(item);

    const outcome = await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
    assert.ok(outcome.ok);
    assert.equal(outcome.area.unprocessed.length, 1);
    assert.equal(outcome.area.unprocessed[0]?.text, "Book the boiler service");
  });

  test("appends it to trash.md with its text and capture timestamp", async () => {
    const { vault, areas } = service();
    const a = await areas.get("home-maintenance");
    const item = a?.unprocessed[0];
    assert.ok(item);

    await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
    const trash = vault.files.get("trash.md") ?? "";
    assert.match(trash, /Gutters need clearing before autumn/);
    assert.match(trash, /2026-08-11T14:02:55-04:00/);
  });

  test("writes to trash before removing from the area", async () => {
    const { vault, areas } = service();
    const a = await areas.get("home-maintenance");
    const item = a?.unprocessed[0];
    assert.ok(item);

    await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
    assert.deepEqual(vault.writeLog, ["trash.md", path]);
  });

  test("emptying the section is not an error", async () => {
    const { areas } = service();
    for (let i = 0; i < 2; i++) {
      const a = await areas.get("home-maintenance");
      const item = a?.unprocessed[0];
      assert.ok(item);
      const outcome = await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
      assert.ok(outcome.ok);
    }
    const a = await areas.get("home-maintenance");
    assert.deepEqual(a?.unprocessed, []);
  });

  test("an item changed on disk refuses and writes nothing, not even to trash", async () => {
    const { vault, areas } = service();
    const a = await areas.get("home-maintenance");
    const item = a?.unprocessed[1];
    assert.ok(item);
    vault.files.set(path, (vault.files.get(path) ?? "").replace("boiler", "furnace"));
    vault.writeLog.length = 0;

    const outcome = await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
    assert.deepEqual(vault.writeLog, []);
  });

  test("dismissing does not give the area any structure", async () => {
    const { areas } = service();
    const a = await areas.get("home-maintenance");
    const item = a?.unprocessed[0];
    assert.ok(item);

    const outcome = await areas.dismissUnprocessed("home-maintenance", item.index, item.raw);
    assert.ok(outcome.ok);
    assert.deepEqual(Object.keys(outcome.area).sort(), [
      "rawStatus",
      "slug",
      "status",
      "title",
      "unprocessed",
    ]);
  });
});
