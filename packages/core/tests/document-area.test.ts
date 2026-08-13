import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseArea } from "../src/projects/document";
import { AREA, AREA_HAND_MANGLED, STRUCTURED } from "./project-fixtures";

/**
 * An area is a title and a status. The absences are the design (FR-040).
 */

describe("parseArea", () => {
  test("reads a title and a status", () => {
    const a = parseArea(AREA, "home-maintenance");
    assert.equal(a.title, "Home maintenance");
    assert.equal(a.status, "active");
    assert.equal(a.rawStatus, "active");
  });

  test("reads routed items, because sort routes into areas too", () => {
    const a = parseArea(AREA, "home-maintenance");
    assert.equal(a.unprocessed.length, 1);
    assert.match(a.unprocessed[0]?.text ?? "", /Gutters need clearing/);
  });

  test("exposes no outcome, milestones, next action, DRI, or completion", () => {
    // Not "returns null for them" — the fields do not exist on the type. This
    // asserts the runtime shape matches, so a future refactor cannot quietly
    // widen an area into a project.
    const a = parseArea(STRUCTURED, "pretending");
    assert.deepEqual(Object.keys(a).sort(), ["rawStatus", "slug", "status", "title", "unprocessed"]);
  });

  describe("a hand-edited status outside the area range", () => {
    test("keeps `done` visible as recorded rather than coercing it", () => {
      const a = parseArea(AREA_HAND_MANGLED, "home-maintenance");
      assert.equal(a.rawStatus, "done", "what the file says must remain visible");
    });

    test("resolves the usable status to active, so the area still works", () => {
      const a = parseArea(AREA_HAND_MANGLED, "home-maintenance");
      assert.equal(a.status, "active");
    });

    test("does the same for `waiting`", () => {
      const a = parseArea("# A\n\nstatus: waiting\n", "a");
      assert.equal(a.rawStatus, "waiting");
      assert.equal(a.status, "active");
    });

    test("parked is a real area status and is kept", () => {
      const a = parseArea("# A\n\nstatus: parked\n", "a");
      assert.equal(a.status, "parked");
      assert.equal(a.rawStatus, "parked");
    });
  });

  test("a hand-added Milestones section does not make it a project", () => {
    // The content is preserved by the round-trip; the area simply has no
    // concept that would read it (FR-043).
    const a = parseArea(AREA_HAND_MANGLED, "home-maintenance");
    assert.equal(a.title, "Home maintenance");
    assert.ok(!("milestones" in a));
  });
});
