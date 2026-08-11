import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";

/**
 * The parser reads a file the user is expected to hand-edit, so it has no
 * "invalid input" category: every line with text is routable (FR-027).
 * See specs/002-inbox-view-sort/contracts/inbox-parse.md
 */

describe("parseInbox classification", () => {
  test("reads a captured item with its timestamp", () => {
    const items = parseInbox("- 2026-08-09T14:23:05-04:00 Call the roofer back\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "Call the roofer back");
    assert.equal(items[0]?.capturedAt?.toISOString(), new Date("2026-08-09T14:23:05-04:00").toISOString());
  });

  test("a hand-written line is an item with no timestamp", () => {
    const items = parseInbox("Buy milk\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "Buy milk");
    assert.equal(items[0]?.capturedAt, null);
  });

  test("a markdown heading is an item, not structure to skip", () => {
    // The user chose this: a heading they typed is still text to decide about
    // (clarify Q2), and sort cannot tell it apart from a thought.
    const items = parseInbox("## Someday\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "## Someday");
    assert.equal(items[0]?.capturedAt, null);
  });

  test("a list line without a valid timestamp is hand-written", () => {
    const items = parseInbox("- not a timestamp here\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "- not a timestamp here");
    assert.equal(items[0]?.capturedAt, null);
  });

  test("a malformed date is hand-written rather than an error", () => {
    const items = parseInbox("- 2026-13-45T99:99:99-04:00 nonsense date\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.capturedAt, null);
    assert.equal(items[0]?.text, "- 2026-13-45T99:99:99-04:00 nonsense date");
  });

  test("two-space indented lines continue the item above", () => {
    const items = parseInbox(
      "- 2026-08-09T14:31:12-04:00 Ask Priya whether the window moved,\n" +
        "  and tell the on-call rotation before Friday.\n",
    );

    assert.equal(items.length, 1);
    assert.equal(
      items[0]?.text,
      "Ask Priya whether the window moved,\nand tell the on-call rotation before Friday.",
    );
  });

  test("an indented line with no item above it is its own item", () => {
    // A hand-edited file can legitimately start indented.
    const items = parseInbox("  orphaned indent\n");

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "orphaned indent");
    assert.equal(items[0]?.capturedAt, null);
  });

  test("blank lines are not items and belong to no item", () => {
    const items = parseInbox("- 2026-08-09T14:23:05-04:00 First\n\n\nSecond\n");

    assert.equal(items.length, 2);
    assert.equal(items[0]?.text, "First");
    assert.equal(items[1]?.text, "Second");
  });

  test("whitespace-only lines are not items", () => {
    const items = parseInbox("   \n\t\n");
    assert.equal(items.length, 0);
  });

  test("an empty file yields no items", () => {
    assert.equal(parseInbox("").length, 0);
  });

  test("a blank line followed by unindented text ends the item", () => {
    const items = parseInbox("- 2026-08-09T14:23:05-04:00 First\n\nnot a continuation\n");

    assert.equal(items.length, 2);
    assert.equal(items[0]?.text, "First");
    assert.equal(items[1]?.text, "not a continuation");
  });

  test("a blank line followed by an indented line stays inside the item", () => {
    // This is what capture writes for a dictated thought with a paragraph
    // break (see serialize.ts). Splitting here would turn one thought into two
    // items and strip the timestamp off the second half.
    const items = parseInbox(
      "- 2026-08-09T14:23:05-04:00 First paragraph\n\n  Second paragraph\n",
    );

    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "First paragraph\n\nSecond paragraph");
    assert.equal(items[0]?.raw, "- 2026-08-09T14:23:05-04:00 First paragraph\n\n  Second paragraph\n");
  });

  test("items come back in file order, not timestamp order", () => {
    // A hand-edit can put them out of chronological order; the user sees their
    // file, so file order is what we present (FR-001).
    const items = parseInbox(
      "- 2026-08-09T15:00:00-04:00 Later\n- 2026-08-09T09:00:00-04:00 Earlier\n",
    );

    assert.deepEqual(items.map((i) => i.text), ["Later", "Earlier"]);
  });

  test("the worked example from the contract yields four items", () => {
    const items = parseInbox(
      "- 2026-08-11T09:14:02-04:00 Call the roofer back\n" +
        "Buy milk\n" +
        "- 2026-08-11T09:31:55-04:00 Ask Priya whether the migration window moved,\n" +
        "  and tell the on-call rotation before Friday.\n" +
        "\n" +
        "## Someday\n",
    );

    assert.equal(items.length, 4);
    assert.deepEqual(
      items.map((i) => [i.text, i.capturedAt === null]),
      [
        ["Call the roofer back", false],
        ["Buy milk", true],
        [
          "Ask Priya whether the migration window moved,\nand tell the on-call rotation before Friday.",
          false,
        ],
        ["## Someday", true],
      ],
    );
  });
});
