import { test, expect } from "@playwright/test";
import { launch, waitForHidden, type Harness } from "./harness";

let h: Harness;

test.afterEach(async () => {
  await h.close();
});

test("a hotkey registration failure is visible the first time the box opens", async () => {
  h = await launch({ hotkey: "NotAValidAccelerator!!" });

  await h.trigger();
  const box = await h.captureBox();

  // Raised at startup while the box was hidden. Before the notice queue, the
  // reset on open wiped it and the user never learned the hotkey was dead.
  await expect(box.locator("#notice")).toBeVisible();
  await expect(box.locator("#notice")).toContainText("NotAValidAccelerator");
});

test("a failed write shows the thought back so it stays recoverable", async () => {
  h = await launch({ unwritableInbox: true });

  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "the roofer estimate");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  // The box closed before the write failed, so the notice must survive to the
  // next open — it is the only remaining copy of the thought.
  await h.trigger();
  await expect(box.locator("#notice")).toBeVisible();
  await expect(box.locator("#notice")).toContainText("the roofer estimate");
});

test("recoverable text replays until acknowledged", async () => {
  h = await launch({ unwritableInbox: true });

  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "a thought worth keeping");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  await h.trigger();
  await expect(box.locator("#notice")).toContainText("a thought worth keeping");
  await h.app.evaluate(() => (globalThis as Record<string, any>)["__waypoint"].hideCapture());

  // Missing it once must not lose it.
  await h.trigger();
  await expect(box.locator("#notice")).toContainText("a thought worth keeping");

  await box.click("#notice-dismiss");
  await h.app.evaluate(() => (globalThis as Record<string, any>)["__waypoint"].hideCapture());
  await h.trigger();
  await expect(box.locator("#notice")).not.toBeVisible();
});

test("an ordinary capture leaves no notice behind", async () => {
  h = await launch();

  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "a normal thought");
  await box.press("#capture-input", "Enter");
  await waitForHidden(h);

  await h.trigger();
  await expect(box.locator("#notice")).not.toBeVisible();
});
