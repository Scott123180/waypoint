import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * User Story 2 end to end: driving a project to done, and the record it leaves.
 *
 * Covers quickstart §5, §6, §7.
 */

let h: Harness;

const FOUR_MILESTONES = `# Roof repair

status: active
next action: Call the roofer
dri: me

## Outcome

No more leak.

## Milestones

- [ ] Estimate approved — @Priya
- [ ] Materials on site — @me
- [ ] Work done — @me
- [ ] Claim paid — @Priya
`;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

async function openRoof() {
  h.writeVaultFile("projects/roof-repair.md", FOUR_MILESTONES);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');
  return view;
}

test("completing two of four keeps both visible and reports 2 of 4", async () => {
  const view = await openRoof();

  await view.locator(".milestone input[type=checkbox]").nth(0).check();
  await view.locator(".milestone input[type=checkbox]").nth(1).check();

  // Nothing disappears — the point is seeing what is done and what remains.
  await expect(view.locator(".milestone")).toHaveCount(4);
  await expect(view.locator("#milestone-progress")).toContainText("2 of 4 done");
  await expect(view.locator(".milestone.done")).toHaveCount(2);
});

test("a completed milestone records the date, with no prompt", async () => {
  const view = await openRoof();
  await view.locator(".milestone input[type=checkbox]").first().check();

  await expect(view.locator(".milestone").first()).toContainText(/done \d{4}-\d{2}-\d{2}/);
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toMatch(/- \[x\] Estimate approved/);
});

test("marking done with open milestones asks rather than refuses", async () => {
  const view = await openRoof();
  await view.selectOption("#status-select", "done");

  const confirm = view.locator("#confirm");
  await expect(confirm).toBeVisible();
  // The names come from the refusal the core returned; the client computes none.
  await expect(confirm).toContainText("Estimate approved");
  await expect(confirm).toContainText("Claim paid");
});

test("declining the confirmation changes nothing", async () => {
  const view = await openRoof();
  const before = h.vaultFile("projects/roof-repair.md");

  await view.selectOption("#status-select", "done");
  await view.click("#confirm-no");

  await expect(view.locator("#confirm")).toBeHidden();
  expect(h.vaultFile("projects/roof-repair.md")).toBe(before);
});

test("confirming completes the project and leaves the open milestones open", async () => {
  const view = await openRoof();
  await view.selectOption("#status-select", "done");
  await view.click("#confirm-yes");

  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toMatch(/^completed: \d{4}-\d{2}-\d{2}$/m);
  const file = h.vaultFile("projects/roof-repair.md");
  expect(file).toContain("status: done");
  // No date is invented for work that never finished.
  expect(file).toContain("- [ ] Estimate approved — @Priya");
  expect(file).not.toMatch(/- \[ \].*done \d{4}/);
});

test("a completed project leaves the active list, and reopening brings it back", async () => {
  const view = await openRoof();
  await view.selectOption("#status-select", "done");
  await view.click("#confirm-yes");

  await expect(view.locator('[data-project="roof-repair"]')).toHaveCount(0);

  // Reopen by hand-editing the file, then reopening the view: the list is
  // derived from disk, so this is the honest way to prove it.
  h.writeVaultFile(
    "projects/roof-repair.md",
    h.vaultFile("projects/roof-repair.md").replace("status: done", "status: active"),
  );
  await h.closeProjects();
  await h.openProjects();

  await expect(view.locator('[data-project="roof-repair"]')).toHaveCount(1);
});

test("a project whose milestones are all done completes with no confirmation", async () => {
  const view = await openRoof();
  for (const i of [0, 1, 2, 3]) {
    await view.locator(".milestone input[type=checkbox]").nth(i).check();
    await expect(view.locator(".milestone.done")).toHaveCount(i + 1);
  }

  await view.selectOption("#status-select", "done");

  await expect(view.locator("#confirm")).toBeHidden();
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("status: done");
});

test("editing a completed milestone keeps its date", async () => {
  const view = await openRoof();
  await view.locator(".milestone input[type=checkbox]").first().check();
  await expect(view.locator(".milestone").first()).toContainText(/done \d{4}/);

  // Any unrelated edit: the date must survive it.
  await view.fill("#dri-input", "Alex");
  await view.click("#dri-save");

  await expect(view.locator(".milestone").first()).toContainText(/done \d{4}/);
});
