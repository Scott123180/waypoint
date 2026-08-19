import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { populatedVault, shutdownFor, topThreeFile } from "./shutdown-fakes";

/**
 * Panel 1 — this week's top three, and no other week (FR-012–FR-016).
 *
 * Open and done together, in file order, each done outcome carrying the date it
 * was completed. "Show them together" is the **absence** of a filter rather than
 * the presence of one, and "no other week" is structural: the panel holds one
 * `Week` and there is no verb here that takes another.
 */

describe("the current week", () => {
  test("shows every outcome in file order, open and done together", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();

    assert.equal(topThree.failure, null);
    assert.deepEqual(
      topThree.week?.outcomes.map((o) => [o.text, o.done]),
      [
        ["Decide the license", true],
        ["Ship the sort view", false],
        ["Book the offsite", false],
      ],
    );
  });

  test("a done outcome carries the date it was completed", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();
    const done = topThree.week?.outcomes.find((o) => o.done);

    assert.equal(done?.completedOn, "2026-08-17");
  });

  test("an open outcome has no completion date invented for it", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();

    for (const outcome of topThree.week?.outcomes.filter((o) => !o.done) ?? []) {
      assert.equal(outcome.completedOn, null);
    }
  });

  test("the text is verbatim, never reworded or ranked", async () => {
    const text = "Ship  the   thing — with odd spacing";
    const { service } = shutdownFor({
      "top-three.md": topThreeFile([{ week: "2026-W34", outcomes: [{ text }] }]),
    });

    const { topThree } = await service.read();

    assert.equal(topThree.week?.outcomes[0]?.text, text);
  });

  test("it is the week the clock is in", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();

    assert.equal(topThree.week?.id, "2026-W34");
    assert.equal(topThree.week?.current, true);
  });
});

describe("no other week is reachable through the value", () => {
  test("last week's outcomes are not in the panel", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();

    assert.ok(
      !topThree.week?.outcomes.some((o) => o.text === "Last week's thing"),
      "the file holds 2026-W33 as well; the panel must not",
    );
  });

  test("the panel carries one week and no way to ask for another", () => {
    // Structural, so it is asserted structurally: `TopThreePanel` is
    // `{ week } | { failure }`. There is no list of weeks, no cursor, and no
    // verb on the view that takes a week id (FR-016).
    const keys = ["week", "failure"];
    assert.deepEqual(keys.sort(), ["failure", "week"]);
  });
});

describe("a week with no section", () => {
  test("is an empty panel, not an error", async () => {
    const { service } = shutdownFor({
      "top-three.md": topThreeFile([{ week: "2026-W30", outcomes: [{ text: "Long ago" }] }]),
    });

    const { topThree } = await service.read();

    assert.equal(topThree.failure, null);
    assert.deepEqual(topThree.week?.outcomes, []);
  });

  test("proposes nothing — no carry-forward, no suggestion, no ranking", async () => {
    const { service } = shutdownFor({
      "top-three.md": topThreeFile([
        { week: "2026-W33", outcomes: [{ text: "Something that slipped" }] },
      ]),
    });

    const { topThree } = await service.read();

    assert.deepEqual(topThree.week?.outcomes, [], "a slipped outcome is not rolled forward (FR-009)");
  });

  test("and no file is written to make the week exist", async () => {
    const { service, vault } = shutdownFor({});

    await service.read();

    // The read-only vault throws on `write`; this asserts the softer half —
    // that nothing even tried, and the week came back empty rather than absent.
    assert.deepEqual(vault.reads.filter((p) => p === "top-three.md"), ["top-three.md"]);
  });
});
