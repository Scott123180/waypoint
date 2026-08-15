import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The WIP refusal reaches the screen with its remediation intact (FR-046,
 * US3/AC1, SC-012).
 *
 * The refusal's whole value is naming what to finish or park. Core populates
 * `subjects` for exactly that, but a client that renders only `message` shows
 * the user "Finish or park one of these first" followed by nothing — a dead end
 * that reads like a bug in the limit rather than a list the app forgot to draw.
 *
 * No core test can catch that: they all assert on the refusal value, which is
 * correct. This is the third time in this feature that the defect lived at the
 * boundary between `ProjectService` and the renderer, so it is tested where it
 * actually happens.
 */

let h: Harness;

const IDENTITY = "me: Scott Rodgers\n";

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

/** Three of the user's projects active — the default limit — plus a candidate. */
function seedAtTheLimit(): void {
  h.writeVaultFile("identity.md", IDENTITY);
  h.writeVaultFile("projects/roof-repair.md", project("Roof repair", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/q3-hiring.md", project("Q3 hiring plan", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/migrate-build.md", project("Migrate the build", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/candidate.md", project("Candidate", "parked", "Scott Rodgers"));
}

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("the refusal names every project the user could finish or park", async () => {
  seedAtTheLimit();
  await h.openProjects();
  const view = await h.projectsView();

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");

  // The explanation, and then the thing it refers to.
  await expect(view.locator("#project-error")).toContainText("limit is 3");
  for (const title of ["Roof repair", "Q3 hiring plan", "Migrate the build"]) {
    await expect(view.locator("#wip-subjects")).toContainText(title);
  }
});

test("the project stays parked when the change is refused", async () => {
  seedAtTheLimit();
  await h.openProjects();
  const view = await h.projectsView();

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");

  await expect(view.locator("#project-error")).toContainText("limit is 3");
  expect(h.vaultFile("projects/candidate.md")).toContain("status: parked");
});

test("parking one of the named projects makes room, and the list clears", async () => {
  seedAtTheLimit();
  await h.openProjects();
  const view = await h.projectsView();

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");
  await expect(view.locator("#wip-subjects li")).toHaveCount(3);

  // Park one of the three the refusal named, then retry.
  await view.click('[data-project="roof-repair"]');
  await view.selectOption("#status-select", "parked");

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");

  await expect(view.locator("#wip-subjects li")).toHaveCount(0);
  await expect
    .poll(() => h.vaultFile("projects/candidate.md"))
    .toContain("status: active");
});

test("a WIP refusal does not raise the open-milestone confirmation", async () => {
  // The two refusals carry different fields for different reasons. Rendering a
  // WIP block through the confirmation path would offer to complete the very
  // project the user was trying to activate.
  seedAtTheLimit();
  await h.openProjects();
  const view = await h.projectsView();

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");

  await expect(view.locator("#wip-subjects li")).toHaveCount(3);
  await expect(view.locator("#confirm")).toBeHidden();
});

test("the driving note says how much is being driven", async () => {
  seedAtTheLimit();
  await h.openProjects();
  const view = await h.projectsView();

  await expect(view.locator("#load-note")).toContainText("Driving 3");
});

test("with no identity configured the note says so, and nothing is refused", async () => {
  // A silent limit and a satisfied limit look identical otherwise (FR-031).
  h.writeVaultFile("projects/roof-repair.md", project("Roof repair", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/q3-hiring.md", project("Q3 hiring plan", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/migrate-build.md", project("Migrate the build", "active", "Scott Rodgers"));
  h.writeVaultFile("projects/candidate.md", project("Candidate", "parked", "Scott Rodgers"));

  await h.openProjects();
  const view = await h.projectsView();

  await expect(view.locator("#load-note")).toContainText("No identity set");

  await view.click('[data-project="candidate"]');
  await view.selectOption("#status-select", "active");

  await expect(view.locator("#wip-subjects li")).toHaveCount(0);
  // Wait on an observable UI change before reading the file: `selectOption`
  // returns as soon as the event fires, well before the write lands.
  await expect(view.locator("#project-error")).toHaveText("");
  await expect
    .poll(() => h.vaultFile("projects/candidate.md"))
    .toContain("status: active");
});
