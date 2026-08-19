import { test, expect } from "@playwright/test";
import { launch, waitForInbox, type Harness } from "./harness";

/**
 * Emptying your head into the ordinary inbox (SC-008, FR-043–FR-048).
 *
 * Three thoughts in a row, landing as three items in capture order, through the
 * shipped channel and the shipped service. Focus never leaves the screen, the
 * box is ready for the next thought immediately, and an empty entry captures
 * nothing and says nothing about it.
 *
 * **Undo is deliberately not exercised here as an affordance**, because there is
 * none to exercise: Feature 1 scoped undo to *dictated* captures and put the
 * control in the tray. A typed capture from this screen behaves exactly as a
 * typed capture from the box — no undo window, tray entry disabled — which is
 * what FR-049's "the same behaviour it has at the capture surface" amounts to.
 * `shutdown-capture-undo.test.ts` asserts that symmetry directly.
 */

let h: Harness;

const THOUGHTS = [
  "Ask Priya about the March offsite",
  "The kitchen tap is dripping again",
  "Check whether the contract renewal is automatic",
];

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

async function captureFromShutdown(view: Awaited<ReturnType<Harness["shutdownView"]>>, text: string): Promise<void> {
  await view.fill("#capture-text", text);
  await view.press("#capture-text", "Enter");
}

test("three thoughts in a row land in the inbox, in order", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  for (const text of THOUGHTS) await captureFromShutdown(view, text);
  await waitForInbox(h, THOUGHTS[2] as string);

  const lines = h.inbox().trim().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines.map((line) => line.replace(/^- \S+ /, ""))).toEqual(THOUGHTS);
});

test("each carries a capture timestamp, in the ordinary grammar", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await captureFromShutdown(view, THOUGHTS[0] as string);
  await waitForInbox(h, THOUGHTS[0] as string);

  expect(h.inbox().trim()).toMatch(
    /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} Ask Priya about the March offsite$/,
  );
});

test("nothing records that the thought was typed here", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await captureFromShutdown(view, THOUGHTS[0] as string);
  await waitForInbox(h, THOUGHTS[0] as string);

  const content = h.inbox();
  for (const forbidden of ["shutdown", "typed", "source", "origin"]) {
    expect(content.toLowerCase()).not.toContain(forbidden);
  }
});

test("the inbox is indistinguishable from one filled at the capture box", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  for (const text of THOUGHTS.slice(0, 2)) await captureFromShutdown(view, text);
  await waitForInbox(h, THOUGHTS[1] as string);

  // The third from the ordinary capture box. All three lines have the same
  // shape; nothing in the file says which surface produced which.
  await h.trigger();
  const box = await h.captureBox();
  await box.fill("#capture-input", THOUGHTS[2] as string);
  await box.press("#capture-input", "Enter");
  await waitForInbox(h, THOUGHTS[2] as string);

  const shapes = h
    .inbox()
    .trim()
    .split("\n")
    .map((line) => line.replace(/^- \S+ .*/, "<item>"));
  expect(shapes).toEqual(["<item>", "<item>", "<item>"]);
});

test("focus stays on the shutdown, and the box is ready for the next thought", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await captureFromShutdown(view, THOUGHTS[0] as string);
  await waitForInbox(h, THOUGHTS[0] as string);

  await expect(view.locator("#capture-text")).toHaveValue("");
  await expect(view.locator("#capture-text")).toBeFocused();
  expect(await h.isShutdownVisible()).toBe(true);
  // No panel was navigated away from.
  await expect(view.locator("#panel-waiting")).toBeVisible();
});

test("an empty entry captures nothing, and says nothing about it", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await view.fill("#capture-text", "   ");
  await view.press("#capture-text", "Enter");
  await view.click("#capture");

  expect(h.inbox()).toEqual("");
  await expect(view.locator("#error")).toHaveText("");
  await expect(view.locator("#capture-text")).toHaveValue("");
});

test("closing mid-typing captures nothing and saves no draft", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await view.fill("#capture-text", "half a thought");
  await h.closeShutdown();

  expect(h.inbox()).toEqual("");

  await h.openShutdown();
  // Reopening reads from cold. Whether the box still holds the text is a
  // detail of a hidden window; what matters is that nothing was written and
  // nothing was persisted anywhere.
  expect(h.inbox()).toEqual("");
  expect(h.vaultDir("log")).toEqual([]);
});

test("capturing writes nothing but the inbox", async () => {
  h.writeVaultFile("waiting.md", "- 2026-01-01 @Priya — Something old\n");
  await h.openShutdown();
  const view = await h.shutdownView();

  const before = h.vaultFile("waiting.md");
  for (const text of THOUGHTS) await captureFromShutdown(view, text);
  await waitForInbox(h, THOUGHTS[2] as string);

  expect(h.vaultFile("waiting.md")).toEqual(before);
  expect(h.vaultDir("log")).toEqual([]);
});

test("the tray's undo entry is unaffected by a typed capture, as at the box", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await captureFromShutdown(view, THOUGHTS[0] as string);
  await waitForInbox(h, THOUGHTS[0] as string);

  expect(await h.undoableId()).toBeUndefined();
  // And the screen offers no undo control of its own.
  await expect(view.locator("#panel-capture button")).toHaveCount(1);
});
