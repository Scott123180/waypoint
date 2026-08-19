import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * This window subscribes to no change signal (FR-010a, FR-011a, research R7).
 *
 * Every other view in this app re-reads when the vault changes, and that is
 * right for them. This one is a **reading**, taken at the moment it was opened,
 * and its membership is fixed there. A row leaving a panel under someone halfway
 * through a two-minute pass would move the thing they were about to click and
 * reopen a question they had already answered.
 *
 * That decision is easy to undo by accident — one more `vaultChanged.subscribe`
 * line in `main.ts` looks like consistency with the five views above it. This
 * test is the tripwire, and it reads all four places the subscription could be
 * added: the window, the wiring, the IPC registration, and the bridge.
 *
 * Note what this does **not** say. Writes made *from* this screen still reach
 * every other open view, because they go through the shipped services and
 * `FsVaultStore` raises the signal from its own write path. Nothing is lost by
 * this window not listening; it simply does not listen to itself.
 */

const SOURCE = join(__dirname, "..", "..", "src");

function read(...parts: string[]): string {
  return readFileSync(join(SOURCE, ...parts), "utf8");
}

/** Comments describe the absence; only the code is evidence of it. */
function code(...parts: string[]): string {
  return read(...parts).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the window exposes no refresh handler", () => {
  const WINDOW = code("main", "shutdown-window.ts");

  for (const forbidden of ["vaultChanged", "inboxChanged", "refresh", "changed"]) {
    test(`ShutdownWindow has no ${forbidden}`, () => {
      assert.ok(
        !WINDOW.includes(forbidden),
        `${forbidden} on this window would be a re-read while the screen is open`,
      );
    });
  }

  test("the only thing it sends is `shutdown:opened`", () => {
    const sends = [...WINDOW.matchAll(/send\("([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sends, ["shutdown:opened"]);
  });
});

describe("main.ts registers no subscription for it", () => {
  const MAIN = code("main", "main.ts");

  test("no vaultChanged subscriber mentions the shutdown window", () => {
    for (const line of MAIN.split("\n")) {
      if (!/vaultChanged\.subscribe|inboxChanged\.subscribe/.test(line)) continue;
      assert.doesNotMatch(line, /shutdown/i, `this line resubscribes the shutdown: ${line.trim()}`);
    }
  });

  test("the five views that do subscribe still do", () => {
    // The tripwire must not have been satisfied by removing everyone's
    // subscription, which would be a far worse bug wearing this test's green.
    for (const view of ["sortWindow", "reviewWindow", "projectsWindow", "topThreeWindow", "retrospectiveWindow"]) {
      assert.match(MAIN, new RegExp(`subscribe\\(\\(\\) => ${view}\\.`), `${view} lost its subscription`);
    }
  });

  test("the shutdown window is still created and shown from the tray", () => {
    assert.match(MAIN, /new ShutdownWindow\(\)/);
    assert.match(MAIN, /onShutdown: showShutdown/);
  });
});

describe("no channel exists that could carry a refresh", () => {
  test("there is no `shutdown:changed`", () => {
    for (const file of [["main", "ipc.ts"], ["preload", "preload.ts"], ["renderer", "shutdown.ts"]]) {
      assert.ok(
        !read(...file).includes("shutdown:changed"),
        `${file.join("/")} declares a channel this window must not have`,
      );
    }
  });

  test("the bridge offers no vault-change subscription", () => {
    const bridge = /const shutdownApi = \{([\s\S]*?)\n\};/.exec(read("preload", "preload.ts"));
    assert.ok(bridge, "shutdownApi must be declared in preload.ts to be readable here");

    assert.doesNotMatch(bridge[1] ?? "", /vault:changed|inbox:changed|onVaultChanged|onChanged/);
  });

  test("the renderer listens for the opening and nothing else", () => {
    const RENDERER = code("renderer", "shutdown.ts");

    assert.match(RENDERER, /sdwp\.onOpened\(\(\) => void sdPaint\(\)\)/);
    assert.ok(!RENDERER.includes("onVaultChanged"), "a live view is what this screen must not be");
    assert.ok(!RENDERER.includes("setInterval"), "and a poll is the other way to become one");
    assert.ok(!RENDERER.includes("setTimeout"), "and a delayed re-read is the third");
  });
});
