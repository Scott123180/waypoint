import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

const SEED =
  "- 2026-08-09T14:23:05-04:00 Book flights for the offsite\n" +
  "- 2026-08-09T14:31:12-04:00 Pick a venue\n";

let h: Harness;
test.afterEach(async () => { await h?.close(); });

async function open(seed = SEED) {
  h = await launch();
  h.writeInbox(seed);
  await h.openSort();
  return h.sortView();
}

test("a single letter files the item, no pointer involved", async () => {
  const view = await open();

  await view.locator("body").press("c");
  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("calendar.md")).toContain("Book flights for the offsite");

  await view.locator("body").press("t");
  await expect(view.locator("#empty")).toBeVisible();
  expect(h.vaultFile("trash.md")).toContain("Pick a venue");
});

test("letters that open a panel hand the keyboard to it", async () => {
  const view = await open();

  await view.locator("body").press("w");
  await expect(view.locator("#waiting-owner")).toBeFocused();

  // "t" here is part of a name, not the trash shortcut.
  await view.locator("#waiting-owner").fill("Matt");
  await view.locator("#waiting-owner").press("Enter");

  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("waiting.md")).toContain("Matt");
  expect(h.vaultFile("trash.md")).toBe("");
});

test("Esc backs out of a panel before it closes the window", async () => {
  const view = await open();

  await view.locator("body").press("p");
  await expect(view.locator("#create-title")).toBeVisible();

  await view.locator("#create-title").press("Escape");
  await expect(view.locator("#create-title")).toHaveCount(0);

  // Still sorting the same item — backing out decided nothing.
  await expect(view.locator("#text")).toHaveText("Book flights for the offsite");
  expect(h.inbox()).toContain("Book flights for the offsite");
});

test("typing narrows the destinations without reordering them", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/march-offsite.md", "# March offsite\n\nstatus: active\n");
  h.writeVaultFile("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n");
  h.writeVaultFile("projects/tax-return.md", "# Tax return\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("body").press("p");
  await expect(view.locator("#panel .list button")).toHaveCount(3);

  // Matching is on any part of the title, so "re" reaches "repair" and
  // "return" but not "March offsite" — and the core's order is kept.
  await view.locator("#create-title").fill("re");
  await expect(view.locator("#panel .list button")).toHaveText(["Roof repair", "Tax return"]);

  await view.locator("#create-title").fill("roof");
  await expect(view.locator("#panel .list button")).toHaveText(["Roof repair"]);

  // A filter is not a selection: the match still has to be chosen.
  await view.locator('#panel button[data-slug="roof-repair"]').click();
  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("projects/roof-repair.md")).toContain("Book flights for the offsite");
});

test("a filter matching nothing offers to create exactly what was typed", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("body").press("p");
  await view.locator("#create-title").fill("Kitchen rebuild");

  await expect(view.locator("#panel .list button")).toHaveCount(0);
  await expect(view.locator("#panel .none")).toBeVisible();
  await expect(view.locator("#create-submit")).toHaveText('Create “Kitchen rebuild”');

  await view.locator("#create-title").press("Enter");
  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("projects/kitchen-rebuild.md")).toContain("Book flights for the offsite");
});

test("Enter creates rather than filing into a destination the title is inside of", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("areas/health-insurance.md", "# Health insurance\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("body").press("a");
  await view.locator("#create-title").fill("Health");
  // "Health" matches "Health insurance", so a filter that auto-selected its
  // single match would file this into the wrong area.
  await expect(view.locator("#panel .list button")).toHaveCount(1);

  await view.locator("#create-title").press("Enter");

  // Wait for the decision to land before reading disk: the renderer only
  // advances once the write is durable (FR-019).
  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("areas/health.md")).toContain("Book flights for the offsite");
  expect(h.vaultFile("areas/health-insurance.md")).not.toContain("Book flights");
});

test("arrow keys reach the list and back without touching the mouse", async () => {
  h = await launch();
  h.writeInbox(SEED);
  h.writeVaultFile("projects/alpha.md", "# Alpha\n\nstatus: active\n");
  h.writeVaultFile("projects/beta.md", "# Beta\n\nstatus: active\n");
  await h.openSort();
  const view = await h.sortView();

  await view.locator("body").press("p");
  await view.locator("#create-title").press("ArrowDown");
  await expect(view.locator('#panel button[data-slug="alpha"]')).toBeFocused();

  await view.locator('#panel button[data-slug="alpha"]').press("ArrowDown");
  await expect(view.locator('#panel button[data-slug="beta"]')).toBeFocused();

  await view.locator('#panel button[data-slug="beta"]').press("ArrowUp");
  await expect(view.locator('#panel button[data-slug="alpha"]')).toBeFocused();

  await view.locator('#panel button[data-slug="alpha"]').press("ArrowUp");
  await expect(view.locator("#create-title")).toBeFocused();

  await view.locator("#create-title").press("ArrowDown");
  await view.locator('#panel button[data-slug="alpha"]').press("Enter");

  await expect(view.locator("#text")).toHaveText("Pick a venue");
  expect(h.vaultFile("projects/alpha.md")).toContain("Book flights for the offsite");
});

test("the progress bar fills as the pile shrinks", async () => {
  const view = await open(
    Array.from({ length: 4 }, (_, i) => `- 2026-08-09T14:00:0${i}-04:00 item ${i}\n`).join(""),
  );

  const width = () =>
    view.locator("#progress i").evaluate((el) => (el as HTMLElement).style.width);

  expect(await width()).toBe("0%");
  await view.locator("body").press("c");
  await expect(view.locator("#text")).toHaveText("item 1");
  expect(await width()).toBe("25%");

  // One decision at a time: a keypress arriving mid-write is dropped, not
  // queued, so each has to land before the next (FR-019).
  for (const next of ["item 2", "item 3"]) {
    await view.locator("body").press("c");
    await expect(view.locator("#text")).toHaveText(next);
  }
  await view.locator("body").press("c");

  await expect(view.locator("#empty")).toBeVisible();
  expect(await width()).toBe("100%");
});
