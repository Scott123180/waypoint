import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DECISION_POINTS } from "../src/ports/index";
import { SuggestionService } from "../src/suggest/suggestion-service";

/**
 * FR-035: nothing is written because the module asked. Made structural rather
 * than asserted (research R11).
 *
 * Feature 6 got its read-only guarantee by narrowing a dependency type. This
 * goes further: there is no write-capable dependency to narrow. A contributor
 * who wanted to write from here would have to add a constructor parameter,
 * which is a visible edit in a file this test reads.
 *
 * The source-reading below is deliberate. A runtime check cannot see an
 * erased type, and "the deps interface has no `journal` field" is exactly the
 * kind of claim that decays into a comment if nothing asserts it.
 */

const SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "suggest", "suggestion-service.ts"),
  "utf8",
);

/** Comments say what the code must not do; only the code itself is evidence. */
const CODE = SOURCE.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the service exposes only the two asking verbs", () => {
  test("its prototype has nothing else on it", () => {
    const surface = Object.getOwnPropertyNames(SuggestionService.prototype).filter(
      (n) => n !== "constructor",
    );
    // Private helpers land here too, so they are listed — the same way
    // `sort-scope-boundaries.test.ts` lists `readDestinations` and
    // `resolveCreate`. Naming them all is what makes an addition visible.
    assert.deepEqual(surface.sort(), [
      "bind",
      "prepareDestination",
      "prepareSplit",
      "readAreas",
      "readProjects",
    ]);
  });

  test("no method name reaches for a write, a commit, or an acceptance", () => {
    const surface = Object.getOwnPropertyNames(SuggestionService.prototype);
    for (const forbidden of ["write", "commit", "apply", "accept", "sort", "save", "delete"]) {
      assert.ok(
        !surface.some((n) => n.toLowerCase().includes(forbidden)),
        `SuggestionService must not expose "${forbidden}" — accepting is the client's call to sort()`,
      );
    }
  });

  test("each verb takes exactly one argument, so nothing batches", () => {
    assert.equal(SuggestionService.prototype.prepareSplit.length, 1);
    assert.equal(SuggestionService.prototype.prepareDestination.length, 1);
  });
});

describe("no write-capable dependency exists to be misused", () => {
  for (const capability of [
    "VaultStore",
    "SortService",
    "SortJournal",
    "InboxDocument",
    "InboxStore",
    "PolicyModule",
  ]) {
    test(`the service never names ${capability}`, () => {
      assert.ok(
        !CODE.includes(capability),
        `${capability} in suggestion-service.ts is a way to write, or a way to consult a rule`,
      );
    });
  }

  test("no policy dependency — absent, not injected-and-unused", () => {
    // Injected-and-unused would let a future contributor consult a rule from
    // here with no visible change. Absent means they must edit the constructor.
    assert.ok(!/\bpolicy\b/i.test(CODE), "the service references policy");
    assert.ok(!CODE.includes("decide("), "the service consults a decision point");
  });

  test("no Clock — a split takes its timestamp from the item it divides", () => {
    assert.ok(!CODE.includes("Clock"), "a clock here is a timestamp this feature must not invent");
  });

  test("the dependency interface declares exactly three fields", () => {
    const declaration = /export interface SuggestionServiceDeps \{([\s\S]*?)\n\}/.exec(SOURCE);
    assert.ok(declaration, "SuggestionServiceDeps must be declared in this file to be readable here");

    const fields = [...(declaration[1] ?? "").matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    assert.deepEqual(
      fields.sort(),
      ["catalog", "intelligence", "timeoutMs"],
      "a fourth dependency is where a write verb, a rule, or a path would arrive",
    );
  });
});

describe("this feature adds no decision point", () => {
  test("the count is still five", () => {
    assert.equal(DECISION_POINTS.length, 5, "a proposal the user may reject holds no rule to enforce");
  });

  test("and none of them is named for a suggestion", () => {
    for (const point of DECISION_POINTS) {
      assert.doesNotMatch(point, /suggest|propose|split|intelligence/i);
    }
  });
});
