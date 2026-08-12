import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * FR-020e / SC-005a, end to end: a capture made while the sort view is open
 * must survive. The unit-level proof is in inbox-concurrent-write.test.ts; this
 * checks the wiring actually shares one mutex in the real app.
 */

let h: Harness;
test.afterEach(async () => { await h?.close(); });

test("a capture made during a sort session is not lost", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 first\n- 2026-08-09T14:31:12-04:00 second\n");

  await h.openSort();
  const view = await h.sortView();
  await expect(view.locator("#text")).toHaveText("first");

  // Capture through the real path while the sort view is open.
  await h.trigger();
  const box = await h.captureBox();
  await box.locator("#capture-input").fill("captured while sorting");
  await box.locator("#capture-input").press("Enter");

  await view.locator("#to-trash").click();
  await expect(view.locator("#text")).toHaveText("second");

  // Wait for the queued append to land, then confirm nothing was destroyed.
  await expect
    .poll(() => h.inbox(), { timeout: 5000 })
    .toContain("captured while sorting");
  expect(h.inbox()).toContain("second");
  expect(h.vaultFile("trash.md")).toContain("first");
});

test("the new capture becomes sortable without a restart", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 only one\n");

  await h.openSort();
  const view = await h.sortView();

  await h.trigger();
  const box = await h.captureBox();
  await box.locator("#capture-input").fill("late arrival");
  await box.locator("#capture-input").press("Enter");
  await expect.poll(() => h.inbox(), { timeout: 5000 }).toContain("late arrival");

  await view.locator("#to-trash").click();
  await expect(view.locator("#text")).toHaveText("late arrival");
});

/**
 * The stuck case. At inbox zero there is no decision left to make, so nothing
 * would ever pull a new item in on its own — before the inbox:changed signal
 * existed, the view sat on its empty state until it was closed and reopened.
 */
test("a capture reaches an open sort view sitting at inbox zero", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 the only one\n");

  await h.openSort();
  const view = await h.sortView();
  await expect(view.locator("#text")).toHaveText("the only one");

  await view.locator("#to-trash").click();
  await expect(view.locator("#empty")).toBeVisible();

  await h.trigger();
  const box = await h.captureBox();
  await box.locator("#capture-input").fill("arrived at inbox zero");
  await box.locator("#capture-input").press("Enter");

  // No close-and-reopen anywhere in this test: the view has to pick it up
  // while it is still open, or the assertion times out.
  await expect(view.locator("#text")).toHaveText("arrived at inbox zero");
  await expect(view.locator("#empty")).toBeHidden();
  await expect(view.locator("#remaining")).toHaveText("1 item left");
});

/**
 * The other half of the rule: an arrival must never cost the user work in
 * progress. A picker with a half-typed title in it outranks showing the new
 * item, which sorting will reach on its own.
 */
test("an arrival mid-session leaves an open picker and the current item alone", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 first\n");

  await h.openSort();
  const view = await h.sortView();
  await expect(view.locator("#text")).toHaveText("first");

  await view.locator("#to-project").click();
  await view.locator("#create-title").fill("Half typed name");

  await h.trigger();
  const box = await h.captureBox();
  await box.locator("#capture-input").fill("landed mid-session");
  await box.locator("#capture-input").press("Enter");

  // The tally moves, which is how the user learns the capture landed.
  await expect(view.locator("#remaining")).toHaveText("2 items left");

  // Everything the user was working on survives it.
  await expect(view.locator("#create-title")).toHaveValue("Half typed name");
  await expect(view.locator("#text")).toHaveText("first");
});
