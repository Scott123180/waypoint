import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultConfig, loadConfig, configFilePath, vaultPaths } from "../src/main/config";
import type { ConfigEnv } from "../src/main/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("defaultConfig", () => {
  test("puts the inbox outside the app repo, in the user's home", () => {
    const cfg = defaultConfig({ home: "/home/alice", platform: "linux" });
    assert.equal(cfg.inboxPath, "/home/alice/waypoint/inbox.md");
  });

  test("ships a sensible default hotkey", () => {
    const cfg = defaultConfig({ home: "/home/alice", platform: "linux" });
    assert.equal(cfg.hotkey, "CommandOrControl+Shift+Enter");
  });

  test("gives dictation the more prominent binding", () => {
    // Voice is the mode reached for most, so it gets the key that is easiest to
    // hit; typing takes the second one (FR-001a).
    const cfg = defaultConfig({ home: "/home/alice", platform: "linux" });
    assert.equal(cfg.dictateHotkey, "CommandOrControl+Shift+Space");
  });

  test("the two default hotkeys are distinct", () => {
    // Identical bindings would mean one of the two silently never registers.
    const cfg = defaultConfig({ home: "/home/alice", platform: "linux" });
    assert.notEqual(cfg.hotkey, cfg.dictateHotkey);
  });

  test("points the model at the bundled resources directory", () => {
    // The model ships inside the app; defaulting anywhere else means dictation
    // cannot find it out of the box.
    const cfg = defaultConfig({
      home: "/home/alice",
      platform: "linux",
      resourcesDir: "/opt/waypoint/resources/whisper",
    });
    assert.equal(cfg.whisperModelPath, "/opt/waypoint/resources/whisper/ggml-small.en.bin");
  });
});

describe("configFilePath", () => {
  test("uses XDG config dir on Linux", () => {
    const p = configFilePath({ home: "/home/alice", platform: "linux" });
    assert.equal(p, "/home/alice/.config/waypoint/config.json");
  });

  test("uses Application Support on macOS", () => {
    const p = configFilePath({ home: "/Users/alice", platform: "darwin" });
    assert.equal(p, "/Users/alice/Library/Application Support/waypoint/config.json");
  });
});

describe("loadConfig", () => {
  const env = { home: "/home/alice", platform: "linux" as const };

  test("returns defaults when the file is absent", () => {
    const result = loadConfig(join(dir, "does-not-exist.json"), env);
    assert.deepEqual(result.config, defaultConfig(env));
    assert.equal(result.problem, undefined);
  });

  test("applies overrides from the file", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ inboxPath: "/tmp/custom.md", hotkey: "Alt+Space" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.inboxPath, "/tmp/custom.md");
    assert.equal(result.config.hotkey, "Alt+Space");
    assert.equal(result.problem, undefined);
  });

  test("keys absent from the file fall back to defaults", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ hotkey: "Alt+Space" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.inboxPath, defaultConfig(env).inboxPath);
    assert.equal(result.config.hotkey, "Alt+Space");
  });

  test("malformed JSON reports the problem but still returns usable defaults", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, "{ this is not json");

    const result = loadConfig(p, env);
    assert.deepEqual(result.config, defaultConfig(env));
    assert.match(result.problem ?? "", /config/i);
  });

  test("each hotkey is overridable independently of the other", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ dictateHotkey: "Alt+D" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.dictateHotkey, "Alt+D");
    assert.equal(result.config.hotkey, defaultConfig(env).hotkey);
    assert.equal(result.problem, undefined);
  });

  test("an invalid dictateHotkey falls back without blocking startup", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ dictateHotkey: "" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.dictateHotkey, defaultConfig(env).dictateHotkey);
    assert.match(result.problem ?? "", /dictateHotkey/);
  });

  test("a wrong-typed value is ignored rather than blocking startup", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ inboxPath: 42, hotkey: "Alt+Space" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.inboxPath, defaultConfig(env).inboxPath);
    assert.equal(result.config.hotkey, "Alt+Space");
    assert.match(result.problem ?? "", /inboxPath/);
  });

  test("a directory where the config file should be does not throw", () => {
    const p = join(dir, "config.json");
    mkdirSync(p);

    const result = loadConfig(p, env);
    assert.deepEqual(result.config, defaultConfig(env));
    assert.ok(result.problem);
  });
});

describe("vaultRoot", () => {
  const env: ConfigEnv = { home: "/home/alice", platform: "linux" };

  test("defaults to the directory holding the inbox", () => {
    const cfg = defaultConfig(env);
    assert.equal(cfg.vaultRoot, "/home/alice/waypoint");
  });

  test("follows a relocated inbox rather than defaulting independently", () => {
    // The whole vault moves with the inbox. Two independent defaults would
    // scatter projects and waiting-for into a directory the user never chose
    // (research R8a).
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ inboxPath: "/home/alice/notes/inbox.md" }));

    const result = loadConfig(p, env);
    assert.equal(result.config.vaultRoot, "/home/alice/notes");
  });

  test("an explicit vaultRoot overrides the derivation", () => {
    const p = join(dir, "config.json");
    writeFileSync(
      p,
      JSON.stringify({ inboxPath: "/home/alice/notes/inbox.md", vaultRoot: "/srv/vault" }),
    );

    const result = loadConfig(p, env);
    assert.equal(result.config.vaultRoot, "/srv/vault");
    assert.equal(result.config.inboxPath, "/home/alice/notes/inbox.md");
  });

  test("an invalid vaultRoot falls back to the derivation without blocking startup", () => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ inboxPath: "/home/alice/notes/inbox.md", vaultRoot: 7 }));

    const result = loadConfig(p, env);
    assert.equal(result.config.vaultRoot, "/home/alice/notes");
    assert.match(result.problem ?? "", /vaultRoot/);
  });
});

describe("vaultPaths", () => {
  test("derives every destination from the vault root", () => {
    const paths = vaultPaths({ ...defaultConfig({ home: "/home/alice", platform: "linux" }) });
    assert.equal(paths.projectsDir, "/home/alice/waypoint/projects");
    assert.equal(paths.areasDir, "/home/alice/waypoint/areas");
    assert.equal(paths.waitingPath, "/home/alice/waypoint/waiting.md");
    assert.equal(paths.calendarPath, "/home/alice/waypoint/calendar.md");
    assert.equal(paths.trashPath, "/home/alice/waypoint/trash.md");
  });

  test("a relocated vault moves every destination with it", () => {
    const cfg = { ...defaultConfig({ home: "/home/alice", platform: "linux" }), vaultRoot: "/srv/v" };
    const paths = vaultPaths(cfg);
    assert.equal(paths.projectsDir, "/srv/v/projects");
    assert.equal(paths.trashPath, "/srv/v/trash.md");
  });
});
