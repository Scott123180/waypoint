import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseProject } from "../src/projects/document";
import { renderStub } from "../src/vault/stub";
import { STUB, STUB_WITH_UNPROCESSED, TITLE_ONLY } from "./project-fixtures";

/**
 * A stub is a project.
 *
 * Feature 2 shipped title-and-status files into vaults months before this
 * feature existed. They are not a degraded state to be migrated — they are this
 * format with every optional part absent (FR-004, FR-005).
 */

describe("parseProject on a Feature 2 stub", () => {
  test("reads the title and status and nothing else", () => {
    const p = parseProject(STUB, "roof-repair");
    assert.equal(p.slug, "roof-repair");
    assert.equal(p.title, "Roof repair");
    assert.equal(p.status, "active");
  });

  test("reports the absent fields as null, not as empty strings", () => {
    // One representation for absent, so "not set" and "set to nothing" cannot
    // drift apart downstream.
    const p = parseProject(STUB, "roof-repair");
    assert.equal(p.outcome, null);
    assert.equal(p.nextAction, null);
    assert.equal(p.dri, null);
    assert.equal(p.completedOn, null);
  });

  test("reports empty milestone and unprocessed lists rather than throwing", () => {
    const p = parseProject(STUB, "roof-repair");
    assert.deepEqual(p.milestones, []);
    assert.deepEqual(p.unprocessed, []);
  });

  test("whatever renderStub writes today parses as a valid project", () => {
    // Binds the two features together: if Feature 2's stub ever changes shape,
    // this fails rather than silently producing an unreadable project.
    const p = parseProject(renderStub("Anything at all"), "anything-at-all");
    assert.equal(p.title, "Anything at all");
    assert.equal(p.status, "active");
    assert.equal(p.outcome, null);
  });

  test("a stub carrying routed items reads both the stub and the items", () => {
    const p = parseProject(STUB_WITH_UNPROCESSED, "roof-repair");
    assert.equal(p.outcome, null);
    assert.equal(p.unprocessed.length, 3);
    assert.equal(p.unprocessed[0]?.text, "Call the roofer back about the estimate");
    assert.equal(p.unprocessed[1]?.text, "Buy a tarp before it rains");
  });

  test("a hand-written unprocessed item keeps a null timestamp rather than a substituted one", () => {
    const p = parseProject(STUB_WITH_UNPROCESSED, "roof-repair");
    assert.equal(p.unprocessed[1]?.capturedAt, null);
    assert.ok(p.unprocessed[0]?.capturedAt instanceof Date);
  });

  test("a file with only a title reads as active", () => {
    // No status line at all is a hand-edit, not a corruption.
    const p = parseProject(TITLE_ONLY, "bare");
    assert.equal(p.title, "Bare");
    assert.equal(p.status, "active");
  });

  test("an empty file does not throw", () => {
    const p = parseProject("", "ghost");
    assert.equal(p.title, "");
    assert.equal(p.status, "active");
  });
});
