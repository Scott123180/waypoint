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
