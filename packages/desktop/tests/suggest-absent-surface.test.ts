import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseIntelligenceConfig } from "@waypoint/core";

/**
 * FR-060 and SC-002: with no transport, there is no control **in any state**.
 *
 * Not disabled, not hidden, not greyed out — absent from the API surface. A
 * control that exists and is invisible is still a control, and one bad
 * selector away from visible; a `disabled` attribute is one devtools edit away
 * from enabled. The only form of this promise a stylesheet cannot undo is the
 * verb not being there (research R17).
 *
 * Three layers have to agree, and each is checked here:
 *
 *   1. `main.ts` builds no `SuggestionService`, so `registerSuggestIpc` is
 *      never called and no `suggest:*` channel exists.
 *   2. `preload.ts` attaches no `suggest` object, so `window.waypoint.suggest`
 *      is `undefined`.
 *   3. `sort.ts` renders its controls only when it found that object.
 */

const SOURCE = join(__dirname, "..", "..", "src");

function read(...parts: string[]): string {
  return readFileSync(join(SOURCE, ...parts), "utf8");
}

function code(source: string): string {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("with no intelligence.md, nothing is built", () => {
  test("the config parses as off, which is what main branches on", () => {
    assert.equal(parseIntelligenceConfig(null).kind, "off");
  });

  test("main builds a suggestion service only when a transport exists", () => {
    const main = code(read("main", "main.ts"));

    assert.match(
      main,
      /transport === null\s*\?\s*null\s*:\s*new SuggestionService/,
      "the service must be null when no transport was configured",
    );
    assert.match(
      main,
      /if \(suggestionService\) registerSuggestIpc/,
      "the channels must be registered conditionally",
    );
  });

  test("a problem in the file also leaves the layer off, not half-on", () => {
    const config = parseIntelligenceConfig("transport: copilot\n");
    assert.equal(config.kind, "problem");

    const main = code(read("main", "main.ts"));
    // Both `off` and `problem` return null from the switch — the second must
    // not fall through to a transport.
    assert.match(main, /case "off":\s*case "problem":\s*return null;/);
  });
});

describe("the preload attaches nothing", () => {
  test("the suggest object is spread in conditionally", () => {
    const preload = code(read("preload", "preload.ts"));

    assert.match(
      preload,
      /\.\.\.\(suggestAvailable \? \{ suggest: suggestApi \} : \{\}\)/,
      "the API must be absent, not present-and-disabled",
    );
  });

  test("availability comes from a window argument the main process sets", () => {
    const preload = code(read("preload", "preload.ts"));
    assert.match(preload, /process\.argv\.includes\("--waypoint-suggest"\)/);

    const window = code(read("main", "sort-window.ts"));
    assert.match(window, /additionalArguments: \["--waypoint-suggest"\]/);
    assert.match(
      window,
      /this\.suggestAvailable \?/,
      "the argument must be conditional on a configured transport",
    );
  });

  test("the exposed type marks suggest optional, so the renderer must check", () => {
    const preload = read("preload", "preload.ts");
    assert.match(preload, /suggest\?: typeof suggestApi/);
  });
});

describe("the renderer renders nothing", () => {
  test("the ask row is built only when the bridge exposed the verbs", () => {
    const renderer = code(read("renderer", "sort.ts"));

    assert.match(renderer, /const suggest = bridge\.suggest;/);
    assert.match(
      renderer,
      /if \(!suggest \|\| !currentItem\) \{\s*assist\.replaceChildren\(\);/,
      "with no bridge the assist area must be emptied, not populated and hidden",
    );
  });

  test("no control is ever rendered disabled instead of absent", () => {
    const renderer = code(read("renderer", "sort.ts"));

    // Extract the suggestion-rendering function and check it never reaches for
    // `disabled` or `hidden` on its own controls. (`setBusy` legitimately
    // disables Feature 2's five buttons during a write; that is a different
    // thing and lives elsewhere.)
    const ask = /function renderAsk\(\): void \{([\s\S]*?)\n\}/.exec(renderer);
    assert.ok(ask, "renderAsk must exist");
    assert.ok(!(ask[1] ?? "").includes("disabled"), "a suggestion control was disabled rather than omitted");
    assert.ok(!(ask[1] ?? "").includes("hidden"), "a suggestion control was hidden rather than omitted");
  });

  test("the markup carries an empty container and no suggestion buttons", () => {
    const html = read("renderer", "sort.html");

    // The container exists so the renderer has somewhere to put things. It is
    // empty in the shipped state, and `#assist:empty { display: none }` means
    // it takes no space either.
    assert.match(html, /<div id="assist"><\/div>/);
    assert.match(html, /#assist:empty \{ display: none; \}/);

    for (const id of ["to-split", "to-where", "send", "accept-split", "accept-destination"]) {
      assert.ok(!html.includes(`id="${id}"`), `${id} is in the markup, so it exists before anything checks`);
    }
  });

  test("Feature 2's five buttons are in the markup, unconditionally", () => {
    const html = read("renderer", "sort.html");
    for (const id of ["to-project", "to-area", "to-waiting", "to-calendar", "to-trash"]) {
      assert.ok(html.includes(`id="${id}"`), `${id} must always be there`);
    }
  });
});

describe("sort:split is the exception, and deliberately so", () => {
  test("it is registered and exposed always, because it is a SortService verb", () => {
    const ipc = code(read("main", "ipc.ts"));
    const preload = code(read("preload", "preload.ts"));

    // A user with no `intelligence.md` could type three pieces themselves and
    // this would write them. Its availability has nothing to do with whether a
    // model can be reached.
    assert.match(ipc, /ipcMain\.handle\("sort:split"/);
    assert.ok(!/suggestAvailable[\s\S]{0,200}sort:split/.test(ipc), "sort:split was made conditional");
    assert.match(preload, /split: \(ref: ItemRef, pieces: string\[\]\)/);
  });
});

/**
 * Regression, found by `notices.spec.ts` during Feature 8's own e2e run.
 *
 * `main.ts` reads `intelligence.md` before it builds the sort window, and
 * `FsVaultStore.read` treats only ENOENT as "absent" — anything else throws.
 * A vault root that is not a directory (which is exactly what the unwritable-
 * inbox fixture creates) therefore threw ENOTDIR out of startup and took the
 * whole application down with it, including capture.
 *
 * The failure is worth keeping a test for because of what it says about this
 * feature's shape: a file *this* layer owns must never be able to stop the
 * layers that were there before it. Unreadable is treated as absent — the
 * layer goes off, silently, and everything else starts (FR-055).
 */
describe("an unreadable intelligence.md cannot stop the application starting", () => {
  test("main treats a failed read as absent rather than letting it propagate", () => {
    const main = code(read("main", "main.ts"));

    assert.match(
      main,
      /vaultStore\.read\(INTELLIGENCE_PATH\)\.catch\(\(\) => null\)/,
      "a read failure here would take capture and sorting down with it",
    );
  });

  test("and parsing null is the off state, so the fallback is a real state", () => {
    assert.equal(parseIntelligenceConfig(null).kind, "off");
  });
});
