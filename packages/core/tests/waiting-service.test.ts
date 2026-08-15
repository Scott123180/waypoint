import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { WaitingService } from "../src/waiting/waiting-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Recording what happened to a delegated item.
 *
 * Two habits, both inherited rather than invented: every write verifies the
 * item's own block first, and nothing is ever deleted. A received item stays in
 * the file with its whole history — the habit `trash.md` established, where the
 * file grows and pruning is the user's business (FR-043c).
 */

const FILE = `- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved
- 2026-07-02 @roofer — Send the revised estimate
`;

function service(content = FILE, now = "2026-08-14T10:00:00-04:00") {
  const vault = seedVault({ "waiting.md": content });
  return { vault, waiting: new WaitingService({ vault, clock: new FixedClock(now) }) };
}

describe("list", () => {
  test("reads the file fresh every time", async () => {
    const { vault, waiting } = service();

    assert.equal((await waiting.list()).length, 2);
    vault.files.set("waiting.md", `${FILE}- 2026-08-13 @legal — Contract review\n`);
    assert.equal((await waiting.list()).length, 3, "a hand-edit is reflected immediately");
  });

  test("an absent file is an empty list, not a failure", async () => {
    const vault = seedVault({});
    const waiting = new WaitingService({ vault, clock: new FixedClock() });

    assert.deepEqual(await waiting.list(), []);
    assert.deepEqual(vault.writeLog, [], "and nothing is created to make the question answerable");
  });
});

describe("recordFollowUp", () => {
  test("appends beneath the item and keeps it outstanding", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    const result = await waiting.recordFollowUp({ index: item.index, raw: item.raw });
    assert.ok(result.ok);

    assert.match(vault.files.get("waiting.md") ?? "", /^ {2}- followed up 2026-08-14$/m);
    const [after] = await waiting.list();
    assert.equal(after?.actions.length, 1);
  });

  test("leaves the date it started waiting untouched", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    await waiting.recordFollowUp({ index: item.index, raw: item.raw });

    assert.match(
      vault.files.get("waiting.md") ?? "",
      /^- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved$/m,
      "total age is what tells three months of chasing from a Tuesday (FR-043a)",
    );
  });

  test("a second follow-up does not replace the first", async () => {
    const vault = seedVault({ "waiting.md": FILE });
    const clock = new FixedClock("2026-08-14T10:00:00-04:00");
    const waiting = new WaitingService({ vault, clock });

    const [first] = await waiting.list();
    await waiting.recordFollowUp({ index: first?.index ?? 0, raw: first?.raw ?? "" });

    // A week later, the same item chased again. The ref is re-read, because the
    // block on disk now includes the first follow-up.
    clock.set("2026-08-21T10:00:00-04:00");
    const [again] = await waiting.list();
    await waiting.recordFollowUp({ index: again?.index ?? 0, raw: again?.raw ?? "" });

    const [after] = await waiting.list();
    assert.deepEqual(
      after?.actions,
      [
        { kind: "followed-up", on: "2026-08-14" },
        { kind: "followed-up", on: "2026-08-21" },
      ],
      "it is a history, not a status field (FR-043b)",
    );
  });
});

describe("recordReceived", () => {
  test("leaves the line and its history in the file", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    await waiting.recordFollowUp({ index: item.index, raw: item.raw });
    const [chased] = await waiting.list();
    await waiting.recordReceived({ index: chased?.index ?? 0, raw: chased?.raw ?? "" });

    const content = vault.files.get("waiting.md") ?? "";
    assert.match(content, /^- 2026-08-11 @Priya/m, "nothing is deleted, moved, or archived");
    assert.match(content, /^ {2}- followed up 2026-08-14$/m);
    assert.match(content, /^ {2}- received 2026-08-14$/m);
  });

  test("stops the item being outstanding", async () => {
    const { waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    await waiting.recordReceived({ index: item.index, raw: item.raw });

    const [after] = await waiting.list();
    assert.equal(after?.actions.some((a) => a.kind === "received"), true);
  });

  test("the other items are untouched", async () => {
    const { vault, waiting } = service();
    const [item] = await waiting.list();
    assert.ok(item);

    await waiting.recordReceived({ index: item.index, raw: item.raw });

    assert.match(vault.files.get("waiting.md") ?? "", /^- 2026-07-02 @roofer — Send the revised estimate$/m);
  });
});

describe("a hand-written action line", () => {
  test("reads exactly like a written one", async () => {
    const { waiting } = service(`- 2026-08-11 @Priya — Confirm the window
  - followed up 2026-08-12
`);

    const [item] = await waiting.list();
    assert.deepEqual(item?.actions, [{ kind: "followed-up", on: "2026-08-12" }]);

    // And a written one joins it without disturbing it.
    await waiting.recordFollowUp({ index: item?.index ?? 0, raw: item?.raw ?? "" });
    const [after] = await waiting.list();
    assert.deepEqual(after?.actions, [
      { kind: "followed-up", on: "2026-08-12" },
      { kind: "followed-up", on: "2026-08-14" },
    ]);
  });
});

describe("one write at a time", () => {
  test("two overlapping records both survive", async () => {
    const { waiting } = service();
    const items = await waiting.list();

    await Promise.all([
      waiting.recordFollowUp({ index: 0, raw: items[0]?.raw ?? "" }),
      waiting.recordFollowUp({ index: 1, raw: items[1]?.raw ?? "" }),
    ]);

    const after = await waiting.list();
    assert.equal(after[0]?.actions.length, 1, "neither read-modify-write discarded the other");
    assert.equal(after[1]?.actions.length, 1);
  });
});
