import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseLedgerLine, renderLedgerLine } from "../src/projects/ledger";
import { LEDGER_HEADING, appendLedgerLine, parseProject } from "../src/projects/document";
import { STRUCTURED, STUB } from "./project-fixtures";

/**
 * The ledger's grammar, read and written.
 *
 * The same two rules that govern every other document here: parsing never
 * fails, and writing is surgical. A ledger is the one section where that
 * matters most, because it is append-only by contract — an entry the system
 * cannot parse is still an entry the user wrote, and rewriting it would be the
 * system editing history.
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

describe("a ledger line", () => {
  test("reads the shape the contract defines", () => {
    const entry = parseLedgerLine("- 2026-08-01 status active → waiting — after 18d active");

    assert.deepEqual(entry, {
      on: "2026-08-01",
      action: "status",
      detail: "active → waiting",
      afterDays: 18,
      afterState: "active",
      raw: "- 2026-08-01 status active → waiting — after 18d active",
    });
  });

  test("the duration tail is optional — the ledger says nothing it does not know", () => {
    const entry = parseLedgerLine("- 2026-06-02 status active → waiting");

    assert.equal(entry?.detail, "active → waiting");
    assert.equal(entry?.afterDays, null);
    assert.equal(entry?.afterState, null);
  });

  test("renders back to exactly what it was parsed from", () => {
    for (const line of [
      "- 2026-08-01 status active → waiting — after 18d active",
      "- 2026-06-02 status active → waiting",
      "- 2026-07-14 status waiting → active — after 42d waiting",
    ]) {
      const entry = parseLedgerLine(line);
      assert.ok(entry);
      assert.equal(renderLedgerLine(entry), line);
    }
  });

  test("a verb this feature never writes still parses", () => {
    // The shape has to generalise, or a later record type carrying a ledger
    // would change what a project's ledger means (FR-096).
    const entry = parseLedgerLine("- 2026-08-15 milestone done Ship the runbook");

    assert.equal(entry?.action, "milestone");
    assert.equal(entry?.detail, "done Ship the runbook");
  });

  test("a line matching no grammar is not an entry", () => {
    for (const line of ["", "  ", "- not a date at all", "## Ledger", "- 2026-13-99 status a → b"]) {
      assert.equal(parseLedgerLine(line), null, `"${line}" is not an entry`);
    }
  });
});

describe("the ledger section", () => {
  test("is created above Unprocessed, so raw material stays below structure", () => {
    const after = appendLedgerLine(STRUCTURED, "- 2026-08-14 status active → parked");
    const lines = after.split("\n");

    const ledger = lines.indexOf(`## ${LEDGER_HEADING}`);
    const unprocessed = lines.indexOf("## Unprocessed");
    assert.ok(ledger > -1, "the section is created on first use");
    assert.ok(ledger < unprocessed, "the ledger sits above the unprocessed items");
  });

  test("appends land at the end, oldest first", () => {
    let content = STUB;
    content = appendLedgerLine(content, "- 2026-06-02 status active → waiting");
    content = appendLedgerLine(content, "- 2026-07-14 status waiting → active — after 42d waiting");
    content = appendLedgerLine(content, "- 2026-08-01 status active → waiting — after 18d active");

    const entries = parseProject(content, "p").ledger;
    assert.deepEqual(
      entries.map((e) => e.on),
      ["2026-06-02", "2026-07-14", "2026-08-01"],
      "file order is chronological by construction and is never re-sorted",
    );
  });

  test("appending adds exactly one line and moves nothing", () => {
    const first = appendLedgerLine(STRUCTURED, "- 2026-06-02 status active → waiting");
    const second = appendLedgerLine(first, "- 2026-07-14 status waiting → active");

    const added = "- 2026-07-14 status waiting → active";
    const secondLines = second.split("\n");

    assert.equal(secondLines.length, first.split("\n").length + 1, "one line, not a reflow");
    assert.deepEqual(
      secondLines.filter((l) => l !== added),
      first.split("\n"),
      "every other line is where it was, byte for byte",
    );
    assert.equal(second.split("- 2026-06-02 status active → waiting").length - 1, 1);
  });

  test("a hand-written entry is parsed and preserved verbatim", () => {
    const handWritten = `# Migration cutover

status: waiting

## Ledger

- 2026-05-01 status active → waiting    (I think? going from memory)
`;

    const project = parseProject(handWritten, "migration-cutover");
    const entry = project.ledger[0];
    assert.equal(entry?.detail, "active → waiting    (I think? going from memory)");
    assert.equal(entry?.raw, "- 2026-05-01 status active → waiting    (I think? going from memory)");

    // And a later append does not touch it.
    const after = appendLedgerLine(handWritten, "- 2026-08-14 status waiting → active");
    assert.match(after, /- 2026-05-01 status active → waiting {4}\(I think\? going from memory\)/);
  });

  test("a malformed line is carried through and ignored, never dropped", () => {
    const content = `# P

status: active

## Ledger

- 2026-06-02 status active → waiting
this line is not a list item at all
- and this one has no date

## Unprocessed
`;

    const project = parseProject(content, "p");
    assert.equal(project.ledger.length, 1, "only the well-formed line is an entry");

    const after = appendLedgerLine(content, "- 2026-08-14 status waiting → done");
    assert.match(after, /^this line is not a list item at all$/m);
    assert.match(after, /^- and this one has no date$/m);
  });

  test("a project with no ledger reads as having none", () => {
    assert.deepEqual(parseProject(STUB, "p").ledger, []);
  });
});
