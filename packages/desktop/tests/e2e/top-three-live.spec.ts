import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * An open top-three view reflects writes to the vault (research R9).
 *
 * The point of this test is that it needed no new wiring. `top-three.md` is
 * written through the same `VaultStore` as every project file, and that adapter
 * raises the generic `vault:changed` signal from its write path — so a write
 * from any window, or later from the local API, reaches every open view
 * without any writer having to remember who is listening.
 *
 * As in `projects-refresh.spec.ts`, the second half records the deliberate
 * limit: `fs.watch` is *not* used, so an edit made in a text editor is invisible
 * until the view reopens. Asserting it here keeps it a decision rather than a
 * bug report.
 */

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("a write through the app updates the open view without reopening it", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  await view.fill("#add-text", "First");
  await view.click("#add");
  await expect(view.locator("#current li.outcome")).toHaveCount(1);

  await view.fill("#add-text", "Second");
  await view.click("#add");
  await expect(view.locator("#current li.outcome")).toHaveCount(2);
  expect(h.vaultFile("top-three.md")).toContain("- [ ] Second");
});

test("the projects view and the top three share one signal", async () => {
  // Both subscribe to `vault:changed`, neither knows what the other wrote.
  h.writeVaultFile("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n");

  await h.openTopThree();
  await h.openProjects();

  const topThree = await h.topThreeView();
  const projects = await h.projectsView();

  await topThree.fill("#add-text", "Set this week");
  await topThree.click("#add");

  // The projects view re-reads on the same signal. Nothing about a top-three
  // write is special to it; it simply asks the vault again.
  await expect(projects.locator('[data-project="roof-repair"]')).toHaveCount(1);
});

test("an edit made in a text editor waits for the view to reopen", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  await view.fill("#add-text", "From the app");
  await view.click("#add");
  await expect(view.locator("#current")).toContainText("From the app");

  // Written behind the app's back, exactly as vim would.
  h.writeVaultFile(
    "top-three.md",
    ["# Top three", "", "## 2020-W01", "", "- [ ] Typed by hand", ""].join("\n"),
  );

  // Deliberately still showing what it last read: there is no file watcher.
  await expect(view.locator("#current")).toContainText("From the app");

  // Reopening re-reads from disk, which is the documented way back.
  await h.openTopThree();
  await expect(view.locator("#past")).toContainText("Typed by hand");
});
