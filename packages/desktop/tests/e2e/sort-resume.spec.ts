import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * US3: partial work survives a quit, and inbox zero is reachable.
 */

const SEED =
  "- 2026-08-09T14:23:05-04:00 one\n" +
  "- 2026-08-09T14:31:12-04:00 two\n" +
  "- 2026-08-09T15:02:44-04:00 three\n";

let h: Harness;
test.afterEach(async () => { await h?.close(); });

test("decisions survive a quit and sorting resumes at the right item", async () => {
  h = await launch();
  h.writeInbox(SEED);
  const configPath = process.env["_"] ?? "";
  void configPath;

  await h.openSort();
  let view = await h.sortView();

  await view.locator("#to-trash").click();
  await expect(view.locator("#text")).toHaveText("two");
  await view.locator("#to-trash").click();
  await expect(view.locator("#text")).toHaveText("three");

  const inboxAfter = h.inbox();
  const trashAfter = h.vaultFile("trash.md");
  const inboxPath = h.inboxPath;

  // Quit hard: no save step exists to miss (FR-024).
  await h.close();

  // Relaunch against the same vault.
  h = await launch({ inboxPath });
  expect(h.inbox()).toBe(inboxAfter);
  expect(h.vaultFile("trash.md")).toBe(trashAfter);

  await h.openSort();
  view = await h.sortView();
  await expect(view.locator("#text")).toHaveText("three");
});

test("sorting to zero shows the empty state with no choices", async () => {
  h = await launch();
  h.writeInbox(SEED);
  await h.openSort();
  const view = await h.sortView();

  for (let i = 0; i < 3; i++) await view.locator("#to-trash").click();

  await expect(view.locator("#empty")).toBeVisible();
  await expect(view.locator("#choices")).toBeHidden();
  await expect(view.locator("#remaining")).toBeEmpty();
  expect(h.inbox().trim()).toBe("");
});

test("opening the view on an already-empty inbox shows the empty state", async () => {
  h = await launch();
  h.writeInbox("\n   \n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#empty")).toBeVisible();
  await expect(view.locator("#choices")).toBeHidden();
});

test("a 20-item inbox goes to zero, two inputs per decision at most", async () => {
  // SC-001, SC-002, SC-006.
  h = await launch();
  h.writeInbox(
    Array.from({ length: 20 }, (_, i) => `- 2026-08-09T14:00:${String(i).padStart(2, "0")}-04:00 item ${i}\n`).join(""),
  );
  await h.openSort();
  const view = await h.sortView();

  for (let i = 0; i < 20; i++) {
    await expect(view.locator("#text")).toHaveText(`item ${i}`);
    // One input: the destination. No confirmation step follows.
    await view.locator("#to-calendar").click();
  }

  await expect(view.locator("#empty")).toBeVisible();
  expect(h.vaultFile("calendar.md").trim().split("\n")).toHaveLength(20);
});
