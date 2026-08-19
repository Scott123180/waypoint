import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as read } from "node:fs";

import { CaptureService } from "@waypoint/core";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { InboxMutex } from "../src/main/inbox-mutex";

/**
 * An item captured from the shutdown is indistinguishable from one captured
 * anywhere else (FR-044, FR-045, SC-008).
 *
 * Two halves, because the claim has two parts.
 *
 * **The bytes.** Three captures through one `CaptureService`, three through
 * another, and the two `inbox.md` files compared. They match because the shutdown
 * adds nothing — no marker, no tag, no field, no ordering — and the only way it
 * could add one is by sending something extra down the channel. Which is the
 * second half.
 *
 * **The channel.** The shutdown's bridge method is compared to the capture
 * window's, character by character where it matters: the same channel, the same
 * arguments, no third argument through which an origin could travel. A `source`
 * of `"typed"` is the same value the capture box sends when the user types.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-shutdown-capture-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function serviceAt(name: string): { service: CaptureService; path: string } {
  const path = join(dir, name, "inbox.md");
  return {
    service: new CaptureService({
      inbox: new FsInboxStore(path, new InboxMutex()),
      transcription: { transcribe: () => Promise.resolve("") },
    }),
    path,
  };
}

const THOUGHTS = [
  "Ask Priya about the March offsite",
  "The kitchen tap is dripping again",
  "Check whether the contract renewal is automatic",
];

describe("three captures, two surfaces", () => {
  test("produce a byte-identical inbox.md", async () => {
    const shutdown = serviceAt("shutdown");
    const capture = serviceAt("capture");

    // The shutdown's bridge sends `(text, "typed")`; so does the capture box.
    for (const text of THOUGHTS) await shutdown.service.submit(text, "typed");
    await shutdown.service.flush();

    for (const text of THOUGHTS) await capture.service.submit(text, "typed");
    await capture.service.flush();

    assert.equal(
      normalizeTimestamps(readFileSync(shutdown.path, "utf8")),
      normalizeTimestamps(readFileSync(capture.path, "utf8")),
    );
  });

  test("with the same grammar and a real capture timestamp on each", async () => {
    const { service, path } = serviceAt("shutdown");

    for (const text of THOUGHTS) await service.submit(text, "typed");
    await service.flush();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.match(line, /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} .+$/);
    }
  });

  test("and nothing recording where they were typed", async () => {
    const { service, path } = serviceAt("shutdown");

    for (const text of THOUGHTS) await service.submit(text, "typed");
    await service.flush();

    const content = readFileSync(path, "utf8");
    for (const forbidden of ["shutdown", "source", "origin", "typed", "#from", "@screen"]) {
      assert.ok(!content.includes(forbidden), `"${forbidden}" leaked into the inbox`);
    }
  });

  test("in capture order, one item each", async () => {
    const { service, path } = serviceAt("shutdown");

    for (const text of THOUGHTS) await service.submit(text, "typed");
    await service.flush();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.deepEqual(
      lines.map((line) => line.replace(/^- \S+ /, "")),
      THOUGHTS,
    );
  });
});

describe("the bridge sends exactly what the capture box sends", () => {
  const PRELOAD = read(join(__dirname, "..", "..", "src", "preload", "preload.ts"), "utf8");

  function bodyOf(object: string, method: string): string {
    const literal = new RegExp(`const ${object} = \\{([\\s\\S]*?)\\n\\};`).exec(PRELOAD);
    assert.ok(literal, `${object} must be declared in preload.ts`);

    const body = new RegExp(`\\n  ${method}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(literal[1] ?? "");
    assert.ok(body, `${object}.${method} must exist`);
    return (body[1] ?? "").trim();
  }

  test("the same channel", () => {
    assert.match(bodyOf("shutdownApi", "capture"), /ipcRenderer\.invoke\("capture:submit"/);
    assert.match(bodyOf("api", "submit"), /ipcRenderer\.invoke\("capture:submit"/);
  });

  test("the same arguments, with no third one an origin could travel in", () => {
    assert.equal(
      bodyOf("shutdownApi", "capture"),
      'return ipcRenderer.invoke("capture:submit", text, "typed");',
    );
  });

  test("and no channel of its own", () => {
    const literal = /const shutdownApi = \{([\s\S]*?)\n\};/.exec(PRELOAD)?.[1] ?? "";
    const channels = [...literal.matchAll(/ipcRenderer\.\w+\("([^"]+)"/g)].map((m) => m[1] as string);

    assert.ok(
      !channels.some((c) => c.startsWith("shutdown:") && /capture|inbox|undo/.test(c)),
      "capture from this screen must use the shipped channels, not new ones",
    );
  });

  test("`CaptureService` itself is untouched by this feature", () => {
    // Nothing is added, changed, or wrapped, which is why FR-046's budget and
    // the non-blocking guarantee are inherited rather than re-promised.
    const core = join(__dirname, "..", "..", "..", "core", "src", "capture", "capture-service.ts");
    assert.ok(!read(core, "utf8").toLowerCase().includes("shutdown"));
  });
});

/** Capture times are real instants, so two runs differ by milliseconds. */
function normalizeTimestamps(content: string): string {
  return content.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/g, "<captured>");
}
