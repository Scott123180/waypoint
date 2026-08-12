import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

let h: Harness;
test.afterEach(async () => { await h?.close(); });

test("a hand-written item is routable and shows no timestamp", async () => {
  h = await launch();
  h.writeInbox("Buy milk\n- 2026-08-09T14:23:05-04:00 captured one\n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toHaveText("Buy milk");
  // No date is invented for an item that never had one (FR-027a).
  await expect(view.locator("#captured-at")).toBeEmpty();

  await view.locator("#to-trash").click();
  await expect(view.locator("#captured-at")).not.toBeEmpty();
  expect(h.vaultFile("trash.md")).toContain("Buy milk");
  expect(h.vaultFile("trash.md")).not.toMatch(/Buy milk.*T\d{2}:\d{2}/);
});

test("a markdown heading is an item like any other", async () => {
  h = await launch();
  h.writeInbox("## Someday\n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toHaveText("## Someday");
  await view.locator("#to-trash").click();
  await expect(view.locator("#empty")).toBeVisible();
});

test("a multi-line item moves whole, and blank lines survive", async () => {
  h = await launch();
  h.writeInbox(
    "- 2026-08-09T14:31:12-04:00 Ask Priya whether it moved,\n" +
      "  and tell the rotation.\n\nkeep me\n",
  );
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toContainText("and tell the rotation.");
  await view.locator("#to-trash").click();

  await expect(view.locator("#text")).toHaveText("keep me");
  expect(h.vaultFile("trash.md")).toContain("and tell the rotation.");
  // The blank line belonged to no item, so it survives exactly where the user
  // put it — removing an item must not tidy up their spacing.
  expect(h.inbox()).toBe("\nkeep me\n");
});

test("an inbox written entirely by hand sorts to zero", async () => {
  // SC-009a: no timestamps anywhere in the file.
  h = await launch();
  h.writeInbox("first thought\nsecond thought\n\nthird thought\n");
  await h.openSort();
  const view = await h.sortView();

  for (const expected of ["first thought", "second thought", "third thought"]) {
    await expect(view.locator("#text")).toHaveText(expected);
    await view.locator("#to-trash").click();
  }

  await expect(view.locator("#empty")).toBeVisible();
  expect(h.inbox().trim()).toBe("");
});
