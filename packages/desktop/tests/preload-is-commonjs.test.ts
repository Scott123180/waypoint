import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The built preload must be CommonJS.
 *
 * Electron loads a preload script as CommonJS. If it contains ESM `import`
 * statements the script fails to load, `window.waypoint` is never defined, and
 * every renderer goes dead — the capture box opens but dictation never starts,
 * sort shows nothing, and no error appears anywhere obvious.
 *
 * It breaks in one specific, easy way: a file under `src/renderer/` importing
 * from `../preload/preload`. That pulls preload.ts into the *renderer*
 * TypeScript program, which is configured `module: ES2022` and runs second in
 * `build:desktop`, overwriting the CommonJS output the main build produced.
 *
 * This has now cost real debugging time once. sort.ts and capture.ts declare
 * their types locally to avoid it, projects.ts does the same, and this test
 * fails loudly if anyone reintroduces the import.
 */

// This test runs from `dist/tests/`, so `..` is the build root and `../..` is
// the package root where the TypeScript sources live.
const BUILT = join(__dirname, "..", "src");
const SOURCE = join(__dirname, "..", "..", "src");

describe("the built preload", () => {
  test("is CommonJS, not ESM", () => {
    const built = readFileSync(join(BUILT, "preload", "preload.js"), "utf8");

    assert.doesNotMatch(
      built,
      /^\s*import\s/m,
      "preload.js contains an ESM import — Electron cannot load it, and window.waypoint will be undefined",
    );
    assert.match(built, /require\(|exports\./, "preload.js should be CommonJS output");
  });

  test("still exposes the bridge", () => {
    const built = readFileSync(join(BUILT, "preload", "preload.js"), "utf8");
    assert.match(built, /exposeInMainWorld/);
    assert.match(built, /capture:reset/, "the capture channels must survive");
    assert.match(built, /projects:list-active/, "the project channels must survive");
  });

  test("no renderer file imports from the preload", () => {
    // The root cause, caught at the source rather than in the build output.
    for (const file of ["capture.ts", "sort.ts", "projects.ts"]) {
      const source = readFileSync(join(SOURCE, "renderer", file), "utf8");
      assert.doesNotMatch(
        source,
        /from\s+["'][^"']*preload/,
        `${file} must declare its types locally, not import them across the preload boundary`,
      );
    }
  });
});
