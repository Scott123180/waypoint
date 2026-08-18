import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import { launch } from "./harness";

/**
 * Quickstart scenario 1 — the shipped state.
 *
 * No `intelligence.md`, which is the state of every vault that exists today.
 * The promise is not "the controls are disabled" or "the panel is hidden": it
 * is that a user who has never heard of this feature cannot tell it shipped.
 *
 * Scenario 1 is the one to run first and the one to run last. If this file
 * fails, nothing else about the feature matters.
 */

const SEED =
  "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof.\n" +
  "- 2026-08-17T09:20:00-04:00 book the dentist\n";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

test("no suggestion control exists, in any state", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    // Not hidden, not disabled — absent from the document entirely.
    for (const id of ["to-split", "to-where", "send", "preview", "proposal", "accept-split", "uncovered"]) {
      await expect(view.locator(`#${id}`), `#${id} exists with nothing configured`).toHaveCount(0);
    }
    await expect(view.locator(".piece")).toHaveCount(0);
  } finally {
    await h.close();
  }
});

test("window.waypoint.suggest is undefined", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    const shape = await view.evaluate(() => {
      const w = (window as unknown as { waypoint: Record<string, unknown> }).waypoint;
      return { hasSuggest: "suggest" in w, keys: Object.keys(w).sort() };
    });

    // The whole promise, in one assertion: the capability is not on the API
    // surface, which is the only form of it a stylesheet cannot undo.
    expect(shape.hasSuggest).toBe(false);
    expect(shape.keys).not.toContain("suggest");
  } finally {
    await h.close();
  }
});

test("sort.split is present anyway, because it is a SortService verb", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    const hasSplit = await view.evaluate(
      () =>
        typeof (window as unknown as { waypoint: { sort: Record<string, unknown> } }).waypoint.sort["split"] ===
        "function",
    );
    expect(hasSplit).toBe(true);
  } finally {
    await h.close();
  }
});

test("the sort walk is exactly Feature 2's", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    // The five, and only the five.
    const labels = await view.locator("#choices button").allInnerTexts();
    // Split on any whitespace: the shortcut letter sits in a `<kbd>`, so
    // `innerText` puts a newline before it.
    expect(labels.map((l) => l.split(/\s+/)[0])).toEqual([
      "Project",
      "Area",
      "Waiting",
      "Calendar",
      "Trash",
    ]);

    await expect(view.locator("#remaining")).toContainText("2 items left");
    await view.click("#to-trash");
    await expect(view.locator("#remaining")).toContainText("1 item left");
    await view.click("#to-trash");
    await expect(view.locator("#empty")).toBeVisible();
    await expect.poll(() => h.inbox()).toBe("");
  } finally {
    await h.close();
  }
});

test("no error, no prompt, and no notice about anything missing", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    // A user who has never heard of this feature must not learn of it by being
    // asked to configure it.
    await expect(view.locator("#notice")).toHaveText("");
    const body = await view.locator("body").innerText();
    expect(body).not.toMatch(/intelligence|transport|configure|model|suggest/i);
  } finally {
    await h.close();
  }
});

test("no intelligence.md is created, and nothing else appears in the vault", async () => {
  const h = await launch();
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    await view.click("#to-trash");
    await expect.poll(() => h.inbox().split("\n").filter(Boolean).length).toBe(1);

    // Shipping this feature is a no-op for data already on disk.
    expect(h.vaultFile("intelligence.md")).toBe("");
    expect(h.vaultDir("projects")).toEqual([]);
    expect(h.vaultDir("areas")).toEqual([]);
  } finally {
    await h.close();
  }
});

test("a vault whose intelligence.md names no transport is the same as none", async () => {
  const h = await launch({
    seedVault: { "intelligence.md": "# Intelligence\n\nsome notes I wrote to myself\n" },
  });
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();

    await expect(view.locator("#to-split")).toHaveCount(0);
    await expect(view.locator("#notice")).toHaveText("");
  } finally {
    await h.close();
  }
});

test("a broken intelligence.md blocks nothing", async () => {
  const h = await launch({ seedVault: { "intelligence.md": "transport: copilot\n" } });
  try {
    h.writeInbox(SEED);
    await h.openSort();
    const view = await h.sortView();
    const before = sha(h.inbox());

    // The layer is off — no control at all, exactly as if nothing were set.
    await expect(view.locator("#to-split")).toHaveCount(0);
    expect(sha(h.inbox())).toBe(before);

    // And sorting is untouched.
    await view.click("#to-trash");
    await expect.poll(() => h.inbox().split("\n").filter(Boolean).length).toBe(1);
  } finally {
    await h.close();
  }
});

/**
 * The other half of FR-055, and the half that was not being checked.
 *
 * The test above proves a malformed setting *blocks* nothing. That is only one
 * of the two things FR-055 requires: the problem must also be **reported
 * plainly, naming the value read and the values that work**. The parser's own
 * suite proves it composes that message; nothing proved the message ever
 * reached a surface a person looks at.
 *
 * It arrives through the capture box's notice queue, because the problem is
 * found at startup while every window is hidden — the same path a failed
 * hotkey registration takes (see `notices.spec.ts`). A notice sent to a hidden
 * window and never replayed would be indistinguishable, from the user's side,
 * from saying nothing at all.
 *
 * US4 acceptance scenario 5, SC-008's malformed-setting mode.
 */
test("a broken intelligence.md is reported plainly, once, in words that name the fix", async () => {
  const h = await launch({ seedVault: { "intelligence.md": "transport: copilot\n" } });
  try {
    await h.trigger();
    const box = await h.captureBox();

    await expect(box.locator("#notice")).toBeVisible();

    // The whole message, in one notice: the value that was read, both values
    // that work, and the reassurance that sorting is unaffected (FR-055).
    //
    // `toContainText` rather than `toHaveText`, deliberately. The capture box
    // holds one notice at a time — `showNotice` replaces the element's text —
    // so this asserts that the intelligence problem is the message standing
    // there, without asserting that no other notice was ever raised during a
    // startup this test does not control. What it does assert exactly is that
    // this message is whole and unmangled.
    for (const fragment of [
      "intelligence.md",
      "`transport: copilot`",
      "which is not a transport Waypoint has",
      "The transports that work are `command` and `certificate`",
      "Suggestions are off; sorting is unaffected",
    ]) {
      await expect(box.locator("#notice")).toContainText(fragment);
    }

    // One message, not two. The notice element carries the problem once —
    // a second emission would concatenate or replace, and both show here.
    const shown = (await box.locator("#notice").textContent()) ?? "";
    expect(shown.split("intelligence.md").length - 1).toBe(1);

    // Closing and reopening must not replay it. The notice is one-shot, not
    // sticky: it carries no recoverable text, and a configuration problem that
    // nagged on every capture would be a reason to stop capturing (FR-063).
    await h.blurBox();
    await h.trigger();
    const again = await h.captureBox();
    await expect(again.locator("#notice")).not.toBeVisible();
  } finally {
    await h.close();
  }
});
