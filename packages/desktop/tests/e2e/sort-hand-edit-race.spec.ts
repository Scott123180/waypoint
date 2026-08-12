import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { launch, type Harness } from "./harness";

/**
 * FR-020a/b, SC-004a: the inbox is a file the user edits. A decision made
 * against a stale view must be refused with nothing written anywhere.
 */

let h: Harness;
test.afterEach(async () => { await h?.close(); });

test("editing the shown item mid-decision refuses and writes nothing", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 original wording\nsecond\n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toHaveText("original wording");

  // The user rewords that exact line in their editor, before deciding.
  writeFileSync(h.inboxPath, "- 2026-08-09T14:23:05-04:00 REWORDED by hand\nsecond\n");

  await view.locator("#to-trash").click();

  await expect(view.locator("#notice")).toContainText("changed on disk");
  // Re-presented as it now reads.
  await expect(view.locator("#text")).toHaveText("REWORDED by hand");
  // Nothing was written anywhere.
  expect(h.vaultFile("trash.md")).toBe("");
  expect(h.inbox()).toBe("- 2026-08-09T14:23:05-04:00 REWORDED by hand\nsecond\n");
});

test("deleting the item on disk mid-decision is handled without loss", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 doomed\nsurvivor\n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toHaveText("doomed");
  writeFileSync(h.inboxPath, "survivor\n");

  await view.locator("#to-calendar").click();

  await expect(view.locator("#text")).toHaveText("survivor");
  expect(h.vaultFile("calendar.md")).toBe("");
  expect(h.inbox()).toBe("survivor\n");
});

test("an unrelated edit elsewhere does not silently corrupt the file", async () => {
  h = await launch();
  h.writeInbox("- 2026-08-09T14:23:05-04:00 first\nsecond\n");
  await h.openSort();
  const view = await h.sortView();

  await expect(view.locator("#text")).toHaveText("first");
  // Appending below shifts nothing above it, so the decision still applies.
  writeFileSync(h.inboxPath, "- 2026-08-09T14:23:05-04:00 first\nsecond\nappended later\n");

  await view.locator("#to-trash").click();
  // Await the decision landing before reading the disk.
  await expect(view.locator("#text")).toHaveText("second");

  const after = h.inbox();
  expect(after).toContain("second");
  expect(after).toContain("appended later");
  expect(after).not.toContain("first");
});
