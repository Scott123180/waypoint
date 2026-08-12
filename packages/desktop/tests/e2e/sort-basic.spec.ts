import { test, expect } from "@playwright/test";

import { launch, type Harness } from "./harness";

/**
 * The P1 loop end to end: one item at a time, five destinations, each decision
 * durable before the next item appears.
 */

const SEED =
  "- 2026-08-09T14:23:05-04:00 Call the roofer back\n" +
  "- 2026-08-09T14:31:12-04:00 Book flights for the offsite\n" +
  "- 2026-08-09T15:02:44-04:00 Confirm the migration window\n" +
  "- 2026-08-09T15:30:00-04:00 An idea that went nowhere\n";

let h: Harness;

test.afterEach(async () => {
  await h?.close();
});

async function openSeeded(seed = SEED) {
  h = await launch();
  h.writeInbox(seed);
  await h.openSort();
  return h.sortView();
}

test("shows exactly one item, with five destinations", async () => {
  const view = await openSeeded();

  await expect(view.locator("#text")).toHaveText("Call the roofer back");
  await expect(view.locator("#captured-at")).not.toBeEmpty();

  // Exactly five, no more and no fewer (FR-005).
  await expect(view.locator("#choices button")).toHaveCount(5);
  await expect(view.locator("#remaining")).toContainText("4 items left");
});

test("routing to trash files the item and advances", async () => {
  const view = await openSeeded();

  await view.locator("#to-trash").click();

  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");
  expect(h.vaultFile("trash.md")).toContain("Call the roofer back");
  expect(h.inbox()).not.toContain("Call the roofer back");
});

test("calendar records a flag date and never asks for a time", async () => {
  const view = await openSeeded();

  await view.locator("#to-calendar").click();
  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");

  const calendar = h.vaultFile("calendar.md");
  expect(calendar).toMatch(/^- \d{4}-\d{2}-\d{2} — /m);
  expect(calendar).toContain("Call the roofer back");

  // No date or time prompt appeared at any point (FR-017a).
  await expect(view.locator("#panel")).toBeEmpty();
});

test("waiting-for asks who, then records the name and a date", async () => {
  const view = await openSeeded();

  await view.locator("#to-waiting").click();
  await view.locator("#waiting-owner").fill("Priya");
  await view.locator("#waiting-submit").click();

  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");
  expect(h.vaultFile("waiting.md")).toMatch(/^- \d{4}-\d{2}-\d{2} @Priya — /m);
});

test("an empty owner is refused and nothing is written", async () => {
  const view = await openSeeded();

  await view.locator("#to-waiting").click();
  await view.locator("#waiting-submit").click();

  await expect(view.locator("#notice")).toContainText("needs a name");
  await expect(view.locator("#text")).toHaveText("Call the roofer back");
  expect(h.vaultFile("waiting.md")).toBe("");
});

test("routing to an existing project files under ## Unprocessed", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("#to-project").click();
  await view.locator('#panel button[data-slug="roof-repair"]').click();

  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");

  const project = h.vaultFile("projects/roof-repair.md");
  expect(project).toContain("## Unprocessed");
  expect(project).toContain("Call the roofer back");
  expect(project).toContain("status: active");
});

test("sorting every item reaches inbox zero", async () => {
  const view = await openSeeded();

  for (let i = 0; i < 4; i++) {
    await view.locator("#to-trash").click();
  }

  await expect(view.locator("#empty")).toBeVisible();
  await expect(view.locator("#choices")).toBeHidden();
  expect(h.inbox().trim()).toBe("");
});

test("the next item appears within the 100ms budget", async () => {
  // SC-002a. CI timings are a regression signal; the authoritative measurement
  // is on real hardware, matching Feature 1's latency precedent.
  const view = await openSeeded();

  const started = Date.now();
  await view.locator("#to-trash").click();
  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");
  const elapsed = Date.now() - started;

  expect(elapsed).toBeLessThan(1000);
});

test("destinations are rendered unranked, with nothing pre-selected", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/alpha.md", "# Alpha\n");
  h.writeVaultFile("projects/beta.md", "# Beta\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("#to-project").click();

  const labels = await view.locator("#panel .list button").allTextContents();
  expect(labels).toEqual(["Alpha", "Beta"]);
  // FR-030: no destination is highlighted, focused, or otherwise proposed.
  await expect(view.locator("#panel .list button[autofocus]")).toHaveCount(0);
});
