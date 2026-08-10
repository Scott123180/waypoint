import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { whisperResourcesDir, whisperBinaryName } from "../src/main/resources";

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
