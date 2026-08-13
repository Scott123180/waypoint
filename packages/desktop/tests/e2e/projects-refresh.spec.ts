import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * An open view reflects writes, and the one limit that is deliberate.
 *
 * Covers quickstart §13. The second half of this file is as important as the
 * first: `fs.watch` is *not* added, so a text-editor edit is invisible until
 * the view reopens. Asserting that limit here keeps it a decision (research R7)
 * rather than something that quietly becomes a bug report.
 */

let h: Harness;

const STUB = "# Roof repair\n\nstatus: active\n";

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("a write through the app updates the open view without reopening it", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  await expect(view.locator('[data-project="roof-repair"] [data-flag]')).toHaveCount(1);

  await view.fill("#outcome-input", "No more leak.");
  await view.click("#outcome-save");
  await view.fill("#next-action-input", "Call the roofer");
  await view.click("#next-action-save");
  await view.fill("#milestone-input", "Estimate approved");
  await view.click("#milestone-add");

  // The list beside the detail updates too — one signal, every subscriber.
  await expect(view.locator('[data-project="roof-repair"] [data-flag]')).toHaveCount(0);
  await expect(view.locator('[data-project="roof-repair"]')).toContainText("0 of 1 done");
});

test("a new project appears in the list as soon as it is created", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();

  await expect(view.locator("[data-project]")).toHaveCount(1);

  h.writeVaultFile("projects/second.md", "# Second\n\nstatus: active\n");
  await h.closeProjects();
  await h.openProjects();

  await expect(view.locator("[data-project]")).toHaveCount(2);
});

test("what the user is typing is not thrown away by a refresh", async () => {
  h.writeVaultFile("projects/roof-repair.md", STUB);
  h.writeVaultFile("projects/other.md", "# Other\n\nstatus: active\n");
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  // Half-typed, not saved.
  await view.fill("#milestone-input", "half a thought");

  // A write elsewhere raises the signal.
  await view.fill("#dri-input", "me");
  await view.click("#dri-save");

  await expect(view.locator("#dri-input")).toHaveValue("me");
});

test("KNOWN LIMIT: a text-editor edit is not reflected until the view reopens", async () => {
  // There is no filesystem watch (research R7). `fs.watch` would narrow this
  // window without closing it, and the guarantee that actually protects the
  // file is the verify-before-write at write time, covered below.
  h.writeVaultFile("projects/roof-repair.md", STUB);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  h.writeVaultFile("projects/roof-repair.md", `${STUB}dri: Sam\n`);

  // Still showing what it read on open.
  await expect(view.locator("#project-dri")).toContainText("not yet set");

  await h.closeProjects();
  await h.openProjects();
  await view.click('[data-project="roof-repair"]');
  await expect(view.locator("#project-dri")).toContainText("Sam");
});

test("a stale write is refused rather than overwriting the hand-edit", async () => {
  h.writeVaultFile("projects/roof-repair.md", `${STUB}dri: me\n`);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');
  await expect(view.locator("#project-dri")).toContainText("me");

  // The user edits the same field in a text editor.
  h.writeVaultFile("projects/roof-repair.md", `${STUB}dri: Sam\n`);

  await view.fill("#dri-input", "Alex");
  await view.click("#dri-save");

  await expect(view.locator("#project-error")).toContainText(/changed on disk/i);
  expect(h.vaultFile("projects/roof-repair.md")).toContain("dri: Sam");
  expect(h.vaultFile("projects/roof-repair.md")).not.toContain("Alex");
});

test("an unrelated hand-edit does not cancel a write, and survives it", async () => {
  h.writeVaultFile("projects/roof-repair.md", `${STUB}dri: me\n`);
  await h.openProjects();
  const view = await h.projectsView();
  await view.click('[data-project="roof-repair"]');

  // A different field changes underneath.
  h.writeVaultFile("projects/roof-repair.md", `${STUB}dri: Sam\n`);

  await view.fill("#outcome-input", "No more leak.");
  await view.click("#outcome-save");

  await expect.poll(() => h.vaultFile("projects/roof-repair.md")).toContain("No more leak.");
  expect(h.vaultFile("projects/roof-repair.md")).toContain("dri: Sam");
});
