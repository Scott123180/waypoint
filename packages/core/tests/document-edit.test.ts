import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  setMilestoneLines,
  setPreambleField,
  setSectionBody,
  setTitleLine,
  setUnprocessedBlocks,
} from "../src/projects/document";
import { GNARLY, STRUCTURED, STUB, STUB_WITH_UNPROCESSED, TITLE_ONLY } from "./project-fixtures";

/**
 * Surgical edits: change the lines belonging to one field, reproduce every
 * other byte exactly (FR-045, FR-046, SC-003, research R3).
 *
 * The assertion that matters throughout is not "the new value is there" — it is
 * "nothing else moved".
 */

/** Everything except the lines matching `pattern` must be unchanged. */
function assertOnlyChanged(before: string, after: string, pattern: RegExp): void {
  const strip = (s: string): string =>
    s
      .split("\n")
      .filter((l) => !pattern.test(l))
      .join("\n");
  assert.equal(strip(after), strip(before), "lines outside the edited field changed");
}

describe("setPreambleField", () => {
  test("updates an existing key in place", () => {
    const after = setPreambleField(STRUCTURED, "status", "parked");
    assert.match(after, /^status: parked$/m);
    assertOnlyChanged(STRUCTURED, after, /^status:/);
  });

  test("adds a new key after the existing ones", () => {
    const after = setPreambleField(STUB, "next action", "Call the roofer");
    assert.equal(after, "# Roof repair\n\nstatus: active\nnext action: Call the roofer\n");
  });

  test("adds a key to a file that has no preamble at all", () => {
    assert.equal(setPreambleField(TITLE_ONLY, "status", "active"), "# Bare\n\nstatus: active\n");
  });

  test("removes a key when the value is null, leaving no blank line behind", () => {
    const after = setPreambleField(STRUCTURED, "dri", null);
    assert.doesNotMatch(after, /^dri:/m);
    assertOnlyChanged(STRUCTURED, after, /^dri:/);
  });

  test("removing a key that is not there changes nothing", () => {
    assert.equal(setPreambleField(STUB, "dri", null), STUB);
  });

  test("does not touch a key-looking line inside a section", () => {
    const content = "# T\n\nstatus: active\n\n## Outcome\n\ndri: not really\n";
    const after = setPreambleField(content, "dri", "Sam");
    assert.match(after, /^dri: Sam$/m);
    assert.match(after, /^dri: not really$/m, "the prose line must survive");
  });

  test("preserves an unknown key while editing a known one", () => {
    const after = setPreambleField(GNARLY, "status", "active");
    assert.match(after, /^priority: high$/m);
    assertOnlyChanged(GNARLY, after, /^status:/);
  });

  test("keeps a file with no trailing newline free of one", () => {
    assert.equal(setPreambleField("# T\n\nstatus: active", "dri", "me"), "# T\n\nstatus: active\ndri: me");
  });
});

