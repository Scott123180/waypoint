import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { WaitingService } from "../src/waiting/waiting-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Verify before write, for waiting-for items.
 *
 * The deliberate analogue of `MilestoneRef` and `OutcomeRef`: identity is
 * position plus the exact text, checked against a freshly read file
 * immediately before the write. No id is embedded in `waiting.md` — machine
 * bookkeeping does not belong in a document whose promise is hand-editability.
 *
 * The weekly review is the surface that makes this matter: it is precisely the
 * screen that sits open while the user does something else.
 */

const FILE = `- 2026-08-11 @Priya — Confirm the migration window moved
- 2026-07-02 @roofer — Send the revised estimate
`;

function service(content = FILE) {
  const vault = seedVault({ "waiting.md": content });
  return { vault, waiting: new WaitingService({ vault, clock: new FixedClock() }) };
}

describe("a block that changed on disk", () => {
  test("refuses with entry-changed and writes nothing", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    // Reworded in a text editor while the review had it on screen.
    vault.files.set("waiting.md", FILE.replace("Confirm the migration window moved", "Confirm the cutover window"));
    vault.writeLog.length = 0;

    const result = await waiting.recordFollowUp({ index: item.index, raw: item.raw });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "entry-changed");
    assert.deepEqual(vault.writeLog, []);
  });

  test("leaves the user's wording exactly as they left it", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    const edited = FILE.replace("Confirm the migration window moved", "Confirm the cutover window");
    vault.files.set("waiting.md", edited);

    await waiting.recordReceived({ index: item.index, raw: item.raw });

    assert.equal(vault.files.get("waiting.md"), edited);
  });

  test("an action added elsewhere changes the block, so the stale ref is refused", async () => {
    // The same item, chased in another window. The block the caller was shown
    // no longer matches, and re-presenting it is the honest answer.
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    vault.files.set(
      "waiting.md",
      FILE.replace(
        "- 2026-08-11 @Priya — Confirm the migration window moved\n",
        "- 2026-08-11 @Priya — Confirm the migration window moved\n  - followed up 2026-08-13\n",
      ),
    );

    const result = await waiting.recordFollowUp({ index: item.index, raw: item.raw });
    assert.equal(result.ok, false);
  });
});

describe("an item that is no longer there", () => {
  test("refuses rather than writing at the position something else now holds", async () => {
    const { vault, waiting } = service();
    const [, second] = await waiting.list();
    assert.ok(second);

    vault.files.set("waiting.md", "- 2026-08-11 @Priya — Confirm the migration window moved\n");

    const result = await waiting.recordFollowUp({ index: second.index, raw: second.raw });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "entry-changed");
  });

  test("an absent file refuses rather than creating one", async () => {
    const vault = seedVault({});
    const waiting = new WaitingService({ vault, clock: new FixedClock() });

    const result = await waiting.recordFollowUp({ index: 0, raw: "- 2026-08-11 @Priya — anything" });

    assert.equal(result.ok, false);
    assert.deepEqual(vault.writeLog, []);
  });
});

describe("a matching block", () => {
  test("is written, so verification is a guard and not a wall", async () => {
    const { waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    const result = await waiting.recordFollowUp({ index: item.index, raw: item.raw });
    assert.equal(result.ok, true);
  });
});
