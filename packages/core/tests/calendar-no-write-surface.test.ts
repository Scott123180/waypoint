import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as calendarDocument from "../src/calendar/calendar-document";
import * as calendarTypes from "../src/calendar/types";

/**
 * FR-031 and FR-042, made structural rather than promised (research R4).
 *
 * A calendar flag is information. There is no verb to schedule it, dismiss it,
 * clear it, or write it back — and the strongest available form of that is a
 * module with no write function in it at all. A contributor who wanted one
 * would have to add it to a file whose header says why it has none, which is a
 * visible edit rather than a quiet one.
 *
 * The source-reading below is deliberate, the same way
 * `suggest-no-write-surface.test.ts` reads its subject: a runtime check cannot
 * see an erased type, and "this module contains no writer" is exactly the kind
 * of claim that decays into a comment if nothing asserts it.
 *
 * `calendarLine()` — the writer — stays in `vault/lists.ts`, owned by sorting.
 * Its absence from here is the boundary, not an oversight.
 */

const DIR = join(__dirname, "..", "..", "src", "calendar");
const SOURCE = ["calendar-document.ts", "types.ts"]
  .map((file) => readFileSync(join(DIR, file), "utf8"))
  .join("\n");

/** Comments say what the code must not do; only the code itself is evidence. */
const CODE = SOURCE.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const EXPORTS = [...Object.keys(calendarDocument), ...Object.keys(calendarTypes)];

describe("the module's exported surface", () => {
  test("is the path and the parser, and nothing else", () => {
    assert.deepEqual(EXPORTS.sort(), ["CALENDAR_PATH", "readCalendar"]);
  });

  test("no export is a function that could write", () => {
    for (const forbidden of [
      "write",
      "append",
      "render",
      "line",
      "schedule",
      "dismiss",
      "clear",
      "remove",
      "commit",
      "save",
    ]) {
      const offender = EXPORTS.find((name) => name.toLowerCase().includes(forbidden));
      assert.equal(
        offender,
        undefined,
        `${offender} would make this module a writer; calendar items are information only (FR-042)`,
      );
    }
  });

  test("`readCalendar` takes a string, so it has no path and nothing to write to", () => {
    assert.equal(typeof calendarDocument.readCalendar, "function");
    assert.equal(calendarDocument.readCalendar.length, 1);
  });
});

describe("no write-capable dependency exists to be misused", () => {
  for (const capability of ["VaultStore", "Clock", "PolicyModule", "InboxStore", "InboxDocument"]) {
    test(`the module never names ${capability}`, () => {
      assert.ok(
        !CODE.includes(capability),
        `${capability} in calendar/ is a way to write, a date to invent, or a rule to hold`,
      );
    });
  }

  test("it never reaches for the line writer that lives in vault/lists", () => {
    assert.ok(!CODE.includes("calendarLine"), "rendering a line here would be a second writer");
  });
});

describe("there is no ref, because there is no verb to take one", () => {
  test("no `CalendarRef` type is declared", () => {
    // Read from the comment-stripped source: this module's header *names*
    // `CalendarRef` to say it has none, and a doc comment is not a declaration.
    assert.ok(!CODE.includes("CalendarRef"), "a ref implies a write this feature must not have");
  });

  test("`CalendarItem` carries no identity a verb could verify against", () => {
    // `index` and `raw` exist for the same reason they do on `WaitingItem` —
    // position and verbatim text — but nothing in core accepts them together
    // as a target, and `shutdown-calendar-read-only.test.ts` asserts that.
    const declaration = /export interface CalendarItem \{([\s\S]*?)\n\}/.exec(SOURCE);
    assert.ok(declaration, "CalendarItem must be declared where this test can read it");

    const fields = [...(declaration[1] ?? "").matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    assert.deepEqual(
      fields.sort(),
      ["capturedAt", "flaggedOn", "index", "raw", "text"],
      "a sixth field is where an event date, a duration, or a completion flag would arrive",
    );
  });
});
