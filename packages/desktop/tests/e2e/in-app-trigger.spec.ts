import { test, expect } from "@playwright/test";
import { launch, waitForHidden, waitForInbox, type Harness } from "./harness";

let h: Harness;

test.afterEach(async () => {
  await h.close();
});

test("the tray entry point opens the capture box", async () => {
  h = await launch();

  await h.triggerFromTray();

  expect(await h.isBoxVisible()).toBe(true);
  const box = await h.captureBox();
  expect(await box.evaluate(() => document.activeElement?.id)).toBe("capture-input");
});

test("the tray entry point still works when the hotkey could not register", async () => {
  // The app runs as a background agent with no dock icon. If a hotkey conflict
  // also left the tray dead, there would be no way to reach capture at all.
  h = await launch({ hotkey: "NotAValidAccelerator!!" });

  expect(await h.app.evaluate(() => {
    return (globalThis as Record<string, any>)["__waypoint"].hotkeyRegistered();
  })).toBe(false);

  await h.triggerFromTray();
  expect(await h.isBoxVisible()).toBe(true);
});

test("a capture started from the tray saves normally", async () => {
  h = await launch();

  await h.triggerFromTray();
  const box = await h.captureBox();
  await box.fill("#capture-input", "captured from the tray");
  await box.press("#capture-input", "Enter");

  await waitForHidden(h);
  await waitForInbox(h, "captured from the tray");
});
