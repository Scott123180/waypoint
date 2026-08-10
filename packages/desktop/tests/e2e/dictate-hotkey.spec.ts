import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The dictate hotkey (FR-001a): one keystroke from anywhere to a box that is
 * already listening, with no click in between.
 *
 * Launched with Chromium's fake capture device so the real getUserMedia →
 * AudioContext path runs. Stubbing the microphone here would leave the thing
 * these tests exist to prove — that the hotkey actually opens the mic —
 * untested.
 */
let h: Harness;

test.beforeEach(async () => {
  h = await launch({ fakeMicrophone: true });
});

test.afterEach(async () => {
  await h.close();
});

test("the dictate hotkey opens the box already recording", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();

  expect(await h.isBoxVisible()).toBe(true);
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
});

test("the plain capture hotkey does not open the microphone", async () => {
  await h.trigger();
  const box = await h.captureBox();

  // Whichever key is more prominent, the typing one must never turn the mic on.
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
});

test("dictating into an already-open box preserves what was typed", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "half a thought");

  await h.triggerDictate();

  // FR-003a: starting to record neither clears nor replaces in-progress input.
  expect(await box.inputValue("#capture-input")).toBe("half a thought");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
});

test("the dictate hotkey while already recording does not restart the recording", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");

  const startedAt = await box.locator("#status").getAttribute("data-started-at");
  await h.triggerDictate();

  // A second press must be inert rather than dropping the audio so far.
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  expect(await box.locator("#status").getAttribute("data-started-at")).toBe(startedAt);
});

test("the box opens with the input focused even when dictation starts", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();

  // FR-005b: recording must never cost the user the ability to just type.
  const focused = await box.evaluate(() => document.activeElement?.id);
  expect(focused).toBe("capture-input");
});
