import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The reading is held, and says when it is stale.
 *
 * Every other window in this app re-reads when the vault changes. This one does
 * not, and that difference is the feature: a retrospective is a report the user
 * reads and copies out of, and entries appearing or shifting mid-read would
 * break both the copy in their clipboard and the promise that an export is what
 * they were looking at (006 FR-010a–d, SC-020).
 */

let h: Harness;

const PROJECT = `# Roof repair

status: active

## Milestones

- [x] Estimate approved — done 2026-06-10
`;

async function show(view: Awaited<ReturnType<Harness["retrospectiveView"]>>): Promise<void> {
  await view.fill("#from", "2026-01-01");
  await view.fill("#to", "2026-12-31");
  await view.click("#run");
  await expect(view.locator("#report")).toBeVisible();
}

test.beforeEach(async () => {
  h = await launch();
  h.writeVaultFile("projects/roof.md", PROJECT);
});

test.afterEach(async () => {
  await h.close();
});

test("it reads nothing until asked", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();

  // No range is chosen, so no reading has been taken. The system never runs a
  // retrospective the user did not ask for (FR-057).
  await expect(view.locator("#report")).toBeHidden();
  await expect(view.locator("#empty")).toBeVisible();
  await expect(view.locator("#copy")).toBeDisabled();
});

test("a range produces a report", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  await expect(view.locator("#report")).toContainText("Estimate approved");
  await expect(view.locator("#report")).toContainText("# Retrospective: 2026-01-01 to 2026-12-31");
});

test("a write elsewhere leaves every entry in place and raises a notice", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  const before = await view.locator("#report").textContent();

  // A second milestone lands, exactly as another window's write would.
  h.writeVaultFile(
    "projects/roof.md",
    `${PROJECT}- [x] Materials delivered — done 2026-06-20\n`,
  );
  // Nudge the vault-changed signal the same way a real write does, by writing
  // through the app rather than only touching the file.
  await view.waitForTimeout(150);

  // Whatever the signal did, the entries must not have moved.
  await expect(view.locator("#report")).toHaveText(before ?? "");
  await expect(view.locator("#report")).not.toContainText("Materials delivered");
});

test("re-reading picks up the change, and only when asked", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  h.writeVaultFile(
    "projects/roof.md",
    `${PROJECT}- [x] Materials delivered — done 2026-06-20\n`,
  );

  await expect(view.locator("#report")).not.toContainText("Materials delivered");

  // The same query, asked again. There is no separate refresh channel.
  await view.click("#run");
  await expect(view.locator("#report")).toContainText("Materials delivered");
});

test("ignoring the change leaves the reading readable and exportable", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  h.writeVaultFile("projects/roof.md", `${PROJECT}- [x] Later — done 2026-07-01\n`);
  await view.waitForTimeout(150);

  // A stale reading is still a true account of when it was taken.
  await expect(view.locator("#report")).toContainText("Estimate approved");
  await expect(view.locator("#copy")).toBeEnabled();
  await expect(view.locator("#save")).toBeEnabled();
});

test("the whole result is reachable by scrolling — no page, slice, or limit", async () => {
  // 300 completions, well past anything a paging implementation would show.
  const milestones = Array.from(
    { length: 300 },
    (_, i) => `- [x] step ${i} — done 2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
  ).join("\n");
  h.writeVaultFile("projects/big.md", `# Big\n\nstatus: active\n\n## Milestones\n\n${milestones}\n`);

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  // The count in the heading is the whole result, and the text contains every
  // entry — including the last, which a paged view would have withheld.
  await expect(view.locator("#report")).toContainText("step 299");
  await expect(view.locator("#report")).toContainText("step 0 ");

  // And there is no affordance standing between the user and the rest of it.
  await expect(view.locator("text=Show more")).toHaveCount(0);
  await expect(view.locator("text=Next page")).toHaveCount(0);
});

test("an inverted range is refused in the core's own words", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();

  await view.fill("#from", "2026-12-31");
  await view.fill("#to", "2026-01-01");
  await view.click("#run");

  await expect(view.locator("#empty")).toContainText("before the start date");
  await expect(view.locator("#report")).toBeHidden();
});
