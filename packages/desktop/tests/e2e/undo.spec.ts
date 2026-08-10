import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { launch, waitForHidden, waitForInbox, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

async function dictateAndSubmit(text: string): Promise<void> {
  await h.trigger();
  const box = await h.captureBox();
  await h.dictate(text);
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);
  await waitForInbox(h, text);
}

test("undo removes a just-dictated capture", async () => {
  await dictateAndSubmit("a spoken thought");

  const result = await h.undo();
  expect(result).toEqual({ ok: true });
  expect(h.inbox()).toBe("");
});

test("undo leaves the rest of the file byte-identical", async () => {
  const handWritten = "# My inbox\n\n- something I wrote myself\n";
  writeFileSync(h.inboxPath, handWritten);

  await dictateAndSubmit("a spoken thought");
  await h.undo();

  expect(readFileSync(h.inboxPath, "utf8")).toBe(handWritten);
});

test("undo refuses after the file was hand-edited, and preserves the edit", async () => {
  await dictateAndSubmit("a spoken thought");

  const handAdded = "- a line I added by hand\n";
  writeFileSync(h.inboxPath, readFileSync(h.inboxPath, "utf8") + handAdded);

  const result = await h.undo();

  // Deleting here would destroy a line the user wrote between capture and undo.
  expect(result).toEqual({ ok: false, reason: "file-changed" });
  const after = readFileSync(h.inboxPath, "utf8");
  expect(after).toContain(handAdded);
  expect(after).toContain("a spoken thought");
});

test("undo is not offered for a typed capture", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "a typed thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);
  await waitForInbox(h, "a typed thought");

  expect(await h.undoableId()).toBeUndefined();
});

test("undo expires once the next capture begins", async () => {
  await dictateAndSubmit("first spoken thought");
  await dictateAndSubmit("second spoken thought");

  // Only the most recent capture is ever undoable.
  const content = h.inbox();
  expect(content).toContain("first spoken thought");
  expect(content).not.toContain("second spoken thought\n- ");
});
