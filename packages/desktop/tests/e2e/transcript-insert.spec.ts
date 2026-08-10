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

/**
 * Spacing between a transcript and whatever is already in the box.
 *
 * Found in real use: dictating twice in a row produced `spike?This`, because
 * whisper's output is trimmed and the transcript was inserted flush against the
 * previous sentence.
 */
test("consecutive dictations are separated by a space", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("Will the CPU spike?");
  await h.dictate("This is great.");

  expect(await box.inputValue("#capture-input")).toBe("Will the CPU spike? This is great.");
});

test("no space is added when the box is empty", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("call the roofer back");

  // A leading space would be stored verbatim and show up in the inbox.
  expect(await box.inputValue("#capture-input")).toBe("call the roofer back");
});

test("an existing trailing space is not doubled", async () => {
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

test("a line break counts as separation on its own", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "first line\n");
  await box.evaluate(() => {
    const input = document.getElementById("capture-input") as HTMLTextAreaElement;
    input.setSelectionRange(input.value.length, input.value.length);
  });

  await h.dictate("second line");

  // Indenting the new line with a stray space would be wrong.
  expect(await box.inputValue("#capture-input")).toBe("first line\nsecond line");
});

test("inserting before existing text separates on both sides", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "the roofer");
  await box.evaluate(() => {
    const input = document.getElementById("capture-input") as HTMLTextAreaElement;
    input.setSelectionRange(0, 0);
  });

  await h.dictate("call");

  expect(await box.inputValue("#capture-input")).toBe("call the roofer");
});

test("the caret lands after the inserted transcript, not after the padding", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("first thought.");
  await h.dictate("second thought.");
  // Typing straight after dictating must continue the sentence just spoken.
  await box.press("#capture-input", "!");

  expect(await box.inputValue("#capture-input")).toBe("first thought. second thought.!");
});
