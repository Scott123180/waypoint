import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  appendAction,
  parseUnreadable,
  parseWaiting,
  renderActionLine,
} from "../src/waiting/waiting-document";

/**
 * `waiting.md`, read and written.
 *
 * Feature 2's item line is **unchanged**. Actions are nested list items beneath
 * it, and the nesting is what makes them unambiguous: Feature 2 already uses
 * two-space indentation for the continuation lines of a multi-line thought, so
 * a bare `  followed up 2026-08-20` could be either. Resolving that wrongly
 * would swallow the user's words or invent a follow-up that never happened
 * (research R8).
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

const FILE = `- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved
  - followed up 2026-08-20
  - followed up 2026-08-27
- 2026-07-02 @roofer — Send the revised estimate
  - received 2026-08-14
- 2026-08-13 @legal — Contract review
  this one had a second line of text the user typed
`;

describe("Feature 2's item line", () => {
  test("is read exactly as it was written", () => {
    const items = parseWaiting(FILE);

    assert.equal(items.length, 3);
    assert.equal(items[0]?.since, "2026-08-11");
    assert.equal(items[0]?.owner, "Priya");
    assert.equal(items[0]?.text, "Confirm the migration window moved");
    assert.equal(items[0]?.capturedAt?.toISOString(), new Date("2026-08-09T16:02:11-04:00").toISOString());
  });

  test("a hand-written line with no capture timestamp reads as one", () => {
    const items = parseWaiting(FILE);

    assert.equal(items[1]?.owner, "roofer");
    assert.equal(items[1]?.text, "Send the revised estimate");
    assert.equal(items[1]?.capturedAt, null, "no date is ever substituted");
  });
});

describe("nested action lines", () => {
  test("are recognised as actions", () => {
    const items = parseWaiting(FILE);

    assert.deepEqual(items[0]?.actions, [
      { kind: "followed-up", on: "2026-08-20" },
      { kind: "followed-up", on: "2026-08-27" },
    ]);
    assert.deepEqual(items[1]?.actions, [{ kind: "received", on: "2026-08-14" }]);
  });

  test("a plain indented line is item text, not an action", () => {
    const items = parseWaiting(FILE);

    assert.deepEqual(items[2]?.actions, [], "the ambiguity research R8 exists to resolve");
    assert.equal(
      items[2]?.text,
      "Contract review\nthis one had a second line of text the user typed",
      "the user's second line is theirs, and stays with the item",
    );
  });

  test("render and parse agree", () => {
    for (const [kind, on] of [
      ["followed-up", "2026-08-20"],
      ["received", "2026-08-14"],
    ] as const) {
      const line = renderActionLine({ kind, on });
      const parsed = parseWaiting(`- 2026-01-01 @x — thing\n${line}\n`)[0];
      assert.deepEqual(parsed?.actions, [{ kind, on }]);
    }
  });
});

describe("lines this feature cannot read", () => {
  test("are shown as they read and never dropped", () => {
    const messy = `- 2026-08-11 @Priya — A normal item
not a list item at all
- @nodate — missing the date entirely
  - followed up not-a-date
- 2026-08-13 @legal — Contract review
`;

    const items = parseWaiting(messy);

    assert.deepEqual(
      items.map((i) => i.owner),
      ["Priya", "legal"],
      "only well-formed items are items",
    );

    // Not an item is not the same as not there. Every line the parser could not
    // attribute comes back verbatim, with the line number the user will find it
    // on, so a surface can show it as it reads (FR-044).
    assert.deepEqual(parseUnreadable(messy), [
      { line: 3, raw: "- @nodate — missing the date entirely" },
      { line: 4, raw: "  - followed up not-a-date" },
    ]);

    // `not a list item at all` is deliberately absent: an open item was above
    // it, so it is that item's second line of text, and it is already shown.
    assert.match(items[0]?.text ?? "", /not a list item at all/);

    // Nothing is rewritten to make the file parse: appending to a good item
    // leaves every unreadable line exactly where it was.
    const after = appendAction(messy, { index: 0, raw: items[0]?.raw ?? "" }, {
      kind: "followed-up",
      on: "2026-08-21",
    });
    assert.match(after, /^not a list item at all$/m);
    assert.match(after, /^- @nodate — missing the date entirely$/m);
    assert.match(after, /^ {2}- followed up not-a-date$/m);
  });

  test("an empty or absent file has no items", () => {
    assert.deepEqual(parseWaiting(""), []);
    assert.deepEqual(parseWaiting("\n\n"), []);
  });

  test("a file that reads cleanly has nothing to report", () => {
    assert.deepEqual(parseUnreadable(FILE), [], "silence is what nothing-wrong looks like");
    assert.deepEqual(parseUnreadable(""), []);
    assert.deepEqual(parseUnreadable("\n\n"), [], "blank lines are not unreadable, they are blank");
  });
});

describe("appending an action", () => {
  test("lands beneath its own item, above the next one", () => {
    const items = parseWaiting(FILE);
    const after = appendAction(FILE, { index: 1, raw: items[1]?.raw ?? "" }, {
      kind: "followed-up",
      on: "2026-08-21",
    });

    const lines = after.split("\n");
    const item = lines.indexOf("- 2026-07-02 @roofer — Send the revised estimate");
    const added = lines.indexOf("  - followed up 2026-08-21");
    const next = lines.indexOf("- 2026-08-13 @legal — Contract review");

    assert.ok(item < added && added < next, "an action belongs to the item above it");
  });

  test("adds one line and moves nothing else", () => {
    const items = parseWaiting(FILE);
    const after = appendAction(FILE, { index: 0, raw: items[0]?.raw ?? "" }, {
      kind: "followed-up",
      on: "2026-09-03",
    });

    const added = "  - followed up 2026-09-03";
    assert.deepEqual(
      after.split("\n").filter((l) => l !== added),
      FILE.split("\n"),
      "every other byte is where it was",
    );
  });

  test("the item's own line is never touched", () => {
    const items = parseWaiting(FILE);
    const after = appendAction(FILE, { index: 0, raw: items[0]?.raw ?? "" }, {
      kind: "received",
      on: "2026-09-03",
    });

    assert.match(
      after,
      /^- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved$/m,
      "the date it started waiting is what tells three months of chasing from a Tuesday",
    );
  });
});
