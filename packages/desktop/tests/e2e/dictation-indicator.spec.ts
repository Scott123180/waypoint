import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * FR-005a / FR-005b / SC-008 — the user must always be able to tell whether the
 * app is listening, working, or idle.
 *
 * Chromium's fake capture device emits a real tone, so the level meter is
 * driven by genuine audio samples rather than a stub. That matters: the meter's
 * whole purpose is to prove the microphone is live, and a faked one would prove
 * nothing.
 */
let h: Harness;

/**
 * Waits until the meter has seen real audio.
 *
 * Stopping the instant recording starts captures zero samples and correctly
 * yields "no speech", never reaching transcription — so a test that wants the
 * transcribing state has to actually speak first.
 */
async function waitForAudio(box: import("@playwright/test").Page): Promise<void> {
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

test("recording and transcribing are visibly different states", async () => {
  // The bug this whole phase exists for: both used to look identical.
  await h.setTranscriptionDelay(1500);
  await h.trigger();
  const box = await h.captureBox();
  const status = box.locator("#status");

  await box.click("#dictate-button");
  await expect(status).toHaveAttribute("data-state", "recording");
  const recordingText = (await status.innerText()).toLowerCase();
  await waitForAudio(box);

  await box.click("#dictate-button");
  await expect(status).toHaveAttribute("data-state", "transcribing");
  const transcribingText = (await status.innerText()).toLowerCase();

  expect(recordingText).not.toBe(transcribingText);
  expect(recordingText).toContain("listening");
  expect(transcribingText).toContain("transcribing");
});

test("the state returns to idle once the transcript arrives", async () => {
  await h.setTranscript("call the roofer back");
  await h.trigger();
  const box = await h.captureBox();
  const status = box.locator("#status");

  await box.click("#dictate-button");
  await expect(status).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);
  await box.click("#dictate-button");

  await expect(status).toHaveAttribute("data-state", "idle");
  expect(await box.inputValue("#capture-input")).toBe("call the roofer back");
});

test("the level meter responds to real microphone audio", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");

  // Sampled over time: a meter pinned at one value would satisfy a single
  // reading but tells the user nothing about whether the mic is live.
  const readings: number[] = [];
  for (let i = 0; i < 12; i++) {
    readings.push(
      await box.locator("#status").evaluate((el) => Number(el.getAttribute("data-level") ?? "0")),
    );
    await new Promise((r) => setTimeout(r, 120));
  }

  expect(Math.max(...readings)).toBeGreaterThan(0);
  expect(new Set(readings).size).toBeGreaterThan(1);
});

test("the meter is gone once recording stops", async () => {
  await h.setTranscript("done");
  await h.trigger();
  const box = await h.captureBox();

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);
  await box.click("#dictate-button");

  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
  await expect(box.locator("#level-meter")).toBeHidden();
});

test("typing stays possible throughout recording and transcription", async () => {
  await h.setTranscriptionDelay(1200);
  await h.trigger();
  const box = await h.captureBox();

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");

  // FR-005b: giving up on dictation and typing instead must always be possible.
  await box.fill("#capture-input", "typed while recording");
  expect(await box.inputValue("#capture-input")).toBe("typed while recording");
  expect(await box.isEditable("#capture-input")).toBe(true);

  await waitForAudio(box);
  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "transcribing");
  expect(await box.isEditable("#capture-input")).toBe(true);
});

test("the transcribing indicator claims no completion percentage", async () => {
  // whisper reports 185% on a 16s clip and 1090% on a 2.8s one, so any number
  // shown here would be a fabrication.
  await h.setTranscriptionDelay(1200);
  await h.trigger();
  const box = await h.captureBox();

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);
  await box.click("#dictate-button");

  const status = box.locator("#status");
  await expect(status).toHaveAttribute("data-state", "transcribing");
  expect(await status.innerText()).not.toMatch(/\d+\s*%/);
});

test("an elapsed timer runs while recording", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.click("#dictate-button");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");

  await expect(box.locator("#elapsed")).toHaveText(/0:0\d/);
  await expect(box.locator("#elapsed")).toHaveText(/0:0[2-9]/, { timeout: 5000 });
});

test("the state is announced to assistive technology", async () => {
  await h.trigger();
  const box = await h.captureBox();

  const status = box.locator("#status");
  await expect(status).toHaveAttribute("aria-live", "polite");

  await box.click("#dictate-button");
  await expect(status).toHaveAttribute("data-state", "recording");
  // A meter conveying level only by bar width is invisible to a screen reader.
  await expect(box.locator("#level-meter")).toHaveAttribute("aria-hidden", "true");
  expect((await status.innerText()).toLowerCase()).toContain("listening");
});

test("a microphone failure reports itself rather than hanging in 'recording'", async () => {
  await h.trigger();
  const box = await h.captureBox();
  // Patched in the renderer rather than relying on the machine having no audio
  // device, so the test means the same thing on a laptop and on a CI runner.
  await h.breakMicrophone();
  await box.click("#dictate-button");

  await expect(box.locator("#notice")).toBeVisible();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
});