describe("setSectionBody", () => {
  test("replaces an existing section body and nothing else", () => {
    const after = setSectionBody(STRUCTURED, "Outcome", "A different outcome.");
    assert.match(after, /^A different outcome\.$/m);
    assert.match(after, /^## Milestones$/m);
    assert.match(after, /^## Unprocessed$/m);
    assert.doesNotMatch(after, /survives a full winter/);
  });

  test("inserts a new section BEFORE Unprocessed, so raw material stays at the bottom", () => {
    const after = setSectionBody(STUB_WITH_UNPROCESSED, "Outcome", "The roof stops leaking.");
    assert.ok(
      after.indexOf("## Outcome") < after.indexOf("## Unprocessed"),
      "Outcome must precede Unprocessed",
    );
    assert.match(after, /Call the roofer back about the estimate/);
  });

  test("appends a new section at the end when there is no Unprocessed", () => {
    const after = setSectionBody(STUB, "Outcome", "Done means done.");
    assert.equal(after, "# Roof repair\n\nstatus: active\n\n## Outcome\n\nDone means done.\n");
  });

  test("removes a section when the body is null", () => {
    const after = setSectionBody(STRUCTURED, "Outcome", null);
    assert.doesNotMatch(after, /## Outcome/);
    assert.match(after, /^## Milestones$/m);
    assert.match(after, /^status: active$/m);
  });

  test("preserves a multi-paragraph body it was given", () => {
    const after = setSectionBody(STUB, "Outcome", "One.\n\nTwo.");
    assert.match(after, /One\.\n\nTwo\./);
  });

  test("leaves an unknown section untouched while editing a known one", () => {
    const after = setSectionBody(GNARLY, "Outcome", "Rewritten.");
    assert.match(after, /^## Notes$/m);
    assert.match(after, /Something the user typed/);
  });
});

describe("setMilestoneLines", () => {
  test("replaces the task-list lines and leaves the rest of the file alone", () => {
    const after = setMilestoneLines(STRUCTURED, [
      "- [x] Estimate approved by insurer — @Priya — done 2026-08-14",
      "- [ ] Materials delivered on site — @me",
    ]);
    assert.doesNotMatch(after, /Work signed off/);
    assert.match(after, /^## Outcome$/m);
    assert.match(after, /^## Unprocessed$/m);
    assert.match(after, /Call the roofer back about the estimate/);
  });

  test("adds a milestone to a project that has none, creating the section", () => {
    const after = setMilestoneLines(STUB, ["- [ ] First one"]);
    assert.match(after, /^## Milestones$/m);
    assert.match(after, /^- \[ \] First one$/m);
    assert.match(after, /^status: active$/m);
  });

  test("creates the Milestones section before Unprocessed", () => {
    const after = setMilestoneLines(STUB_WITH_UNPROCESSED, ["- [ ] First one"]);
    assert.ok(after.indexOf("## Milestones") < after.indexOf("## Unprocessed"));
  });

  test("does not disturb non-milestone content inside the Milestones section", () => {
    const content = "# T\n\n## Milestones\n\nA note the user wrote here.\n\n- [ ] One\n";
    const after = setMilestoneLines(content, ["- [ ] One", "- [ ] Two"]);
    assert.match(after, /A note the user wrote here\./);
    assert.match(after, /^- \[ \] Two$/m);
  });

  test("removing every milestone leaves the section rather than deleting the user's heading", () => {
    const after = setMilestoneLines(STRUCTURED, []);
    assert.doesNotMatch(after, /^- \[/m);
    assert.match(after, /^## Milestones$/m);
  });
});

describe("setTitleLine", () => {
  test("changes only the heading", () => {
    const after = setTitleLine(STRUCTURED, "Roof repair (phase two)");
    assert.match(after, /^# Roof repair \(phase two\)$/m);
    assertOnlyChanged(STRUCTURED, after, /^# /);
  });
});

describe("setUnprocessedBlocks", () => {
  test("removes one item and keeps the others in order", () => {
    const after = setUnprocessedBlocks(STUB_WITH_UNPROCESSED, [
      "- 2026-08-11T09:14:02-04:00 Call the roofer back about the estimate",
      "- 2026-08-11T09:20:00-04:00 Ask about the insurance claim",
    ]);
    assert.doesNotMatch(after, /Buy a tarp/);
    assert.ok(after.indexOf("Call the roofer") < after.indexOf("Ask about the insurance"));
    assert.match(after, /^status: active$/m);
  });

  test("emptying the section is not an error and leaves the heading", () => {
    const after = setUnprocessedBlocks(STUB_WITH_UNPROCESSED, []);
    assert.doesNotMatch(after, /Call the roofer/);
    assert.match(after, /^## Unprocessed$/m);
  });

  test("a multi-line item is removed whole, continuation lines included", () => {
    const after = setUnprocessedBlocks(GNARLY, [
      "- [ ] This looks like a milestone but lives under Unprocessed",
    ]);
    assert.doesNotMatch(after, /with a continuation line/);
    assert.doesNotMatch(after, /A routed item/);
    assert.match(after, /^## Notes$/m);
  });
});
