import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CaptureService, EmptyCaptureError } from "@waypoint/core";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { InboxMutex } from "../src/main/inbox-mutex";

/**
 * Consecutive captures are separate thoughts (FR-047, FR-048).
 *
 * Nothing merges, splits, deduplicates, or rewrites them, and an empty or
 * whitespace-only entry captures nothing at all — an empty box is not a mistake
 * to be corrected.
 *
 * **FR-046's responsiveness budget is deliberately not re-asserted here.** No
 * capture code is added, changed, or wrapped by this feature: the shutdown sends
 * the same two arguments down the same channel to the same service. Re-testing
 * the budget would be re-testing Feature 1, and a second copy of that assertion
 * would be free to drift from the first.
 */

let dir: string;
let inboxPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-shutdown-capture-"));
  inboxPath = join(dir, "inbox.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function service(): CaptureService {
  return new CaptureService({
    inbox: new FsInboxStore(inboxPath, new InboxMutex()),
    transcription: { transcribe: () => Promise.resolve("") },
  });
}

function lines(): string[] {
  return existsSync(inboxPath)
    ? readFileSync(inboxPath, "utf8").trim().split("\n").filter((l) => l.length > 0)
    : [];
}

describe("three thoughts in a row", () => {
  test("are three items, in capture order", async () => {
    const capture = service();

    for (const text of ["first", "second", "third"]) await capture.submit(text, "typed");
    await capture.flush();

    assert.deepEqual(
      lines().map((line) => line.replace(/^- \S+ /, "")),
      ["first", "second", "third"],
    );
  });

  test("nothing merges two of them into one", async () => {
    const capture = service();

    await capture.submit("call the plumber", "typed");
    await capture.submit("call the plumber", "typed");
    await capture.flush();

    assert.equal(lines().length, 2, "two identical thoughts are two thoughts, not one deduplicated");
  });

  test("nothing splits one of them into two", async () => {
    const capture = service();

    await capture.submit("call the plumber and book the offsite", "typed");
    await capture.flush();

    assert.equal(lines().length, 1);
    assert.match(lines()[0] ?? "", /call the plumber and book the offsite$/);
  });

  test("and nothing rewrites the words", async () => {
    const capture = service();
    const text = "ask  Priya   about the offsite — before Friday";

    await capture.submit(text, "typed");
    await capture.flush();

    assert.ok((lines()[0] ?? "").endsWith(text));
  });
});

describe("an empty entry", () => {
  test("captures nothing", async () => {
    const capture = service();

    await assert.rejects(() => capture.submit("", "typed"), EmptyCaptureError);
    await capture.flush();

    assert.deepEqual(lines(), []);
  });

  test("and neither does a whitespace-only one", async () => {
    const capture = service();

    await assert.rejects(() => capture.submit("   \t  ", "typed"), EmptyCaptureError);
    await capture.flush();

    assert.deepEqual(lines(), []);
  });

  test("no inbox file is created by an empty capture", async () => {
    const capture = service();

    await assert.rejects(() => capture.submit("  ", "typed"), EmptyCaptureError);
    await capture.flush();

    assert.ok(!existsSync(inboxPath));
  });
});

describe("the renderer guards the empty case before the channel", () => {
  const RENDERER = readFileSync(
    join(__dirname, "..", "..", "src", "renderer", "shutdown.ts"),
    "utf8",
  );

  test("a blank box sends nothing and says nothing", () => {
    const body = /function sdCapture\(\): void \{([\s\S]*?)\n\}/.exec(RENDERER)?.[1] ?? "";

    assert.match(body, /if \(text\.trim\(\)\.length === 0\) \{[\s\S]*?return;/);
    assert.ok(!/sdError\(["'`]/.test(body), "an empty box is not a mistake to be announced");
  });

  test("the box is cleared before the write returns, not after", () => {
    const body = /function sdCapture\(\): void \{([\s\S]*?)\n\}/.exec(RENDERER)?.[1] ?? "";
    const cleared = body.indexOf('input.value = ""', body.indexOf("input.focus") - 200);
    const sent = body.indexOf("sdwp.capture(");

    assert.ok(cleared >= 0 && sent > cleared, "a late clear races the user's next keystroke");
  });

  test("focus stays on the box, so the next thought can follow immediately", () => {
    const body = /function sdCapture\(\): void \{([\s\S]*?)\n\}/.exec(RENDERER)?.[1] ?? "";

    assert.match(body, /input\.focus\(\)/);
  });

  test("no panel is navigated away from and no window is hidden on capture", () => {
    const body = /function sdCapture\(\): void \{([\s\S]*?)\n\}/.exec(RENDERER)?.[1] ?? "";

    assert.ok(!body.includes("dismiss"), "capturing must not close the screen");
    assert.ok(!body.includes("sdPaint"), "and must not repaint it — membership is fixed");
  });

  test("closing mid-typing saves no draft", () => {
    // There is nothing that could: no storage, no persistence, and the only
    // thing that ever leaves this file is a submitted capture.
    for (const forbidden of ["localStorage", "sessionStorage", "draft"]) {
      assert.ok(!RENDERER.includes(forbidden), `${forbidden} would be a draft this screen must not keep`);
    }
  });
});
