import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDocument, renderDocument } from "../src/projects/document";
import { ALL_PROJECT_FIXTURES } from "./project-fixtures";

/**
 * THE GATE.
 *
 * Parsing a project file and rendering it back with no edit must reproduce the
 * input byte for byte. The vault is git-tracked and hand-edited, so a read that
 * reformats turns every app open into a diff and the user stops trusting
 * `git status` to mean anything (FR-044, FR-045, SC-002, SC-014, research R3).
 *
 * Every service verb writes through this renderer. If this is red, every later
 * byte-preservation test fails for a reason that has nothing to do with the
 * verb under test.
 */

describe("document round-trip is byte-identical", () => {
  for (const [name, content] of ALL_PROJECT_FIXTURES) {
    test(name, () => {
      assert.equal(renderDocument(parseDocument(content)), content);
    });
  }

  describe("shapes that tempt a parser to normalize", () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      ["no trailing newline", "# T\n\nstatus: active"],
      ["several trailing newlines", "# T\n\nstatus: active\n\n\n\n"],
      ["leading blank lines", "\n\n# T\n\nstatus: active\n"],
      ["windows line endings", "# T\r\n\r\nstatus: active\r\n"],
      ["tabs in the preamble", "# T\n\nstatus:\tactive\n"],
      ["trailing spaces on a line", "# T   \n\nstatus: active   \n"],
      ["no blank line after the title", "# T\nstatus: active\n"],
      ["a section with no body", "# T\n\nstatus: active\n\n## Outcome\n"],
      ["duplicate headings", "# T\n\n## Outcome\n\nOne\n\n## Outcome\n\nTwo\n"],
      ["a second h1", "# T\n\nstatus: active\n\n# Another\n"],
      ["only whitespace", "   \n\n  \n"],
      ["a single newline", "\n"],
      ["emoji at a line boundary", "# 🎉\n\nstatus: active\n"],
    ];

    for (const [name, content] of CASES) {
      test(name, () => {
        assert.equal(renderDocument(parseDocument(content)), content);
      });
    }
  });

  test("round-tripping twice is still identical", () => {
    for (const [, content] of ALL_PROJECT_FIXTURES) {
      const once = renderDocument(parseDocument(content));
      assert.equal(renderDocument(parseDocument(once)), content);
    }
  });
});
