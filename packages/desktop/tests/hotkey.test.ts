import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { registerHotkey, registerHotkeys, type ShortcutApi } from "../src/main/hotkey";

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

/**
 * Two bindings: one opens the box for typing, one opens it already dictating
 * (FR-001a). The property that matters most is independence — a user whose
 * window manager has claimed one combination must still get the other.
 */
describe("registerHotkeys", () => {
  /** Records which accelerator each callback was registered under. */
  function recordingApi(
    fails: ReadonlySet<string> = new Set(),
  ): ShortcutApi & { fire(accelerator: string): void; registered: string[] } {
    const callbacks = new Map<string, () => void>();
    const registered: string[] = [];
    return {
      registered,
      register(accelerator, cb) {
        if (fails.has(accelerator)) return false;
        callbacks.set(accelerator, cb);
        registered.push(accelerator);
        return true;
      },
      unregisterAll() {
        callbacks.clear();
        registered.length = 0;
      },
      fire(accelerator) {
        const cb = callbacks.get(accelerator);
        if (!cb) throw new Error(`nothing registered for ${accelerator}`);
        cb();
      },
    };
  }

  test("registers both accelerators", () => {
    const api = recordingApi();
    const result = registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => {}, onDictate: () => {} },
      api,
      () => {},
    );

    assert.equal(result.capture, true);
    assert.equal(result.dictate, true);
    assert.deepEqual(api.registered.sort(), [
      "CommandOrControl+Shift+Enter",
      "CommandOrControl+Shift+Space",
    ]);
  });

  test("routes each accelerator to its own handler", () => {
    const api = recordingApi();
    const fired: string[] = [];

    registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => fired.push("capture"), onDictate: () => fired.push("dictate") },
      api,
      () => {},
    );

    api.fire("CommandOrControl+Shift+Space");
    api.fire("CommandOrControl+Shift+Enter");
    assert.deepEqual(fired, ["dictate", "capture"]);
  });

  test("a failed dictate binding leaves the capture binding working", () => {
    const api = recordingApi(new Set(["CommandOrControl+Shift+Space"]));
    const fired: string[] = [];

    const result = registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => fired.push("capture"), onDictate: () => fired.push("dictate") },
      api,
      () => {},
    );

    assert.equal(result.dictate, false);
    assert.equal(result.capture, true);
    api.fire("CommandOrControl+Shift+Enter");
    assert.deepEqual(fired, ["capture"]);
  });

  test("a failed capture binding leaves the dictate binding working", () => {
    const api = recordingApi(new Set(["CommandOrControl+Shift+Enter"]));
    const fired: string[] = [];

    const result = registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => fired.push("capture"), onDictate: () => fired.push("dictate") },
      api,
      () => {},
    );

    assert.equal(result.capture, false);
    assert.equal(result.dictate, true);
    api.fire("CommandOrControl+Shift+Space");
    assert.deepEqual(fired, ["dictate"]);
  });

  test("the notice names the binding that failed, not just 'a hotkey'", () => {
    const notices: { level: string; message: string }[] = [];
    registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => {}, onDictate: () => {} },
      recordingApi(new Set(["CommandOrControl+Shift+Space"])),
      (n) => notices.push(n),
    );

    assert.equal(notices.length, 1);
    assert.match(notices[0]?.message ?? "", /CommandOrControl\+Shift\+Space/);
    // Naming the surviving binding turns a dead end into a workaround.
    assert.match(notices[0]?.message ?? "", /CommandOrControl\+Shift\+Enter|tray|menu bar/i);
  });

  test("identical accelerators are reported rather than silently dropping one", () => {
    const notices: { level: string; message: string }[] = [];
    const same = "CommandOrControl+Shift+Space";

    const result = registerHotkeys(
      { capture: same, dictate: same },
      { onCapture: () => {}, onDictate: () => {} },
      recordingApi(),
      (n) => notices.push(n),
    );

    // One of the two cannot possibly work; saying so beats leaving the user to
    // discover that a key they configured does nothing.
    assert.equal(notices.length, 1);
    assert.match(notices[0]?.message ?? "", /same|identical|both/i);
    assert.equal(result.dictate, true);
  });

  test("emits no notice when both register cleanly", () => {
    const notices: unknown[] = [];
    registerHotkeys(
      { capture: "CommandOrControl+Shift+Enter", dictate: "CommandOrControl+Shift+Space" },
      { onCapture: () => {}, onDictate: () => {} },
      recordingApi(),
      (n) => notices.push(n),
    );
    assert.equal(notices.length, 0);
  });
});
