import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { calendarFile, shutdownFor, waitingFile } from "./shutdown-fakes";

/**
 * The user's own words never go quietly missing (FR-032).
 *
 * A line neither grammar can read is carried onto the view verbatim, with the
 * **1-based** number the editor shows in its gutter — so the user is sent to
 * line 14 rather than sent hunting. It is never listed as stale, never counted
 * toward a panel, never rewritten, and never dropped.
 *
 * Surfaced rather than acted on, and that is the point: a line with no owner and
 * no date has nothing to be stale about and nothing to act on. It is shown so it
 * can be fixed in an editor, which is the only place it will ever be fixed.
 */

const FILES = {
  "waiting.md": waitingFile([
    { since: "2026-06-01", owner: "Priya", text: "Confirm the migration window moved" },
    "- 2026-06-01 no owner and no em dash",
    { since: "2026-06-02", owner: "Sam", text: "Second good one" },
    // A malformed *list item*. An unindented line with no dash would be the
    // second line of the item above it — already shown, so not unreadable.
    "- just some prose the user typed at the bottom",
  ]),
  "calendar.md": calendarFile([
    { flaggedOn: "2026-07-30", text: "Quarterly planning day" },
    "- not a calendar line either",
  ]),
};

describe("unreadable lines reach the view", () => {
  test("from waiting.md, with their line numbers", async () => {
    const view = await shutdownFor(FILES).service.read();

    assert.deepEqual(view.unreadableWaiting, [
      { line: 2, raw: "- 2026-06-01 no owner and no em dash" },
      { line: 4, raw: "- just some prose the user typed at the bottom" },
    ]);
  });

  test("from calendar.md, with theirs", async () => {
    const view = await shutdownFor(FILES).service.read();

    assert.deepEqual(view.unreadableCalendar, [{ line: 2, raw: "- not a calendar line either" }]);
  });

  test("on separate fields, because they are separate files to go and fix", async () => {
    const view = await shutdownFor(FILES).service.read();

    assert.notDeepEqual(view.unreadableWaiting, view.unreadableCalendar);
  });

  test("the line numbers are 1-based, matching the editor's gutter", async () => {
    const view = await shutdownFor({ "waiting.md": "broken on the very first line\n" }).service.read();

    assert.equal(view.unreadableWaiting[0]?.line, 1, "not zero — the user is not reading an array");
  });
});

describe("they are never treated as items", () => {
  test("they are not listed as stale", async () => {
    const view = await shutdownFor(FILES).service.read();

    for (const stale of view.waiting.items) {
      assert.notEqual(stale.item.text, "- 2026-06-01 no owner and no em dash");
    }
    assert.deepEqual(view.waiting.items.map((s) => s.item.owner), ["Priya", "Sam"]);
  });

  test("they are not counted toward a panel", async () => {
    const view = await shutdownFor(FILES).service.read();

    assert.equal(view.waiting.items.length, 2);
    assert.equal(view.calendar.items.length, 1);
  });

  test("no rule is asked about them — there is no date to ask about", async () => {
    const { service, policy } = shutdownFor(FILES);

    await service.read();

    assert.equal(
      policy.calls.filter((c) => c.point === "waiting.stale.check").length,
      3,
      "two waiting items and one calendar flag; the unreadable lines are not subjects",
    );
  });
});

describe("they are never rewritten or dropped", () => {
  test("the file is untouched", async () => {
    const files = { ...FILES };
    const before = files["waiting.md"];

    await shutdownFor(files).service.read();

    assert.equal(files["waiting.md"], before);
  });

  test("the text is carried exactly as it sits on disk, spacing and all", async () => {
    const raw = "-   2026-06-01   @Priya    spacing all wrong   ";
    const view = await shutdownFor({ "waiting.md": `${raw}\n` }).service.read();

    assert.equal(view.unreadableWaiting[0]?.raw, raw);
  });

  test("a whole file of noise is surfaced rather than emptied", async () => {
    const view = await shutdownFor({ "calendar.md": "###\nnonsense\n!!!\n" }).service.read();

    assert.deepEqual(view.calendar.items, []);
    assert.equal(view.calendar.failure, null, "unparseable is not unreadable");
    assert.equal(view.unreadableCalendar.length, 3);
  });
});
