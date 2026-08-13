import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * User Story 1 end to end: a stub becomes a structured project, in pieces.
 *
 * Covers quickstart §1, §3, §4, §11.
 *
 * Written before the projects view exists, so its first failure is "there is no
 * projects view to open" — which is the correct red for the window, IPC, and
 * renderer tasks that follow (Principle I).
 */

let h: Harness;

const STUB = "# Roof repair\n\nstatus: active\n";

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("a bare stub opens with every field visibly unset and nothing demanded", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();

  await view.click('[data-project="roof-repair"]');

  // Not hidden — the user must be able to see what is missing without
  // consulting the flag (FR-026).
  await expect(view.locator("#project-outcome")).toContainText("not yet set");
  await expect(view.locator("#project-next-action")).toContainText("not yet set");
  await expect(view.locator("#project-dri")).toContainText("not yet set");

  // The flag names what is missing, rather than only that something is
  // (FR-022).
  const gaps = view.locator("#gaps-line");
  await expect(gaps).toContainText("outcome");
  await expect(gaps).toContainText("milestones");
  await expect(gaps).toContainText("next action");
});

test("setting the outcome alone persists, and demands nothing else", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await view.fill("#outcome-input", "The roof survives a winter with no leak.");
  await view.click("#outcome-save");

  await expect(view.locator("#project-outcome")).toContainText("survives a winter");

  const file = () => h.vaultFile("projects/roof-repair.md");
  await expect.poll(file).toContain("## Outcome");
  expect(file()).toContain("status: active");
  expect(file()).not.toContain("next action:");
});

test("structure added across separate visits all persists", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);

  await h.openProjects();
  let view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');
  await view.fill("#outcome-input", "No more leak.");
  await view.click("#outcome-save");

  // Close the view entirely and come back, the way a real session ends.
  await h.closeProjects();
  await h.openProjects();
  view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await view.fill("#next-action-input", "Call the roofer");
  await view.click("#next-action-save");
  await view.fill("#dri-input", "me");
  await view.click("#dri-save");

  // Each of these is polled: `click()` returns when the event is dispatched,
  // not when the write it triggers has landed, so reading the file straight
  // after the last click races the app rather than testing it.
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("No more leak.");
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("next action: Call the roofer");
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("dri: me");
});

test("a single milestone is accepted and not warned about", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await view.fill("#milestone-input", "Estimate approved by insurer");
  await view.fill("#verifier-input", "Priya");
  await view.click("#milestone-add");

  await expect(view.locator(".milestone")).toHaveCount(1);
  await expect(view.locator("#gaps-line")).not.toContainText("milestones");
  await expect(view.locator("#milestone-error")).toBeEmpty();
});

test("the fifth milestone is refused, and the four already there are untouched", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  for (const n of [1, 2, 3, 4]) {
    await view.fill("#milestone-input", `M${n}`);
    await view.click("#milestone-add");
    await expect(view.locator(".milestone")).toHaveCount(n);
  }

  await view.fill("#milestone-input", "A fifth");
  await view.click("#milestone-add");

  await expect(view.locator("#milestone-error")).toContainText(/four/i);
  await expect(view.locator(".milestone")).toHaveCount(4);
  expect(h.vaultFile("projects/roof-repair.md")).not.toContain("A fifth");
});

test("unprocessed items are shown beside the fields and never auto-filled", async () => {
  h.writeVaultFile(
    "projects/roof-repair.md",
    `${STUB}\n## Unprocessed\n\n- 2026-08-11T09:14:02-04:00 Call the roofer back\n- Buy a tarp\n`,
  );
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await expect(view.locator(".unprocessed-item")).toHaveCount(2);
  await expect(view.locator("#project-outcome")).toContainText("not yet set");
  await expect(view.locator("#project-next-action")).toContainText("not yet set");
});

test("dismissing a handled item removes it and keeps it findable in trash", async () => {
  h.writeVaultFile(
    "projects/roof-repair.md",
    `${STUB}\n## Unprocessed\n\n- 2026-08-11T09:14:02-04:00 Call the roofer back\n- Buy a tarp\n`,
  );
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await view.locator(".unprocessed-item").first().locator(".dismiss").click();

  await expect(view.locator(".unprocessed-item")).toHaveCount(1);
  await expect(view.locator(".unprocessed-item")).toContainText("Buy a tarp");

  await expect.poll(() => h.vaultFile("trash.md")).toContain("Call the roofer back");
  expect(h.vaultFile("trash.md")).toContain("2026-08-11T09:14:02-04:00");
});

test("a project can be renamed, and an empty title is refused", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await view.fill("#title-input", "Roof repair (phase two)");
  await view.click("#title-save");
  await expect(view.locator("#project-title")).toHaveText("Roof repair (phase two)");
  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("# Roof repair (phase two)");

  // The slug is the identity, so renaming must not move the file.
  expect(h.vaultFile("projects/roof-repair.md")).not.toBe("");

  // A title is one of the two fields always present (FR-003).
  await view.fill("#title-input", "   ");
  await view.click("#title-save");
  await expect(view.locator("#project-error")).toContainText(/title/i);
  expect(h.vaultFile("projects/roof-repair.md")).toContain("# Roof repair (phase two)");
});
