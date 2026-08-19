import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { WAITING_PATH, WaitingService } from "../src/waiting/waiting-service";
import { seedVault } from "./project-fakes";
import { waitingFile } from "./shutdown-fakes";

/**
 * `WaitingService.read()` — items and unreadable lines from **one** read.
 *
 * Additive beside `list()` and `unreadable()`, which each read `waiting.md`
 * once. FR-011a permits one read of each panel source per opening, and the
 * shutdown needs both halves, so calling the two existing verbs would spend two
 * reads on one file for no gain.
 *
 * The second test is why the method exists. Without it this file would assert
 * only that the new verb agrees with the old ones, which a `Promise.all` over
 * the two would also satisfy — and the read count is the whole reason.
 */

const CONTENT = waitingFile([
  { since: "2026-07-01", owner: "Priya", text: "Confirm the migration window moved" },
  "- this line does not parse",
  {
    since: "2026-08-01",
    owner: "Sam",
    text: "Sign-off on the copy",
    actions: [{ kind: "followed-up", on: "2026-08-12" }],
  },
]);

function serviceFor(files: Record<string, string>): {
  service: WaitingService;
  vault: ReturnType<typeof seedVault>;
} {
  const vault = seedVault(files);
  return { service: new WaitingService({ vault }), vault };
}

describe("read() agrees with the two verbs it replaces", () => {
  test("the items are exactly what list() returns", async () => {
    const { service } = serviceFor({ [WAITING_PATH]: CONTENT });

    assert.deepEqual((await service.read()).items, await service.list());
  });

  test("the unreadable lines are exactly what unreadable() returns", async () => {
    const { service } = serviceFor({ [WAITING_PATH]: CONTENT });

    assert.deepEqual((await service.read()).unreadable, await service.unreadable());
  });

  test("an absent file gives both halves empty, and creates nothing", async () => {
    const { service, vault } = serviceFor({});

    assert.deepEqual(await service.read(), { items: [], unreadable: [] });
    assert.deepEqual(vault.writeLog, [], "a vault gains waiting.md by sorting into it, never by being read");
    assert.ok(!vault.files.has(WAITING_PATH));
  });
});

describe("the read count is the reason the method exists", () => {
  test("read() touches waiting.md exactly once", async () => {
    const { service, vault } = serviceFor({ [WAITING_PATH]: CONTENT });

    await service.read();

    assert.deepEqual(vault.readLog.filter((p) => p === WAITING_PATH), [WAITING_PATH]);
  });

  test("list() and unreadable() together touch it twice — the cost being avoided", async () => {
    const { service, vault } = serviceFor({ [WAITING_PATH]: CONTENT });

    await service.list();
    await service.unreadable();

    assert.equal(
      vault.readLog.filter((p) => p === WAITING_PATH).length,
      2,
      "if this ever reads once, the two verbs have changed and read() may no longer be needed",
    );
  });
});
