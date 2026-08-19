import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import * as core from "../src/index";
import { populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * This feature introduces no domain term (Principle VII, FR-039).
 *
 * "Shutdown" names a **window** and a **read verb**. Nothing on disk knows the
 * word: there is no file, field, section, record, or line of user data it could
 * be written into, and no verb that would write one. Every other term the screen
 * uses — top three, outcome, done, project, active, DRI, next action, milestone,
 * waiting for, followed up, received, outstanding, stale, capture, inbox — is
 * one the user already has elsewhere, with the same meaning.
 *
 * The last block is the one worth keeping honest: a word that appears only in a
 * type name is a word the user never meets, while a word in a *string* is one
 * they read. The check is on the strings.
 */

const SRC = join(__dirname, "..", "..", "src");

const EXPORTS = Object.keys(core);

describe("the exported surface", () => {
  test("adds exactly the names the contract says it adds", () => {
    // Values only — types are erased and cannot be enumerated at runtime.
    const added = EXPORTS.filter((n) => /shutdown|calendar/i.test(n));

    assert.deepEqual(added.sort(), ["CALENDAR_PATH", "ShutdownService", "readCalendar"]);
  });

  test("every other name it introduces is a shape, not a new noun for the user", () => {
    // `Panel`, `SourceFailure`, `MyProject`, `StaleWaiting`, `StaleCalendar` and
    // `ShutdownView` are types. They describe how existing things are arranged
    // on one screen; none of them is a thing the user has or does.
    const source = readFileSync(join(SRC, "shutdown", "types.ts"), "utf8");
    const declared = [...source.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]);

    assert.deepEqual(declared?.sort(), [
      "MyProject",
      "Panel",
      "ShutdownView",
      "SourceFailure",
      "StaleCalendar",
      "StaleWaiting",
      "TopThreePanel",
    ]);
  });

  test("no exported name invents a synonym for something that already exists", () => {
    for (const forbidden of [
      /\bevening\b/i,
      /\bendofday\b/i,
      /\bwrapup\b/i,
      /\bcloseout\b/i,
      /\bdigest\b/i,
      /\bsummary\b/i,
      /\bbriefing\b/i,
      /\bagenda\b/i,
      /\bstreak\b/i,
    ]) {
      const offender = EXPORTS.find((name) => forbidden.test(name));
      assert.equal(offender, undefined, `${offender} is a new word for something the user already has`);
    }
  });
});

describe("no string the feature produces contains the word", () => {
  test("not anywhere in a full reading", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") return void strings.push(value);
      if (Array.isArray(value)) return value.forEach(walk);
      if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(view);

    assert.ok(strings.length > 10, "the fixture must produce strings to check");
    for (const value of strings) {
      assert.doesNotMatch(value, /shutdown/i, `"${value}" puts this feature's name in front of the user`);
    }
  });

  test("nor in the policy module's reason for a stale calendar flag", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();
    const reason = view.calendar.items[0]?.reason ?? "";

    assert.ok(reason.length > 0);
    assert.doesNotMatch(reason, /shutdown|daily|evening/i);
  });
});

describe("nothing on disk could hold the word", () => {
  test("no path this feature reads or could write is named for it", () => {
    assert.equal(core.CALENDAR_PATH, "calendar.md");

    const paths = EXPORTS.filter((n) => n.endsWith("_PATH")).map(
      (n) => (core as unknown as Record<string, string>)[n],
    );
    for (const path of paths) {
      assert.doesNotMatch(path ?? "", /shutdown/i);
    }
  });

  test("no source file in either new module writes anything at all", () => {
    for (const dir of ["shutdown", "calendar"]) {
      for (const file of readdirSync(join(SRC, dir))) {
        const code = readFileSync(join(SRC, dir, file), "utf8")
          .replace(/\/\*\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");

        for (const forbidden of ["vault.write", "appendLine", "writeFile"]) {
          assert.ok(!code.includes(forbidden), `${dir}/${file} contains ${forbidden}`);
        }
      }
    }
  });
});
