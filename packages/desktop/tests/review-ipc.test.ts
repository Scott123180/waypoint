import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The review's client boundary, guarded by reading the source.
 *
 * Three properties, each of which fails silently rather than loudly if it is
 * lost — which is why they are asserted here rather than trusted:
 *
 *   1. **Core's words reach the user unchanged.** Feature 4 recorded this trap:
 *      the projects renderer branches on a refusal's `reason` and renders its
 *      `message`, so a client that reworded or reshaped a refusal would silently
 *      stop showing a confirmation. The review is the second surface to face it.
 *
 *   2. **Sort navigation opens Feature 2's window** rather than reimplementing
 *      sorting inside the review (FR-016).
 *
 *   3. **Nothing starts a review on the user's behalf** — no timer, no
 *      scheduler, no auto-open (FR-006).
 *
 * Source-level rather than behavioural because wiring Electron's IPC into a
 * unit test would test the harness; what can go wrong here is someone writing
 * the wrong line, and that is visible in the file.
 */

const SOURCE = join(__dirname, "..", "..", "src");

function read(...parts: string[]): string {
  return readFileSync(join(SOURCE, ...parts), "utf8");
}

describe("the review renderer", () => {
  test("renders core's message rather than composing its own", () => {
    const renderer = read("renderer", "review.ts");

    assert.match(
      renderer,
      /rv\$\("error"\)\.textContent = result\.message/,
      "a refusal must be shown as the core phrased it",
    );
    assert.match(
      renderer,
      /rv\$\("warning"\)\.textContent = `\$\{result\.message\}/,
      "a warning must be shown as the core phrased it",
    );
  });

  test("does not decide which step comes next", () => {
    const renderer = read("renderer", "review.ts");

    // The renderer may know the order for rendering the rail, but it must not
    // decide whether a step may be passed — that is `advance()`'s answer.
    assert.doesNotMatch(
      renderer,
      /if \(.*inboxCount.*>.*0.*\)\s*\{[^}]*return/s,
      "the gate's decision belongs to the policy module",
    );
    assert.doesNotMatch(renderer, /stalenessDays|inboxGate/, "no rule value may appear in a client");
  });

  test("passes a confirmable refusal back with the confirmed flag", () => {
    const renderer = read("renderer", "review.ts");
    assert.match(renderer, /confirmable === true/, "a warning must be offerable as 'carry on'");
    assert.match(renderer, /advance\(confirmed \? \{ confirmed: true \} : undefined\)/);
  });
});

describe("sort navigation", () => {
  test("the review opens the existing sort window rather than sorting", () => {
    const ipc = read("main", "ipc.ts");
    assert.match(ipc, /ipcMain\.on\("review:open-sort", \(\) => showSort\(\)\)/);

    const renderer = read("renderer", "review.ts");
    assert.match(renderer, /rvwp\.openSort\(\)/);
    assert.doesNotMatch(renderer, /route|destination|trash\.md/, "sorting is Feature 2's surface");
  });

  test("returning from the sort window re-derives the count", () => {
    // The trip out was already covered; the trip back was not. `review:open-sort`
    // leaves the review visible, so `ReviewWindow.show()` — the only sender of
    // `review:refresh` — never fires again. Sorting to trash writes `inbox.md`
    // through `FsInboxStore` alone, which raises the inbox signal and not the
    // vault one, so without this subscription the review goes on showing the
    // count the user just went and changed (FR-016).
    const main = read("main", "main.ts");
    assert.match(main, /inboxChanged\.subscribe\(\(\) => reviewWindow\.inboxChanged\(\)\)/);

    const window = read("main", "review-window.ts");
    assert.match(window, /inboxChanged\(\): void \{/);

    const renderer = read("renderer", "review.ts");
    assert.match(renderer, /onInboxChanged\(/, "and the renderer acts on it");
  });

  test("no review channel writes the inbox", () => {
    const ipc = read("main", "ipc.ts");
    const block = ipc.slice(ipc.indexOf("export function registerReviewIpc"));

    assert.doesNotMatch(block, /inbox:(append|submit|remove)/);
    assert.doesNotMatch(block, /sort\.(decide|commit)/);
  });
});

describe("every verb the renderer calls actually exists", () => {
  /**
   * The gap this catches, found the hard way: `topThreeStep()` was declared on
   * the renderer's `RvApi`, called by the top-three step, and implemented in
   * neither the preload nor `ipc.ts`. `RvApi` is a hand-written interface over
   * an object crossing the context bridge, so TypeScript checks the *shape the
   * renderer expects* and never that anything provides it — the call returned
   * `undefined is not a function` at runtime, and the step rendered blank while
   * every type check and every unit test stayed green.
   *
   * Asserted by reading the source because that is where the omission lives.
   */
  const RENDERER_ONLY = new Set([
    // Signals the preload subscribes to rather than verbs it invokes.
    "onRefresh",
    "onVaultChanged",
    "onInboxChanged",
  ]);

  test("the preload implements every method the renderer's RvApi declares", () => {
    const renderer = read("renderer", "review.ts");
    const preload = read("preload", "preload.ts");

    const api = /interface RvApi \{([\s\S]*?)\n\}/.exec(renderer)?.[1] ?? "";
    assert.ok(api.length > 0, "RvApi should be findable");

    const declared = [...api.matchAll(/^\s{2}(\w+)[(<]/gm)].map((m) => m[1] ?? "");
    assert.ok(declared.length > 10, "and should have found its methods");

    const reviewApi = preload.slice(preload.indexOf("const reviewApi"));
    for (const name of declared) {
      if (RENDERER_ONLY.has(name)) continue;
      assert.match(
        reviewApi,
        new RegExp(`\\n  ${name}\\(`),
        `renderer calls review.${name}(), which the preload does not implement`,
      );
    }
  });

  test("every channel the preload invokes is registered in ipc.ts", () => {
    const preload = read("preload", "preload.ts");
    const ipc = read("main", "ipc.ts");

    const reviewApi = preload.slice(preload.indexOf("const reviewApi"));
    const channels = new Set(
      [...reviewApi.matchAll(/ipcRenderer\.(?:invoke|send)\("(review:[^"]+)"/g)].map((m) => m[1] ?? ""),
    );
    assert.ok(channels.size > 10, "should have found the review channels");

    for (const channel of channels) {
      // `\s*` because a handler with a long signature wraps its channel name
      // onto the next line — a formatting choice, not a missing registration.
      assert.match(
        ipc,
        new RegExp(`ipcMain\\.(handle|on)\\(\\s*"${channel}"`),
        `the preload invokes ${channel}, which nothing registers`,
      );
    }
  });
});

describe("the review is never started for the user", () => {
  test("main.ts registers no timer, interval, or scheduler around the review", () => {
    const main = read("main", "main.ts");

    assert.doesNotMatch(main, /setInterval\([^)]*[Rr]eview/, "no scheduled review");
    assert.doesNotMatch(main, /setTimeout\([^)]*[Rr]eview/, "no delayed review");
    assert.doesNotMatch(main, /reviewService\.start\(\)/, "startup must not start a review");
  });

  test("the window is created on demand and opened only by an explicit action", () => {
    const main = read("main", "main.ts");

    assert.match(main, /const showReview = \(\): void => reviewWindow\.show\(\);/);
    assert.match(main, /onReview: showReview/, "the tray entry is the user's way in");
    assert.doesNotMatch(main, /reviewWindow\.show\(\);\s*\n\s*app\./, "nothing opens it at startup");
  });
});

describe("resuming", () => {
  test("opening the window reads the review rather than starting one", () => {
    const renderer = read("renderer", "review.ts");

    // Load calls `current()` through `rvRender`. `start()` is reachable only
    // from the explicit button, which is what keeps FR-006 true from the
    // renderer's side as well as main's.
    assert.match(renderer, /^void rvRender\(\)/m, "load reads");
    assert.doesNotMatch(renderer, /^\s*void rvwp\.start\(\);/m, "load does not start");

    const window = read("main", "review-window.ts");
    assert.match(window, /review:refresh/, "showing re-reads, so a hand-edit is picked up");
  });

  test("the walk position is derived in the renderer too, never stored", () => {
    const renderer = read("renderer", "review.ts");

    assert.match(
      renderer,
      /walk\.find\(\(e\) => !e\.reviewed\)/,
      "the next project is the first with no record — read from the log every time",
    );
    assert.doesNotMatch(
      renderer,
      /let rv(At|Cursor|Index|WalkAt)\b/,
      "a stored index would survive a hand-edit to the log and be wrong",
    );
  });
});

describe("the review is wired to the shared vault store", () => {
  test("so its writes raise the change signal every other view listens to", () => {
    const main = read("main", "main.ts");
    const block = main.slice(main.indexOf("new ReviewService({"), main.indexOf("const sortWindow"));

    assert.match(block, /vault: vaultStore/, "the same store, so the signal is raised for free");
    assert.match(block, /projects: projectService/, "changes go through the owning service");
    assert.match(block, /topThree: topThreeService/);
    assert.doesNotMatch(block, /summary:/, "no provider ships — that is the shipped configuration");

    assert.match(main, /vaultChanged\.subscribe\(\(\) => reviewWindow\.vaultChanged\(\)\)/);
  });
});
