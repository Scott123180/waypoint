import { test, expect, type Page } from "@playwright/test";
import { launch, waitForHidden, waitForInbox, type Harness } from "./harness";

/**
 * Enter carries the whole dictation flow: speak, Enter to stop, Enter to save.
 *
 * Run against Chromium's fake capture device so the real
 * getUserMedia → AudioContext → transcribe path runs. What is being proven is
 * that a keystroke reaches the same stop the button reached, so stubbing the
 * microphone would prove nothing.
 */
let h: Harness;

/**
 * Waits until the meter has seen real audio.
 *
 * Stopping the instant recording starts captures zero samples and correctly
 * yields "no speech", never reaching transcription — so a test that wants a
 * transcript has to actually speak first.
 */
async function waitForAudio(box: Page): Promise<void> {
  await box.waitForFunction(
    () => Number(document.getElementById("status")?.dataset["level"] ?? "0") > 0,
    undefined,
    { timeout: 10_000 },
  );
}

test.beforeEach(async () => {
  h = await launch({ fakeMicrophone: true });
});

test.afterEach(async () => {
  await h.close();
});

test("Enter while recording stops dictation instead of saving", async () => {
  await h.setTranscript("call the roofer back");
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await box.press("#capture-input", "Enter");

  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
  expect(await box.inputValue("#capture-input")).toBe("call the roofer back");
  // The first Enter must not file anything: the words have not been seen yet.
  expect(await h.isBoxVisible()).toBe(true);
  expect(h.inbox()).toBe("");
});

test("a second Enter saves the transcript", async () => {
  await h.setTranscript("call the roofer back");
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await box.press("#capture-input", "Enter");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
  await box.press("#capture-input", "Enter");

  await waitForInbox(h, "call the roofer back");
  await waitForHidden(h);
});

test("Enter during transcription waits rather than filing an empty capture", async () => {
  // The dangerous window: the box looks ready, but the words are still in
  // flight. Submitting here would file nothing and close the box on top of the
  // transcript about to arrive.
  await h.setTranscriptionDelay(1500);
  await h.setTranscript("still coming");
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await box.press("#capture-input", "Enter");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "transcribing");
  await box.press("#capture-input", "Enter");

  expect(await h.isBoxVisible()).toBe(true);
  expect(h.inbox()).toBe("");

  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  expect(await box.inputValue("#capture-input")).toBe("still coming");
  expect(h.inbox()).toBe("");
});

test("the hint says what Enter will do in the state it is in", async () => {
  await h.trigger();
  const box = await h.captureBox();
  const hint = box.locator("#hint");
  await expect(hint).toContainText("Enter to save");

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await expect(hint).toContainText("Enter to stop");
});

test("Shift+Enter still writes a newline while recording", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");

  await box.fill("#capture-input", "first line");
  await box.press("#capture-input", "Shift+Enter");
  await box.type("#capture-input", "second line");

  expect(await box.inputValue("#capture-input")).toBe("first line\nsecond line");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
});
