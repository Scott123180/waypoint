import { test, expect } from "@playwright/test";
import { launch, waitForHidden, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("the next capture opens immediately after a dictated submit", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await h.dictate("first spoken thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  // No acknowledgement, no dismissal of an undo prompt, no waiting.
  const elapsed = await h.app.evaluate(() => {
    const started = Date.now();
    (globalThis as Record<string, any>)["__waypoint"].showCapture();
    return Date.now() - started;
  });

  expect(elapsed).toBeLessThan(100);
  expect(await h.isBoxVisible()).toBe(true);
  expect(await box.inputValue("#capture-input")).toBe("");
});

test("a pending undo window never blocks the next capture", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await h.dictate("first spoken thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  await h.trigger();
  await box.fill("#capture-input", "second thought, straight away");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  const content = h.inbox();
  expect(content).toContain("first spoken thought");
  expect(content).toContain("second thought, straight away");
});

test("the box never shows a modal that must be dismissed", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await h.dictate("a spoken thought");

  // A notice may appear, but the input must remain reachable and typable.
  await box.fill("#capture-input", "still typable");
  expect(await box.inputValue("#capture-input")).toBe("still typable");
  expect(await box.evaluate(() => document.activeElement?.id)).toBe("capture-input");
});
