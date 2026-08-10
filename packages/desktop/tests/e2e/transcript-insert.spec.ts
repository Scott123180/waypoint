import { test, expect } from "@playwright/test";
import { launch, waitForHidden, waitForInbox, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("a transcript lands in the box, not in the inbox", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("call the roofer back");

  // Show-then-save: the transcript is visible and still unsaved, which is what
  // makes "never stored unseen" structural rather than a matter of timing.
  expect(await box.inputValue("#capture-input")).toBe("call the roofer back");
  expect(h.inbox()).toBe("");
  expect(await h.isBoxVisible()).toBe(true);
});

test("a transcript is inserted at the cursor without replacing typed text", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "remember to ");
  await box.evaluate(() => {
    const input = document.getElementById("capture-input") as HTMLTextAreaElement;
    input.setSelectionRange(input.value.length, input.value.length);
  });

  await h.dictate("call the roofer");

  expect(await box.inputValue("#capture-input")).toBe("remember to call the roofer");
});

test("an edited transcript is what reaches the inbox", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("call the rougher back");
  await box.fill("#capture-input", "call the roofer back");
  await box.press("#capture-input", "Enter");

  await waitForHidden(h);
  const content = await waitForInbox(h, "call the roofer back");

  // The original mis-transcription must never appear on disk.
  expect(content).not.toContain("rougher");
});

test("a transcript is never submitted automatically", async () => {
  await h.trigger();
  await h.dictate("a spoken thought");

  await new Promise((r) => setTimeout(r, 300));
  expect(h.inbox()).toBe("");
});
