import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { registerHotkey, type ShortcutApi } from "../src/main/hotkey";

function fakeApi(registerResult: boolean): ShortcutApi & { registered: string[] } {
  const registered: string[] = [];
  return {
    registered,
    register(accelerator: string, _cb: () => void) {
      if (registerResult) registered.push(accelerator);
      return registerResult;
    },
    unregisterAll() {
      registered.length = 0;
    },
  };
}

describe("registerHotkey", () => {
  test("registers the configured accelerator", () => {
    const api = fakeApi(true);
    const result = registerHotkey("CommandOrControl+Shift+Space", () => {}, api, () => {});

    assert.equal(result.registered, true);
    assert.deepEqual(api.registered, ["CommandOrControl+Shift+Space"]);
  });

  test("invokes the trigger callback when the shortcut fires", () => {
    let fired = 0;
    const api: ShortcutApi = {
      register(_accelerator, cb) {
        cb();
        return true;
      },
      unregisterAll() {},
    };

    registerHotkey("CommandOrControl+Shift+Space", () => (fired += 1), api, () => {});
    assert.equal(fired, 1);
  });

  test("reports failure when the combination is already taken", () => {
    const api = fakeApi(false);
    const result = registerHotkey("CommandOrControl+Shift+Space", () => {}, api, () => {});

    assert.equal(result.registered, false);
  });

  test("emits an actionable notice when registration fails", () => {
    const notices: { level: string; message: string }[] = [];
    const api = fakeApi(false);

    registerHotkey("CommandOrControl+Shift+Space", () => {}, api, (n) => notices.push(n));

    // Failing silently would leave the user concluding the app is broken.
    assert.equal(notices.length, 1);
    assert.equal(notices[0]?.level, "error");
    assert.match(notices[0]?.message ?? "", /CommandOrControl\+Shift\+Space/);
    assert.match(notices[0]?.message ?? "", /tray|menu bar/i);
  });

  test("emits no notice when registration succeeds", () => {
    const notices: unknown[] = [];
    registerHotkey("CommandOrControl+Shift+Space", () => {}, fakeApi(true), (n) =>
      notices.push(n),
    );

    assert.equal(notices.length, 0);
  });

  test("a throwing register call is reported, not propagated", () => {
    // Electron throws on a malformed accelerator rather than returning false.
    const api: ShortcutApi = {
      register() {
        throw new Error("Invalid accelerator");
      },
      unregisterAll() {},
    };
    const notices: { level: string; message: string }[] = [];

    const result = registerHotkey("NotAValidAccelerator!!", () => {}, api, (n) =>
      notices.push(n),
    );

    // Startup must survive a bad hotkey in the config file.
    assert.equal(result.registered, false);
    assert.equal(notices.length, 1);
  });
});
