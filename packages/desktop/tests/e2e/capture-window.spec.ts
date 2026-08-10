import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("the capture box opens with the input already focused", async () => {
  await h.trigger();
  const box = await h.captureBox();

  expect(await h.isBoxVisible()).toBe(true);

  // No click required: the user can start typing the instant it appears.
  const focused = await box.evaluate(() => document.activeElement?.id);
  expect(focused).toBe("capture-input");
});

test("the box opens in under 100ms because the window is pre-warmed", async () => {
  // Warm the path once so the first measurement is not paying for lazy work
  // that a real background-resident app would have done at startup.
  await h.trigger();
  await h.app.evaluate(() => {
    (globalThis as Record<string, any>)["__waypoint"].hideCapture();
  });

  const elapsed = await h.app.evaluate(() => {
    const started = Date.now();
    (globalThis as Record<string, any>)["__waypoint"].showCapture();
    return Date.now() - started;
  });

  expect(elapsed).toBeLessThan(100);
});

test("the input starts empty on every open", async () => {
  await h.trigger();
  const box = await h.captureBox();

  await box.fill("#capture-input", "half a thought");
  await h.app.evaluate(() => {
    (globalThis as Record<string, any>)["__waypoint"].hideCapture();
  });
  await h.trigger();

  expect(await box.inputValue("#capture-input")).toBe("");
});
