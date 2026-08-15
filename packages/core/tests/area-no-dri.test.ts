import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AreaService } from "../src/projects/area-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * An area carries no DRI, and therefore no resolution and no needs-a-DRI
 * signal (FR-037).
 *
 * Mirrors Feature 3's `area-never-flagged.test.ts`, and for the same reason:
 * an area is an ongoing responsibility with no end state, so "who is driving
 * this to completion" is a question that does not apply. Structurally
 * incapable, not merely validated against.
 */

describe("areas have no DRI", () => {
  test("an area summary carries neither a resolution nor a needs-a-DRI flag", async () => {
    const vault = seedVault({
      "areas/home.md": "# Home\n\nstatus: active\n",
      "identity.md": "me: Scott Rodgers\n",
    });
    const [summary] = await new AreaService({ vault, clock: new FixedClock() }).list();

    assert.ok(summary);
    assert.ok(!("dri" in summary), "an area has nowhere to put a DRI");
    assert.ok(!("needsDri" in summary), "and so cannot need one");
  });

  test("a hand-written dri: line in an area file is not read as a DRI", async () => {
    const vault = seedVault({
      "areas/home.md": ["# Home", "", "status: active", "dri: Scott Rodgers", ""].join("\n"),
      "identity.md": "me: Scott Rodgers\n",
    });
    const area = await new AreaService({ vault, clock: new FixedClock() }).get("home");

    assert.ok(area);
    assert.ok(!("dri" in area), "the field does not exist on an area, whatever the file says");
  });

  test("the line is preserved rather than stripped", async () => {
    // Parsing never fails and never tidies. An unknown preamble key survives.
    const content = ["# Home", "", "status: active", "dri: Scott Rodgers", ""].join("\n");
    const vault = seedVault({ "areas/home.md": content });
    const areas = new AreaService({ vault, clock: new FixedClock() });

    await areas.setTitle("home", "Home", "Household");

    assert.match(vault.files.get("areas/home.md") ?? "", /dri: Scott Rodgers/);
  });

  test("no area verb offers a DRI", () => {
    const verbs = Object.getOwnPropertyNames(AreaService.prototype);
    const offender = verbs.find((v) => /dri/i.test(v));
    assert.equal(offender, undefined, `${offender} would give an area an owner it cannot have`);
  });
});
