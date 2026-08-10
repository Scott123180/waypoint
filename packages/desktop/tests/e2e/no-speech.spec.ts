import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("a no-speech result leaves the box open and empty", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("");

  // Silence or noise must not produce a blank item, and must not close the box
  // out from under someone who is about to try again.
  expect(await box.inputValue("#capture-input")).toBe("");
  expect(await h.isBoxVisible()).toBe(true);
  expect(h.inbox()).toBe("");
});

test("a no-speech result shows a notice without blocking input", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("");

  await expect(box.locator("#notice")).toBeVisible();
  // The notice must never stand between the user and the next thought.
  expect(await box.evaluate(() => document.activeElement?.id)).toBe("capture-input");
});

test("the user can type immediately after a no-speech result", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await h.dictate("");
  await box.fill("#capture-input", "typed instead");

  expect(await box.inputValue("#capture-input")).toBe("typed instead");
});

test("typed text is preserved when dictation finds no speech", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "already typed");
  await h.dictate("");

  expect(await box.inputValue("#capture-input")).toBe("already typed");
});

test("a failed transcription reports itself and keeps typed text", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "already typed");
  await h.dictateFailure("whisper exited 3");

  await expect(box.locator("#notice")).toBeVisible();
  expect(await box.inputValue("#capture-input")).toBe("already typed");
  expect(h.inbox()).toBe("");
});
