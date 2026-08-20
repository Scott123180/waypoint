import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The capture box stays on the Space the user is looking at.
 *
 * Spaces membership is a property of the window's connection to the macOS
 * window server, and it does not survive a process transform. `app.dock.hide()`
 * performs one. A window created before that call can therefore lose the
 * membership it was given and strand the box on whichever desktop the app
 * started on for the rest of the session.
 *
 * Asserted statically, over compiled output, for the same reason
 * `sort-offline.test.ts` is: the fact is unobservable where the suite runs.
 * Spaces are a macOS window-server concept and `app.dock` is `undefined` on
 * Linux, so no runtime assertion on the dev machine can see either the
 * transform or the membership. What *is* checkable anywhere is the ordering
 * that makes the transform harmless, and the options that make re-asserting
 * the membership free.
 *
 * The runtime half — that membership is re-stated on every open rather than
 * only at creation — is `tests/e2e/capture-spaces.spec.ts`.
 */

const MAIN = join(__dirname, "..", "..", "dist", "src", "main", "main.js");
const CAPTURE_WINDOW = join(__dirname, "..", "..", "dist", "src", "main", "capture-window.js");

/** Ignores comments, so prose describing the ordering cannot satisfy the test. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the capture box is not stranded by the dock transform", () => {
  test("the dock is hidden before any window is created", () => {
    const source = code(MAIN);

    const hidesDock = source.indexOf("app.dock?.hide()");
    const createsWindow = source.indexOf("captureWindow.create()");

    assert.notEqual(hidesDock, -1, "main no longer hides the dock");
    assert.notEqual(createsWindow, -1, "main no longer creates the capture window");
    assert.ok(
      hidesDock < createsWindow,
      "app.dock.hide() must run before captureWindow.create(): hiding the dock " +
        "transforms the process type, and a window created first would have to " +
        "survive that transform with its Spaces membership intact",
    );
  });

  test("the membership is claimed against fullscreen apps too", () => {
    // A fullscreen app owns a Space of its own; without this the hotkey answers
    // everywhere except the place the user most needs it to.
    assert.match(code(CAPTURE_WINDOW), /visibleOnFullScreen:\s*true/);
  });

  test("claiming it never transforms the process itself", () => {
    // Left to itself the call transforms the process between foreground and
    // UIElement to make the fullscreen claim stick, hiding the window and
    // flashing the dock each time. Waypoint is already a UIElement application,
    // so the transform buys nothing — and without this flag, re-asserting the
    // membership on every open would be visible on every single capture.
    assert.match(code(CAPTURE_WINDOW), /skipTransformProcessType:\s*true/);
  });
});
