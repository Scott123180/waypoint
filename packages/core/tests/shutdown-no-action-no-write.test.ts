import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, shutdownFor, snapshot } from "./shutdown-fakes";

/**
 * Opening it and doing nothing is a complete, legitimate use (FR-041, US2
 * scenario 12).
 *
 * Some evenings the answer is "nothing is hanging", and the right outcome is to
 * close the laptop. So nothing is defaulted, nothing is marked as seen,
 * acknowledged, reviewed, or dismissed, and nothing is written to record that
 * the screen was looked at — including the shape of that record a well-meaning
 * change would reach for first: a "last opened" timestamp.
 *
 * The close-the-window half is `shutdown-glance.spec.ts`'s, which asserts the
 * vault unchanged across a close and a reopen in the running app.
 */

describe("a reading with no action", () => {
  test("writes nothing at all", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();

    assert.deepEqual(vault.writeLog, []);
    assert.deepEqual(snapshot(vault), before);
  });

  test("three readings in a row still write nothing", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();
    await shutdown.read();
    await shutdown.read();

    assert.deepEqual(vault.writeLog, []);
    assert.deepEqual(snapshot(vault), before);
  });

  test("nothing is defaulted into a source file", async () => {
    // No DRI filled in, no next action invented, no outcome carried forward, no
    // owner guessed for an unreadable line.
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();

    for (const [path, content] of Object.entries(before)) {
      assert.equal(vault.files.get(path), content, `${path} was written back`);
    }
  });

  test("nothing marks an item as seen, acknowledged, or reviewed", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    const view = await shutdown.read();
    assert.ok(view.waiting.items.length > 0, "the fixture must surface something to be 'seen'");

    const after = snapshot(vault);
    for (const content of Object.values(after)) {
      assert.doesNotMatch(content, /seen|acknowledg|reviewed on|dismissed/i);
    }
  });

  test("and no `last opened` is recorded anywhere", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();

    assert.deepEqual(Object.keys(snapshot(vault)).sort(), Object.keys(before).sort());
    for (const content of Object.values(snapshot(vault))) {
      assert.doesNotMatch(content, /last opened|opened on|last run/i);
    }
  });
});

describe("the value itself records nothing that could become one", () => {
  test("there is no id, no timestamp of the opening, and no completion flag", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    for (const forbidden of ["id", "openedAt", "startedAt", "completed", "step", "progress", "seen"]) {
      assert.ok(!(forbidden in view), `${forbidden} is where a record of a shutdown would begin`);
    }
  });

  test("`today` is a date, not an instant — there is nothing to log", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    assert.match(view.today, /^\d{4}-\d{2}-\d{2}$/);
  });
});
