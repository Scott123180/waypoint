import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The weekly top three, end to end.
 *
 * Covers the quickstart's manual walkthrough: set a week, hit the cap, complete
 * an outcome, and see a past week rendered as a record. Everything asserted
 * here is a decision the core made and the renderer only displayed — which
 * week is current, whether the cap was reached, and what the refusal says.
 */

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("an empty week invites a top three and accepts one outcome", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  await expect(view.locator("#empty")).toBeVisible();

  await view.fill("#add-text", "Decide the license");
  await view.click("#add");

  await expect(view.locator("#current li.outcome")).toHaveCount(1);
  await expect(view.locator("#current")).toContainText("Decide the license");
  // One is a complete top three — two and three are not required.
  await expect(view.locator("#empty")).toBeHidden();
});

test("the cap refuses a fourth and leaves the three alone", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  for (const text of ["First", "Second", "Third"]) {
    await view.fill("#add-text", text);
    await view.click("#add");
  }
  await expect(view.locator("#current li.outcome")).toHaveCount(3);

  await view.fill("#add-text", "Fourth");
  await view.click("#add");

  await expect(view.locator("#current li.outcome")).toHaveCount(3);
  await expect(view.locator("#error")).toContainText("at most three");
  // The refused text stays where the user typed it rather than making them
  // type it again.
  await expect(view.locator("#add-text")).toHaveValue("Fourth");
});

test("completing an outcome records it, and unchecking clears it", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  await view.fill("#add-text", "Ship the seam");
  await view.click("#add");

  await view.click("#current li.outcome input[type=checkbox]");
  await expect(view.locator("#current li.outcome.done")).toHaveCount(1);
  await expect(view.locator("#current li.outcome .date")).toHaveCount(1);

  await view.click("#current li.outcome input[type=checkbox]");
  await expect(view.locator("#current li.outcome.done")).toHaveCount(0);
  await expect(view.locator("#current li.outcome .date")).toHaveCount(0);
});

test("editing an outcome changes only that one", async () => {
  await h.openTopThree();
  const view = await h.topThreeView();

  for (const text of ["First", "Second"]) {
    await view.fill("#add-text", text);
    await view.click("#add");
  }

  await view.locator("#current li.outcome").first().getByText("Edit").click();
  await view.locator("#current li.outcome input[type=text]").fill("First, revised");
  await view.getByText("Save").click();

  await expect(view.locator("#current")).toContainText("First, revised");
  await expect(view.locator("#current")).toContainText("Second");
});

test("a past week is shown as a record, with no way to edit it", async () => {
  // Written by hand into the vault, which is also the point: the file is the
  // source of truth and the app reads whatever is there.
  h.writeVaultFile(
    "top-three.md",
    ["# Top three", "", "## 2020-W01", "", "- [x] Something old — done 2020-01-02", ""].join("\n"),
  );

  await h.openTopThree();
  const view = await h.topThreeView();

  await expect(view.locator("#past-section")).toBeVisible();
  await expect(view.locator("#past")).toContainText("2020-W01");
  await expect(view.locator("#past")).toContainText("Something old");

  // No checkbox, no Edit, no Remove — the app declines to rewrite history,
  // though the file itself stays hand-editable.
  await expect(view.locator("#past input[type=checkbox]")).toHaveCount(0);
  await expect(view.locator("#past button")).toHaveCount(0);
});

test("history is kept when the current week is set", async () => {
  h.writeVaultFile(
    "top-three.md",
    ["# Top three", "", "## 2020-W01", "", "- [x] Something old — done 2020-01-02", ""].join("\n"),
  );

  await h.openTopThree();
  const view = await h.topThreeView();

  await view.fill("#add-text", "Something new");
  await view.click("#add");

  await expect(view.locator("#current")).toContainText("Something new");
  await expect(view.locator("#past")).toContainText("Something old");
  expect(h.vaultFile("top-three.md")).toContain("- [x] Something old — done 2020-01-02");
});
