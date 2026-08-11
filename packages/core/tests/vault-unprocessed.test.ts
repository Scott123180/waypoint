import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { insertUnprocessed } from "../src/vault/unprocessed";

/**
 * Insertion under `## Unprocessed`, preserving every other byte.
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */

const ITEM = "- 2026-08-09T14:23:05-04:00 Call the roofer";

describe("insertUnprocessed", () => {
  test("appends under an existing section", () => {
    const before = "# Roof repair\n\nstatus: active\n\n## Unprocessed\n\n- earlier item\n";
    const after = insertUnprocessed(before, ITEM);

    assert.equal(
      after,
      "# Roof repair\n\nstatus: active\n\n## Unprocessed\n\n- earlier item\n" + ITEM + "\n",
    );
  });

  test("creates the section when absent, leaving everything above untouched", () => {
    const before = "# Roof repair\n\nstatus: active\n";
    const after = insertUnprocessed(before, ITEM);

    assert.ok(after.startsWith(before), "existing content must be a prefix of the result");
    assert.match(after, /## Unprocessed\n\n- 2026-08-09T14:23:05-04:00 Call the roofer\n$/);
  });

  test("inserts at the end of the section, not the end of the file", () => {
    const before =
      "# Roof repair\n\n## Unprocessed\n\n- earlier\n\n## Milestones\n\n- ship it\n";
    const after = insertUnprocessed(before, ITEM);

    const unprocessedIdx = after.indexOf("## Unprocessed");
    const itemIdx = after.indexOf(ITEM);
    const milestonesIdx = after.indexOf("## Milestones");

    assert.ok(unprocessedIdx < itemIdx, "item must be after the heading");
    assert.ok(itemIdx < milestonesIdx, "item must be before the next section");
    assert.match(after, /## Milestones\n\n- ship it\n$/);
  });

  test("leaves Feature 3 structure byte-for-byte intact", () => {
    const before =
      "# Roof repair\n\n" +
      "status: active\n\n" +
      "## Outcome\n\nThe roof stops leaking.\n\n" +
      "## Milestones\n\n- [ ] get three quotes\n- [ ] pick one\n\n" +
      "## Next action\n\nCall the roofer.\n\n" +
      "## DRI\n\nAlice\n\n" +
      "## Unprocessed\n\n- earlier\n";
    const after = insertUnprocessed(before, ITEM);

    // Everything except the one added line survives exactly.
    assert.equal(after.replace(ITEM + "\n", ""), before);
  });

  test("does not mistake a deeper heading for the section", () => {
    const before = "# P\n\n## Notes\n\n### Unprocessed\n\n- not the target\n";
    const after = insertUnprocessed(before, ITEM);

    // The `###` is not our section, so a real `## Unprocessed` is appended.
    assert.match(after, /\n## Unprocessed\n/);
    assert.ok(after.includes("### Unprocessed\n\n- not the target\n"));
  });

  test("handles a file with no trailing newline", () => {
    const before = "# Roof repair\n\nstatus: active";
    const after = insertUnprocessed(before, ITEM);

    assert.ok(after.startsWith("# Roof repair\n\nstatus: active\n"));
    assert.ok(after.endsWith(ITEM + "\n"));
  });

  test("handles an empty file", () => {
    const after = insertUnprocessed("", ITEM);
    assert.equal(after, "## Unprocessed\n\n" + ITEM + "\n");
  });

  test("handles a section that is the last thing in the file with no items", () => {
    const before = "# P\n\n## Unprocessed\n";
    const after = insertUnprocessed(before, ITEM);

    assert.equal(after, "# P\n\n## Unprocessed\n" + ITEM + "\n");
  });

  test("two insertions land in arrival order", () => {
    const once = insertUnprocessed("# P\n", "- first");
    const twice = insertUnprocessed(once, "- second");

    assert.ok(twice.indexOf("- first") < twice.indexOf("- second"));
  });

  test("preserves trailing blank lines inside the section", () => {
    const before = "# P\n\n## Unprocessed\n\n- earlier\n\n\n## Later\n\ncontent\n";
    const after = insertUnprocessed(before, ITEM);

    assert.match(after, /## Later\n\ncontent\n$/);
    assert.ok(after.indexOf(ITEM) < after.indexOf("## Later"));
  });

  test("a multi-line item keeps its continuation indentation", () => {
    const item = "- 2026-08-09T14:23:05-04:00 first\n  second";
    const after = insertUnprocessed("# P\n", item);

    assert.ok(after.includes("- 2026-08-09T14:23:05-04:00 first\n  second\n"));
  });
});
