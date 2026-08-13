import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseProject } from "../src/projects/document";
import { COMPLETED, GNARLY, STRUCTURED } from "./project-fixtures";

/**
 * Preamble `key: value` lines — the four fields this feature owns, beside the
 * one Feature 2 already wrote.
 *
 * The file belongs to the user, not to the app: an unknown key is something
 * they typed, and it survives untouched (FR-045).
 */

describe("preamble parsing", () => {
  test("reads status, next action, and dri", () => {
    const p = parseProject(STRUCTURED, "roof-repair");
    assert.equal(p.status, "active");
    assert.equal(p.nextAction, "Call the roofer back for a revised estimate");
    assert.equal(p.dri, "me");
  });

  test("reads a completion date", () => {
    const p = parseProject(COMPLETED, "fix-the-fence");
    assert.equal(p.status, "done");
    assert.equal(p.completedOn, "2026-03-14");
  });

  test("reads each of the four statuses", () => {
    for (const status of ["active", "parked", "waiting", "done"] as const) {
      const p = parseProject(`# T\n\nstatus: ${status}\n`, "t");
      assert.equal(p.status, status);
    }
  });

  test("matches keys case-insensitively and ignores surrounding whitespace", () => {
    const p = parseProject("# T\n\n  STATUS :  parked  \n  DRI:  Sam  \n", "t");
    assert.equal(p.status, "parked");
    assert.equal(p.dri, "Sam");
  });

  test("an unrecognized status reads as active without being rewritten", () => {
    // A typo in a text editor must not lock the user out of their own project.
    const p = parseProject("# T\n\nstatus: activ\n", "t");
    assert.equal(p.status, "active");
  });

  test("a key with an empty value reads as not set", () => {
    const p = parseProject("# T\n\nstatus: active\ndri:\n", "t");
    assert.equal(p.dri, null);
  });

  test("an unknown key is ignored by the reader and does not disturb the known ones", () => {
    const p = parseProject(GNARLY, "q3-planning-review");
    assert.equal(p.status, "waiting");
    assert.equal(p.nextAction, "Chase Dana for the headcount numbers");
    assert.equal(p.dri, null);
  });

  test("a value containing a colon is kept whole", () => {
    const p = parseProject("# T\n\nnext action: Email Dana: ask about Q3\n", "t");
    assert.equal(p.nextAction, "Email Dana: ask about Q3");
  });

  test("a key-looking line inside a section is not read as a preamble field", () => {
    // The preamble ends at the first `##`. A sentence in the outcome that
    // happens to contain a colon is prose, not metadata.
    const p = parseProject("# T\n\nstatus: active\n\n## Outcome\n\ndri: not really\n", "t");
    assert.equal(p.dri, null);
    assert.equal(p.outcome, "dri: not really");
  });

  test("the title is kept verbatim, including double spaces and markdown", () => {
    const p = parseProject(GNARLY, "q3");
    assert.equal(p.title, "Q3  Planning & Review");
  });
});
