import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseProject } from "../src/projects/document";
import { GNARLY, SIX_MILESTONES, STRUCTURED, UTF8 } from "./project-fixtures";

/**
 * `## Outcome`, `## Milestones`, `## Unprocessed` — and everything else the
 * user put in the file, which is none of this feature's business (FR-045).
 */

describe("section parsing", () => {
  test("reads the outcome as prose", () => {
    const p = parseProject(STRUCTURED, "roof-repair");
    assert.equal(
      p.outcome,
      "The roof survives a full winter with no leak, and the insurance claim is settled.",
    );
  });

  test("preserves a multi-paragraph outcome verbatim, blank line and all", () => {
    const p = parseProject(GNARLY, "q3");
    assert.equal(
      p.outcome,
      "Everyone knows what they own for Q3.\n\nTwo paragraphs, because the outcome needed one.",
    );
  });

  test("a whitespace-only outcome section reads as not set", () => {
    // An empty heading is not an outcome. Reporting it as set would clear the
    // structure flag on a project that still has nothing to aim at.
    const p = parseProject("# T\n\nstatus: active\n\n## Outcome\n\n   \n\n", "t");
    assert.equal(p.outcome, null);
  });

  test("reads milestones in file order with their fields", () => {
    const p = parseProject(STRUCTURED, "roof-repair");
    assert.equal(p.milestones.length, 3);
    assert.deepEqual(
      p.milestones.map((m) => m.index),
      [0, 1, 2],
    );
    assert.equal(p.milestones[0]?.done, true);
    assert.equal(p.milestones[0]?.completedOn, "2026-08-14");
    assert.equal(p.milestones[1]?.verifier, "me");
    assert.equal(p.milestones[2]?.done, false);
  });

  test("each milestone carries its own source line for later verification", () => {
    const p = parseProject(STRUCTURED, "roof-repair");
    assert.equal(p.milestones[1]?.raw, "- [ ] Materials delivered on site — @me");
  });

  test("sections in an unexpected order are all found", () => {
    // GNARLY puts Milestones above Outcome. Nothing depends on the order.
    const p = parseProject(GNARLY, "q3");
    assert.ok(p.outcome);
    assert.equal(p.milestones.length, 3);
    assert.equal(p.unprocessed.length, 2);
  });

  test("an unknown section is ignored rather than misread", () => {
    const p = parseProject(GNARLY, "q3");
    assert.doesNotMatch(p.outcome ?? "", /Something the user typed/);
  });

  test("a task-list line under Unprocessed is not a milestone", () => {
    // Only the Milestones section holds milestones. A routed item that happens
    // to look like one stays a routed item.
    const p = parseProject(GNARLY, "q3");
    assert.equal(p.milestones.length, 3);
    assert.ok(
      p.unprocessed.some((u) => u.text.includes("looks like a milestone")),
      "the task-list line under Unprocessed should be a routed item",
    );
  });

  test("a multi-line unprocessed item is one item", () => {
    const p = parseProject(GNARLY, "q3");
    assert.equal(p.unprocessed[0]?.text, "A routed item\nwith a continuation line");
  });

  test("more than four hand-written milestones are all read", () => {
    // Parsing imposes no cap; only adding through the app does (FR-013b).
    const p = parseProject(SIX_MILESTONES, "overcommitted");
    assert.equal(p.milestones.length, 6);
    assert.equal(p.milestones[5]?.definitionOfDone, "Six");
  });

  test("multi-byte content survives parsing", () => {
    const p = parseProject(UTF8, "cafe");
    assert.equal(p.title, "Café — naïve 日本語 🎉");
    assert.equal(p.dri, "José");
    assert.equal(p.milestones[0]?.verifier, "René");
    assert.match(p.outcome ?? "", /🚀/);
  });

  test("a `###` sub-heading does not end a section", () => {
    const content = "# T\n\nstatus: active\n\n## Outcome\n\nBefore.\n\n### Detail\n\nAfter.\n";
    const p = parseProject(content, "t");
    assert.match(p.outcome ?? "", /### Detail/);
    assert.match(p.outcome ?? "", /After\./);
  });
});
