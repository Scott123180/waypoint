import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * User Story 4 end to end: areas stay ongoing and unstructured.
 *
 * Covers quickstart §12.
 */

let h: Harness;

const AREA = `# Home maintenance

status: active

## Unprocessed

- 2026-08-11T14:02:55-04:00 Gutters need clearing before autumn
`;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

async function openArea() {
  h.writeVaultFile("areas/home-maintenance.md", AREA);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-area="home-maintenance"]');
  return view;
}

test("an area shows a title and a status and no structure at all", async () => {
  const view = await openArea();

  await expect(view.locator("#area-title")).toContainText("Home maintenance");

  // Not "shows them as empty" — the affordances must not exist.
  await expect(view.locator("#outcome-input")).toBeHidden();
  await expect(view.locator("#milestone-add")).toBeHidden();
  await expect(view.locator("#next-action-input")).toBeHidden();
  await expect(view.locator("#dri-input")).toBeHidden();
});

test("an area offers exactly two statuses, neither of them done", async () => {
  const view = await openArea();
  const options = view.locator("#area-status-select option");

  await expect(options).toHaveCount(2);
  await expect(options).toHaveText(["active", "parked"]);
});

test("an area is never flagged as needing structure", async () => {
  const view = await openArea();
  await expect(view.locator('[data-area="home-maintenance"] [data-flag]')).toHaveCount(0);
});

test("its status can be changed between active and parked", async () => {
  const view = await openArea();
  await view.selectOption("#area-status-select", "parked");

  await expect.poll(() => h.vaultFile("areas/home-maintenance.md")).toContain("status: parked");
});

test("routed items are shown and can be dismissed", async () => {
  const view = await openArea();
  await expect(view.locator("#area-unprocessed-list .unprocessed-item")).toHaveCount(1);

  await view.locator("#area-unprocessed-list .dismiss").first().click();

  await expect(view.locator("#area-unprocessed-list .unprocessed-item")).toHaveCount(0);
  await expect.poll(() => h.vaultFile("trash.md")).toContain("Gutters need clearing");
});

test("projects and areas are visibly distinct, and only projects carry structure", async () => {
  h.writeVaultFile("areas/home-maintenance.md", AREA);
  h.writeVaultFile("projects/roof.md", "# Roof repair\n\nstatus: active\n");
  await h.openProjects();
  const view = await h.projectsView();

  await expect(view.locator('[data-area="home-maintenance"]')).toHaveCount(1);
  await expect(view.locator('[data-project="roof"]')).toHaveCount(1);

  await view.click('[data-project="roof"]');
  await expect(view.locator("#milestone-add")).toBeVisible();

  await view.click('[data-area="home-maintenance"]');
  await expect(view.locator("#milestone-add")).toBeHidden();
});

test("a hand-edited out-of-range status is shown as recorded, not rewritten", async () => {
  h.writeVaultFile(
    "areas/home-maintenance.md",
    "# Home maintenance\n\nstatus: done\n\n## Milestones\n\n- [ ] Does not belong here\n",
  );
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-area="home-maintenance"]');

  await expect(view.locator("#area-raw-status")).toContainText("done");

  // Reading it must not have repaired the file, and the stray section survives.
  const file = h.vaultFile("areas/home-maintenance.md");
  expect(file).toContain("status: done");
  expect(file).toContain("- [ ] Does not belong here");
});
