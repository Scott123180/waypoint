import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createRefresher } from "../src/main/menu-state";

describe("createRefresher", () => {
  test("builds once up front, so a menu exists before anything changes", () => {
    let builds = 0;
    const refresh = createRefresher(() => false, () => { builds++; });

    assert.equal(builds, 0, "constructing must not build; the caller decides when");
    refresh();
    assert.equal(builds, 1);
  });

  test("rebuilds when the answer flips, in both directions", () => {
    let canUndo = false;
    let builds = 0;
    const refresh = createRefresher(() => canUndo, () => { builds++; });

    refresh();
    assert.equal(builds, 1);

    canUndo = true;
    refresh();
    assert.equal(builds, 2, "a capture became undoable and the menu did not follow");

    canUndo = false;
    refresh();
    assert.equal(builds, 3, "the undo window closed and the menu did not follow");
  });

  test("stays quiet when nothing changed", () => {
    // Linux exports the menu over DBus; rebuilding it on every capture whether
    // or not anything changed is chatter the desktop has to process.
    let builds = 0;
    const refresh = createRefresher(() => true, () => { builds++; });

    refresh();
    refresh();
    refresh();
    assert.equal(builds, 1);
  });
});
