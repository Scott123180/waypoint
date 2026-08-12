import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderStub } from "../src/vault/stub";

/**
 * A destination created mid-sort is a stub: title and status, nothing else.
 * Feature 3 adds outcome, milestones, next action, and DRI alongside — this
 * feature must not pre-write empty versions of them (FR-009).
 */

describe("renderStub", () => {
  test("holds the title and a status, and nothing else", () => {
    assert.equal(renderStub("Roof repair"), "# Roof repair\n\nstatus: active\n");
  });

  test("does not pre-create an empty Unprocessed section", () => {
    // The first routed item creates it, with correct spacing. An empty heading
    // would be structure the user never asked for.
    assert.doesNotMatch(renderStub("Roof repair"), /## Unprocessed/);
  });

  test("keeps the title verbatim, not the slug", () => {
    // The slug is for the filename; the heading is for the human.
    assert.match(renderStub("Q3  Planning & Review"), /^# Q3 {2}Planning & Review$/m);
  });

  test("trims surrounding whitespace from the title", () => {
    assert.match(renderStub("  Roof repair  "), /^# Roof repair$/m);
  });

  test("writes no outcome, milestone, next-action, or DRI field", () => {
    // Not even empty ones: they would be metadata the user has to maintain
    // before Feature 3 gives them meaning.
    const stub = renderStub("Anything");
    for (const field of ["outcome", "milestone", "next action", "DRI", "owner", "due"]) {
      assert.doesNotMatch(stub, new RegExp(field, "i"), `stub must not mention ${field}`);
    }
  });

  test("ends with a trailing newline", () => {
    assert.ok(renderStub("X").endsWith("\n"));
  });

  test("a title containing markdown is not escaped or mangled", () => {
    assert.match(renderStub("**bold** project"), /^# \*\*bold\*\* project$/m);
  });
});
