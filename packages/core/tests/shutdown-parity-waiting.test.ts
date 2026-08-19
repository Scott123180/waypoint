import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Chasing or receiving from the shutdown == doing it from the weekly review
 * (FR-036, FR-036a, SC-004).
 *
 * **The comparison is on the file the verb owns**, and that is the whole design
 * decision this file exists to pin. The review's only surface for these verbs is
 * `ReviewService.recordFollowUp`, which delegates to `WaitingService` **and
 * writes a line into `log/YYYY-Www.md`**. That log line is the review's record
 * of its own ritual, and it is not part of the waiting action.
 *
 * So the shutdown routes to `WaitingService` directly, and parity is asserted on
 * `waiting.md`. Its **absence** under `log/` is asserted too, here and in
 * `shutdown-writes-no-record.test.ts` — reaching the review's verb would have
 * written a record of the shutdown while every test about this feature's own
 * files still passed (FR-050).
 */

/** The shutdown's path: the ref comes from what the panel displayed. */
async function fromShutdown(
  verb: "recordFollowUp" | "recordReceived",
  owner: string,
): Promise<Record<string, string>> {
  const { shutdown, waiting, vault } = actingVault(populatedVault());

  const view = await shutdown.read();
  const stale = view.waiting.items.find((s) => s.item.owner === owner);
  assert.ok(stale, `the panel must list ${owner}'s item`);

  const result = await waiting[verb]({ index: stale.item.index, raw: stale.item.raw });
  assert.ok(result.ok, "the shutdown's path must not be refused");

  return snapshot(vault);
}

/** The verb's own path, as the review reaches it — `WaitingService`, from `list()`. */
async function fromWaitingVerb(
  verb: "recordFollowUp" | "recordReceived",
  owner: string,
): Promise<Record<string, string>> {
  const { waiting, vault } = actingVault(populatedVault());

  const item = (await waiting.list()).find((i) => i.owner === owner);
  assert.ok(item);

  const result = await waiting[verb]({ index: item.index, raw: item.raw });
  assert.ok(result.ok);

  return snapshot(vault);
}

describe("recording a follow-up", () => {
  test("waiting.md is byte-identical to the verb's own result", async () => {
    assert.equal(
      (await fromShutdown("recordFollowUp", "Priya"))["waiting.md"],
      (await fromWaitingVerb("recordFollowUp", "Priya"))["waiting.md"],
    );
  });

  test("it appends `followed up <date>` beneath the item", async () => {
    const file = (await fromShutdown("recordFollowUp", "Priya"))["waiting.md"] ?? "";

    assert.match(file, /- 2026-06-01 @Priya — Confirm the migration window moved\n {2}- followed up 2026-08-19/);
  });

  test("`since` is preserved — total age is what tells chased from forgotten", async () => {
    const file = (await fromShutdown("recordFollowUp", "Priya"))["waiting.md"] ?? "";

    assert.ok(file.includes("- 2026-06-01 @Priya"), "the delegation date is never rewritten");
  });

  test("an item that already has a follow-up gains a second one", async () => {
    const file = (await fromShutdown("recordFollowUp", "Lee"))["waiting.md"] ?? "";

    assert.match(file, / {2}- followed up 2026-08-12\n {2}- followed up 2026-08-19/);
  });
});

describe("recording a receipt", () => {
  test("waiting.md is byte-identical to the verb's own result", async () => {
    assert.equal(
      (await fromShutdown("recordReceived", "Priya"))["waiting.md"],
      (await fromWaitingVerb("recordReceived", "Priya"))["waiting.md"],
    );
  });

  test("it appends `received <date>` beneath the item", async () => {
    const file = (await fromShutdown("recordReceived", "Priya"))["waiting.md"] ?? "";

    assert.match(file, / {2}- received 2026-08-19/);
  });

  test("nothing is deleted — the line and its whole history stay in the file", async () => {
    const file = (await fromShutdown("recordReceived", "Lee"))["waiting.md"] ?? "";

    assert.ok(file.includes("- 2026-04-01 @Lee — Budget numbers"));
    assert.ok(file.includes("  - followed up 2026-08-12"), "the earlier chase is still recorded");
  });
});

describe("neither verb writes a record of the ritual it was called from", () => {
  test("no file under `log/` is created by a follow-up", async () => {
    const after = await fromShutdown("recordFollowUp", "Priya");

    assert.deepEqual(
      Object.keys(after).filter((p) => p.startsWith("log/")),
      [],
      "this is what routing through ReviewService would have written (FR-050)",
    );
  });

  test("nor by a receipt", async () => {
    const after = await fromShutdown("recordReceived", "Priya");

    assert.deepEqual(Object.keys(after).filter((p) => p.startsWith("log/")), []);
  });

  test("waiting.md is the only file that changed", async () => {
    const before = populatedVault();
    const after = await fromShutdown("recordFollowUp", "Priya");

    const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
    assert.deepEqual(changed, ["waiting.md"]);
  });
});
