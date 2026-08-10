import { test, expect } from "@playwright/test";
import { launch, waitForHidden, waitForInbox, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("submitting appends the thought and closes the box", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "call the roofer back about the estimate");
  await box.press("#capture-input", "Enter");

  await waitForHidden(h);
  const content = await waitForInbox(h, "call the roofer back about the estimate");

  expect(content).toMatch(
    /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} call the roofer back about the estimate\n$/,
  );
});

test("the box is empty again on the next open", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "first thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  await h.trigger();
  expect(await box.inputValue("#capture-input")).toBe("");
});

test("submitting empty input creates no item", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.press("#capture-input", "Enter");

  // Nothing saved, and the box stays open rather than swallowing the keystroke.
  expect(h.inbox()).toBe("");
  expect(await h.isBoxVisible()).toBe(true);
});

test("submitting whitespace-only input creates no item", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "    ");
  await box.press("#capture-input", "Enter");

  expect(h.inbox()).toBe("");
  expect(await h.isBoxVisible()).toBe(true);
});

test("consecutive captures land in submit order", async () => {
  for (const thought of ["first thought", "second thought", "third thought"]) {
    await h.trigger();
    const box = await h.captureBox();
    await box.fill("#capture-input", thought);
    await box.press("#capture-input", "Enter");
    await waitForHidden(h);
  }

  const content = await waitForInbox(h, "third thought");
  const lines = content.trim().split("\n");
  expect(lines[0]).toContain("first thought");
  expect(lines[1]).toContain("second thought");
  expect(lines[2]).toContain("third thought");
});

test("escape dismisses without saving", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "never mind");
  await box.press("#capture-input", "Escape");

  await waitForHidden(h);
  expect(h.inbox()).toBe("");
});

test("hand-edited inbox content survives a new capture", async () => {
  const { writeFileSync } = await import("node:fs");
  const handWritten = "# My inbox\n\n- something I wrote myself\n";
  writeFileSync(h.inboxPath, handWritten);

  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "appended thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  const content = await waitForInbox(h, "appended thought");
  expect(content.startsWith(handWritten)).toBe(true);
});
