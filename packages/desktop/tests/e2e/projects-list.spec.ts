import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * User Story 3 end to end: which projects need structure, visible at a glance.
 *
 * Covers quickstart §8, §9.
 */

let h: Harness;

const full = `# Full

status: active
next action: Do the thing
dri: me

## Outcome

Done means done.

## Milestones

- [ ] One — @me
`;

const noOutcome = full.replace(/## Outcome\n\nDone means done\.\n\n/, "");
const noAction = full.replace("next action: Do the thing\n", "");
const noMilestones = full.replace(/## Milestones\n\n- \[ \] One — @me\n/, "");
const noDri = full.replace("dri: me\n", "");
const stub = "# Stub\n\nstatus: active\n";

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

async function seedAll() {
  h.writeVaultFile("projects/full.md", full);
  h.writeVaultFile("projects/no-outcome.md", noOutcome.replace("# Full", "# No outcome"));
  h.writeVaultFile("projects/no-action.md", noAction.replace("# Full", "# No action"));
  h.writeVaultFile("projects/no-milestones.md", noMilestones.replace("# Full", "# No milestones"));
  h.writeVaultFile("projects/no-dri.md", noDri.replace("# Full", "# No DRI"));
  h.writeVaultFile("projects/stub.md", stub);
  await h.openProjects();
  return h.projectsView();
}

test("exactly the incomplete projects are flagged, without opening any of them", async () => {
  const view = await seedAll();

  for (const slug of ["no-outcome", "no-action", "no-milestones", "stub"]) {
    await expect(
      view.locator(`[data-project="${slug}"] [data-flag]`),
      `${slug} should be flagged`,
    ).toHaveCount(1);
  }

  for (const slug of ["full", "no-dri"]) {
    await expect(
      view.locator(`[data-project="${slug}"] [data-flag]`),
      `${slug} should not be flagged`,
    ).toHaveCount(0);
  }
});

test("a missing DRI never flags", async () => {
  const view = await seedAll();
  await expect(view.locator('[data-project="no-dri"] [data-flag]')).toHaveCount(0);
});

test("the list shows status and milestone progress without opening a project", async () => {
  const view = await seedAll();
  await expect(view.locator('[data-project="full"]')).toContainText("active");
  await expect(view.locator('[data-project="full"]')).toContainText("0 of 1 done");
});

test("supplying the last missing piece clears the flag with no separate step", async () => {
  const view = await seedAll();
  await view.click('[data-project="no-action"]');

  await view.fill("#next-action-input", "Now there is one");
  await view.click("#next-action-save");

  await expect(view.locator('[data-project="no-action"] [data-flag]')).toHaveCount(0);
  await expect(view.locator("#gaps-line")).toBeEmpty();
});

test("a hand-edit flips the flag, with the app uninvolved in making it true", async () => {
  const view = await seedAll();
  await expect(view.locator('[data-project="full"] [data-flag]')).toHaveCount(0);

  h.writeVaultFile("projects/full.md", full.replace("next action: Do the thing\n", ""));
  await h.closeProjects();
  await h.openProjects();

  await expect(view.locator('[data-project="full"] [data-flag]')).toHaveCount(1);
});

test("every operation works on a flagged project exactly as on an unflagged one", async () => {
  const view = await seedAll();
  await view.click('[data-project="stub"]');

  // Nothing here may be gated, warned about, or given an extra confirmation.
  await view.fill("#outcome-input", "An outcome");
  await view.click("#outcome-save");
  await expect(view.locator("#project-outcome")).toContainText("An outcome");

  await view.fill("#milestone-input", "A milestone");
  await view.click("#milestone-add");
  await expect(view.locator(".milestone")).toHaveCount(1);

  await view.selectOption("#status-select", "parked");
  await expect.poll(() => h.vaultFile("projects/stub.md")).toContain("status: parked");

  await expect(view.locator("#project-error")).toBeEmpty();
});

test("a bare stub can be marked done with no confirmation at all", async () => {
  const view = await seedAll();
  await view.click('[data-project="stub"]');
  await view.selectOption("#status-select", "done");

  // No milestones are open, so nothing is asked — the flag is not a gate.
  await expect(view.locator("#confirm")).toBeHidden();
  await expect.poll(() => h.vaultFile("projects/stub.md")).toContain("status: done");
});
