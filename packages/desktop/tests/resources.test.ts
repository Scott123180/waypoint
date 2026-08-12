import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  whisperResourcesDir,
  whisperBinaryName,
  trayClickOpensMenu,
  trayIconFile,
  trayIconIsTemplate,
} from "../src/main/resources";

describe("whisperResourcesDir", () => {
  test("uses the packaged resources path when packaged", () => {
    const dir = whisperResourcesDir({
      isPackaged: true,
      resourcesPath: "/Applications/Waypoint.app/Contents/Resources",
      mainDir: "/Applications/Waypoint.app/Contents/Resources/app/dist/src/main",
    });
    assert.equal(dir, "/Applications/Waypoint.app/Contents/Resources/whisper");
  });

  test("uses the repo resources directory in development", () => {
    // Must match where scripts/fetch-whisper.sh installs, or dictation cannot
    // find the model during development.
    const dir = whisperResourcesDir({
      isPackaged: false,
      resourcesPath: "/ignored",
      mainDir: "/home/alice/git/waypoint/packages/desktop/dist/src/main",
    });
    assert.equal(dir, "/home/alice/git/waypoint/resources/whisper");
  });
});

describe("whisperBinaryName", () => {
  test("is whisper-cli on posix platforms", () => {
    assert.equal(whisperBinaryName("linux"), "whisper-cli");
    assert.equal(whisperBinaryName("darwin"), "whisper-cli");
  });

  test("adds the exe suffix on windows", () => {
    assert.equal(whisperBinaryName("win32"), "whisper-cli.exe");
  });
});

describe("tray icon selection", () => {
  test("macOS gets the template image, which the menu bar recolours itself", () => {
    // A template image is black-plus-alpha and macOS tints it to suit a light
    // or dark menu bar, live. This is the whole light/dark story on darwin.
    assert.equal(trayIconFile("darwin"), "trayTemplate.png");
    assert.equal(trayIconIsTemplate("darwin"), true);
  });

  test("every other platform gets the light icon, not the template", () => {
    // Nothing but macOS recolours a template, so shipping one elsewhere paints
    // literal black on a panel that is almost always dark.
    for (const platform of ["linux", "win32", "freebsd"]) {
      assert.equal(trayIconFile(platform), "trayLight.png");
      assert.equal(trayIconIsTemplate(platform), false);
    }
  });

  test("macOS opens the menu on a left click, so the tray must not also capture", () => {
    // darwin emits `click` *and* opens the attached context menu, which put a
    // capture box on screen alongside the menu's own "Capture a thought".
    assert.equal(trayClickOpensMenu("darwin"), true);
  });

  test("elsewhere a left click needs its own handler", () => {
    // On win32 nothing happens without one; on linux the AppIndicator never
    // emits `click`, so binding it changes nothing there.
    for (const platform of ["linux", "win32", "freebsd"]) {
      assert.equal(trayClickOpensMenu(platform), false);
    }
  });

  test("both variants ship at both scales, with matching dimensions", () => {
    // The light icon is the template recoloured, so the pair must stay the same
    // size. Diverging dimensions mean one was replaced without the other.
    // dist/tests → dist → packages/desktop, where build/ lives.
    const dir = join(__dirname, "..", "..", "build");

    const header = (name: string): { width: number; height: number } => {
      const png = readFileSync(join(dir, name));
      assert.equal(png.subarray(1, 4).toString(), "PNG", `${name} is not a PNG`);
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };

    assert.deepEqual(header("trayLight.png"), header("trayTemplate.png"));
    assert.deepEqual(header("trayLight@2x.png"), header("trayTemplate@2x.png"));
    assert.deepEqual(header("trayLight.png"), { width: 16, height: 16 });
    assert.deepEqual(header("trayLight@2x.png"), { width: 32, height: 32 });
  });
});
