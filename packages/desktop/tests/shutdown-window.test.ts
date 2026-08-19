import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every opening is a cold one (FR-010c, research R8).
 *
 * This window hides rather than closes — every other view does too, and for the
 * same reason: nothing here is in progress, so hiding is always safe. But hiding
 * means the renderer and its last-painted answer survive, and a second opening
 * would otherwise redisplay a reading taken hours ago.
 *
 * `shutdown:opened` is what prevents that. It is sent on **every** `show()`,
 * including when the window already exists and was merely hidden, because that
 * is the case it exists for. It carries no payload: it is a signal to re-read,
 * not data.
 *
 * Source-level, in the style `review-ipc.test.ts` sets out: wiring Electron's
 * `BrowserWindow` into a unit test would test the harness. What can go wrong
 * here is someone writing the wrong line — putting the send inside the
 * `if (!this.window)` branch, say — and that is visible in the file. The
 * behaviour end-to-end is `shutdown-glance.spec.ts`'s.
 */

const SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "main", "shutdown-window.ts"),
  "utf8",
);

/** Comments say what the code must do; only the code itself is evidence. */
const CODE = SOURCE.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function bodyOf(method: string): string {
  const match = new RegExp(`\\n  ${method}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(CODE);
  assert.ok(match, `${method}() must be declared in shutdown-window.ts to be readable here`);
  return match[1] ?? "";
}

describe("show()", () => {
  test("sends `shutdown:opened`", () => {
    assert.match(bodyOf("show"), /webContents\.send\("shutdown:opened"\)/);
  });

  test("sends it unconditionally, not only when the window is created", () => {
    const body = bodyOf("show");
    const send = body.indexOf('send("shutdown:opened")');
    const guard = body.indexOf("if (!this.window)");

    assert.ok(guard >= 0, "the lazy create is still there");
    assert.ok(send > guard, "the signal must not live inside the create branch");
    assert.doesNotMatch(
      body.slice(guard, send),
      /\{[^}]*send\(/,
      "a second opening of a hidden window must still be a cold one",
    );
  });

  test("sends no payload — it is a signal to re-read, not data", () => {
    assert.doesNotMatch(bodyOf("show"), /send\("shutdown:opened",/);
  });

  test("shows and focuses, like every other view", () => {
    const body = bodyOf("show");
    assert.match(body, /this\.window\?\.show\(\)/);
    assert.match(body, /this\.window\?\.focus\(\)/);
  });
});

describe("the window hides rather than closes", () => {
  test("close is prevented and the window is hidden", () => {
    assert.match(CODE, /window\.on\("close",\s*\(event\)\s*=>\s*\{[\s\S]*?event\.preventDefault\(\)/);
    assert.match(CODE, /window\.on\("close"[\s\S]*?window\.hide\(\)/);
  });

  test("hide() exists for the dismiss channel to call", () => {
    assert.match(CODE, /\n  hide\(\): void \{[\s\S]*?this\.window\?\.hide\(\)/);
  });

  test("nothing is persisted, drafted, or resumed on the way out", () => {
    for (const forbidden of ["localStorage", "writeFile", "draft", "resume", "restore", "session"]) {
      assert.ok(!CODE.includes(forbidden), `${forbidden} would be state this screen must not hold`);
    }
  });
});

describe("it loads its own page and nothing else", () => {
  test("shutdown.html", () => {
    assert.match(CODE, /loadFile\(join\(__dirname, "\.\.", "renderer", "shutdown\.html"\)\)/);
  });

  test("through the same preload every other window uses", () => {
    assert.match(CODE, /preload: join\(__dirname, "\.\.", "preload", "preload\.js"\)/);
    assert.match(CODE, /contextIsolation: true/);
    assert.match(CODE, /nodeIntegration: false/);
  });
});
