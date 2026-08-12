import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

const SEED =
  "- 2026-08-09T14:23:05-04:00 Book flights for the offsite\n" +
  "- 2026-08-09T14:31:12-04:00 Pick a venue\n";

let h: Harness;
test.afterEach(async () => { await h?.close(); });

async function open() {
  h = await launch();
  h.writeInbox(SEED);
  await h.openSort();
  return h.sortView();
}

test("creates a project from a title alone and files the item", async () => {
  const view = await open();

  await view.locator("#to-project").click();
  await view.locator("#create-title").fill("March offsite");
  await view.locator("#create-submit").click();

  await expect(view.locator("#text")).toHaveText("Pick a venue");

  const file = h.vaultFile("projects/march-offsite.md");
  expect(file).toContain("# March offsite");
  expect(file).toContain("status: active");
  expect(file).toContain("## Unprocessed");
  expect(file).toContain("Book flights for the offsite");
  // Nothing beyond a title was ever requested (FR-009).
  expect(file).not.toMatch(/outcome|milestone|DRI/i);
});

test("the new destination appears for the next item", async () => {
  const view = await open();

  await view.locator("#to-project").click();
  await view.locator("#create-title").fill("March offsite");
  await view.locator("#create-submit").click();

  await view.locator("#to-project").click();
  await expect(view.locator('#panel button[data-slug="march-offsite"]')).toBeVisible();
});

test("a duplicate title reuses the existing destination", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/march-offsite.md", "# March offsite\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("#to-project").click();
  await view.locator("#create-title").fill("  march   OFFSITE  ");
  await view.locator("#create-submit").click();

  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("projects/march-offsite.md")).toContain("Book flights");
  expect(h.vaultFile("projects/march-offsite-2.md")).toBe("");
});

test("an empty title creates nothing and keeps the item", async () => {
  const view = await open();

  await view.locator("#to-project").click();
  await view.locator("#create-submit").click();

  await expect(view.locator("#notice")).toContainText("title is required");
  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");
  expect(h.inbox()).toContain("Book flights for the offsite");
});

test("areas work the same way", async () => {
  const view = await open();

  await view.locator("#to-area").click();
  await view.locator("#create-title").fill("Health");
  await view.locator("#create-submit").click();

  // Wait for the decision to land before reading the disk; the renderer only
  // advances once the write is durable (FR-019).
  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("areas/health.md")).toContain("# Health");
});
