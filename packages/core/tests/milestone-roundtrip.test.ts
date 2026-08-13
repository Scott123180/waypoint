import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseMilestone, renderMilestone } from "../src/projects/milestone";

/**
 * `render(parse(line)) === line`.
 *
 * The property that lets a milestone be edited without disturbing the ones
 * around it: if rendering a parsed line reproduced anything but the original,
 * every write would rewrite lines it was not asked to touch (FR-045).
 */

const LINES = [
  "- [ ] Materials delivered on site — @me",
  "- [x] Estimate approved by insurer — @Priya — done 2026-08-14",
  "- [ ] No verifier on this one",
  "- [x] Book the room — done 2026-07-02",
  "- [ ] Draft the plan — decide budget vs — headcount — @dana@example.com",
  "- [ ] Email finance@example.com about the budget",
  "- [ ] Ask @dana — @sam",
  "- [ ] Trailing at sign — @",
  "- [x] Ship it — done soon",
  "- [ ] Half-edited — done 2026-01-01",
  "- [ ] Café — naïve 日本語 🎉 — @René",
  "- [ ] **bold** and `code` and [a link](http://example.com)",
  "- [ ] Ends with punctuation!",
  "- [ ] 100% — no, really — @qa",
];

describe("milestone round-trip", () => {
  for (const line of LINES) {
    test(`reproduces exactly: ${line}`, () => {
      const parsed = parseMilestone(line);
      assert.ok(parsed, "fixture should parse");
      assert.equal(renderMilestone(parsed), line);
    });
  }

  test("an uppercase X normalizes to lowercase, which is the one accepted change", () => {
    // Both render as `[x]`. This is the single normalization in the format, and
    // it only happens to a line the user is already editing through the app.
    const parsed = parseMilestone("- [X] Done by hand");
    assert.ok(parsed);
    assert.equal(renderMilestone(parsed), "- [x] Done by hand");
  });
});
