import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("triggering again while the box is open leaves in-progress text untouched", async () => {
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", "half a thought");

  await h.trigger();

  // The second trigger must be ignored entirely — clearing the box here would
  // destroy a thought the user was midway through typing.
  expect(await box.inputValue("#capture-input")).toBe("half a thought");
  expect(await h.isBoxVisible()).toBe(true);
});

test("triggering again does not open a second window", async () => {
  await h.trigger();
  await h.trigger();
  await h.trigger();

  // Asked of Electron directly rather than via Playwright's page list, which
  // only tracks windows the test has already attached to.
  const count = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(count).toBe(1);
});
