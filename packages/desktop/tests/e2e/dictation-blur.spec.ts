import { test, expect, type Page } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * Dictation survives losing focus (ROADMAP known gap).
 *
 * The box hides on blur, and hiding never stopped the recording: the microphone
 * stayed live on a window nobody could see, and the next open sent
 * `capture:reset`, discarding everything said before the click with no way back
 * to it.
 *
 * The fix pins the box open for as long as dictation is in flight. That is the
 * privacy answer as much as the data one — a live microphone always has a
 * visible indicator, because the indicator is the box itself.
 *
 * Launched with Chromium's fake capture device so the real getUserMedia →
 * AudioContext path runs; a stubbed microphone could not show that a recording
 * survived anything.
 */
let h: Harness;

/** Waits until the meter has seen real audio, so there is something to lose. */
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

test("clicking away while recording leaves the box open and still listening", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await h.blurBox();

  // A hidden window that is still recording is the defect. Either it stays
  // visible or it stops; it must never be both gone and live.
  expect(await h.isBoxVisible()).toBe(true);
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
});

test("the meter keeps moving after focus is lost, so the mic is visibly still live", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  await waitForAudio(box);
  await h.blurBox();

  const readings: number[] = [];
  for (let i = 0; i < 8; i++) {
    readings.push(
      await box.locator("#status").evaluate((el) => Number(el.getAttribute("data-level") ?? "0")),
    );
    // Sampled together with the level, because a moving meter is only
    // reassuring on a window the user can see — a live one behind a hidden
    // window is the defect rather than the fix.
    expect(await h.isBoxVisible()).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
  }

  expect(Math.max(...readings)).toBeGreaterThan(0);
  expect(new Set(readings).size).toBeGreaterThan(1);
});

test("reopening after clicking away does not discard what was said", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  const status = box.locator("#status");
  await expect(status).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);
  const startedAt = await status.getAttribute("data-started-at");

  await h.blurBox();
  await h.triggerDictate();

  // The exact bug: the reopen used to send `capture:reset`, tearing the
  // recording down. Same recording, still running, nothing thrown away.
  await expect(status).toHaveAttribute("data-state", "recording");
  expect(await status.getAttribute("data-started-at")).toBe(startedAt);
});

test("a recording that lost focus can be stopped from the keyboard", async () => {
  await h.setTranscript("call the roofer back");
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await h.blurBox();
  // Either hotkey brings the box forward and focuses it, which is what puts
  // Enter and Escape back within reach — no second global accelerator is taken
  // for the duration of a recording. The focus call itself is not assertable
  // here (this runner's windows are never focused to begin with); what is
  // assertable is that reaching for the hotkey leaves the recording intact and
  // Enter still ends it, rather than resetting the box as it used to.
  await h.triggerDictate();

  await box.press("#capture-input", "Enter");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
  expect(await box.inputValue("#capture-input")).toBe("call the roofer back");
});

test("the box stays put while a transcript is still arriving", async () => {
  await h.setTranscript("half a thought");
  await h.setTranscriptionDelay(1500);
  await h.triggerDictate();
  const box = await h.captureBox();
  await waitForAudio(box);
  await box.press("#capture-input", "Enter");
  await expect(box.locator("#status")).toHaveAttribute("data-state", "transcribing");

  await h.blurBox();

  // The microphone is already released here, but the box going away would lose
  // the arriving transcript to the next reset — the same defect one state on.
  expect(await h.isBoxVisible()).toBe(true);
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  expect(await box.inputValue("#capture-input")).toBe("half a thought");
});

test("clicking away still dismisses a box that is not dictating", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "typed, not spoken");

  await h.blurBox();

  // The pin is scoped to dictation. Ordinary dismiss-by-clicking-away is
  // untouched, including the reset that empties the box on the next open.
  expect(await h.isBoxVisible()).toBe(false);
  await h.trigger();
  expect(await box.inputValue("#capture-input")).toBe("");
});

test("escape still releases the microphone and closes the box", async () => {
  await h.triggerDictate();
  const box = await h.captureBox();
  await expect(box.locator("#status")).toHaveAttribute("data-state", "recording");
  await waitForAudio(box);

  await box.press("#capture-input", "Escape");

  // Being pinned open must not mean being stuck open: Escape stops the
  // recording first, so hiding is allowed again by the time it is asked for.
  expect(await h.isBoxVisible()).toBe(false);
  expect(await h.isBoxDictating()).toBe(false);
  await expect(box.locator("#status")).toHaveAttribute("data-state", "idle");
});
