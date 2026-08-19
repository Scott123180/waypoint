import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { populatedVault, shutdownFor, waitingFile } from "./shutdown-fakes";

/**
 * Panel 3 — delegated work that has gone quiet (FR-024–FR-027).
 *
 * Two rules, both already shipped and neither reimplemented here:
 *
 *   - **Outstanding** is `outstanding(item)`: false once anything has been
 *     received, asked of the whole history rather than the last action, because
 *     a hand-edited file can put the lines in any order.
 *
 *   - **Stale** is `waiting.stale.check` asked about `untouchedSince(item)` —
 *     when it was last *touched*, not when it started waiting. Chasing something
 *     is touching it.
 *
 * Both numbers are carried, because "waiting three months, chased last Friday"
 * and "forgotten for three months" are different situations and one number
 * cannot tell them apart.
 */

describe("membership", () => {
  test("lists exactly the outstanding items past the threshold", async () => {
    const { service } = shutdownFor(populatedVault());

    const { waiting } = await service.read();

    assert.equal(waiting.failure, null);
    assert.deepEqual(waiting.items.map((s) => s.item.owner), ["Priya", "Lee"]);
  });

  test("an item with a recorded receipt is absent at any age", async () => {
    const { service } = shutdownFor({
      "waiting.md": waitingFile([
        {
          since: "2020-01-01",
          owner: "Dana",
          text: "The signed contract",
          actions: [{ kind: "received", on: "2026-08-01" }],
        },
      ]),
    });

    const { waiting } = await service.read();

    assert.deepEqual(waiting.items, [], "received is received, however long it took");
  });

  test("a receipt recorded before a later follow-up still closes it", async () => {
    // A hand-edited file can put the lines in any order. The question is
    // whether it arrived, not when the line was typed.
    const { service } = shutdownFor({
      "waiting.md": waitingFile([
        {
          since: "2020-01-01",
          owner: "Dana",
          text: "The signed contract",
          actions: [
            { kind: "received", on: "2026-01-01" },
            { kind: "followed-up", on: "2020-06-01" },
          ],
        },
      ]),
    });

    assert.deepEqual((await service.read()).waiting.items, []);
  });

  test("an item inside the threshold is not listed", async () => {
    const { service } = shutdownFor({
      "waiting.md": waitingFile([{ since: "2026-08-13", owner: "Sam", text: "Sign-off on the copy" }]),
    });

    assert.deepEqual((await service.read()).waiting.items, []);
  });
});

describe("staleness is measured from the last action, not from `since`", () => {
  const CHASED_YESTERDAY = waitingFile([
    {
      since: "2026-05-01",
      owner: "Lee",
      text: "Budget numbers",
      actions: [{ kind: "followed-up", on: "2026-08-18" }],
    },
  ]);

  test("an item chased yesterday but delegated three months ago is absent", async () => {
    const { service } = shutdownFor({ "waiting.md": CHASED_YESTERDAY });

    assert.deepEqual(
      (await service.read()).waiting.items,
      [],
      "chasing something is touching it; a chased item is not neglected",
    );
  });

  test("the rule is asked about the follow-up date, not the delegation date", async () => {
    const { service, policy } = shutdownFor({ "waiting.md": CHASED_YESTERDAY });

    await service.read();

    assert.deepEqual(
      policy.calls.filter((c) => c.point === "waiting.stale.check").map((c) => "since" in c && c.since),
      ["2026-08-18"],
    );
  });
});

describe("what each listed item carries", () => {
  test("the owner and the text, verbatim", async () => {
    const { service } = shutdownFor(populatedVault());

    const { waiting } = await service.read();
    const priya = waiting.items.find((s) => s.item.owner === "Priya");

    assert.equal(priya?.item.text, "Confirm the migration window moved");
  });

  test("both ages, so the two situations can be told apart", async () => {
    const { service } = shutdownFor(populatedVault());

    const { waiting } = await service.read();
    const lee = waiting.items.find((s) => s.item.owner === "Lee");

    assert.equal(lee?.untouchedDays, 7, "chased a week ago");
    assert.equal(lee?.waitingDays, 140, "and outstanding since April");
  });

  test("an item never chased has the two ages equal", async () => {
    const { service } = shutdownFor(populatedVault());

    const { waiting } = await service.read();
    const priya = waiting.items.find((s) => s.item.owner === "Priya");

    assert.equal(priya?.untouchedDays, 79);
    assert.equal(priya?.waitingDays, 79);
  });

  test("the reason is the policy module's words, passed through untouched", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    const { waiting } = await service.read();

    const reasons = policy.answers.filter((a) => a.verdict !== "allow").map((a) => a.reason);
    for (const stale of waiting.items) {
      assert.ok(
        reasons.includes(stale.reason),
        "a reason composed here would be domain vocabulary in the wrong place",
      );
    }
  });

  test("the item keeps the raw block a write would be verified against", async () => {
    const { service } = shutdownFor(populatedVault());

    const { waiting } = await service.read();

    for (const stale of waiting.items) {
      assert.ok(stale.item.raw.startsWith("- "), "the block as it sits on disk");
      assert.equal(typeof stale.item.index, "number");
    }
  });
});
