import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeName } from "../src/identity/normalize";

/**
 * Formatting differences only, never a guess at identity (FR-022–FR-026).
 *
 * The result is a **word list**, not a string, because ambiguity is a
 * word-boundary question: `Scott` colliding with `Scott R.` is a fact about
 * words, and comparing characters would make `Scott` collide with `Scottie`
 * too — a different person by any reading.
 */

describe("normalizeName", () => {
  test("lowercases", () => {
    assert.deepEqual(normalizeName("Scott Rodgers"), ["scott", "rodgers"]);
    assert.deepEqual(normalizeName("SCOTT RODGERS"), ["scott", "rodgers"]);
  });

  test("trims surrounding whitespace", () => {
    assert.deepEqual(normalizeName("   Scott Rodgers   "), ["scott", "rodgers"]);
    assert.deepEqual(normalizeName("\tScott\n"), ["scott"]);
  });

  test("collapses repeated internal whitespace", () => {
    assert.deepEqual(normalizeName("Scott      Rodgers"), ["scott", "rodgers"]);
    assert.deepEqual(normalizeName("Scott\tRodgers"), ["scott", "rodgers"]);
  });

  test("ignores one trailing period", () => {
    assert.deepEqual(normalizeName("Scott R."), ["scott", "r"]);
    assert.deepEqual(normalizeName("Scott R"), ["scott", "r"]);
    assert.deepEqual(normalizeName("Scott Rodgers."), ["scott", "rodgers"]);
  });

  test("every formatting variant of one name normalizes identically", () => {
    const canonical = normalizeName("Scott Rodgers");
    for (const variant of [
      "scott rodgers",
      "SCOTT RODGERS",
      "  Scott Rodgers  ",
      "Scott   Rodgers",
      "Scott Rodgers.",
      " scott   RODGERS. ",
    ]) {
      assert.deepEqual(normalizeName(variant), canonical, `${JSON.stringify(variant)} should match`);
    }
  });

  test("an absent, blank or punctuation-only name is no name at all", () => {
    for (const nothing of [null, "", "   ", ".", " . "]) {
      assert.deepEqual(normalizeName(nothing), [], `${JSON.stringify(nothing)} should be absent`);
    }
  });

  test("interior punctuation is left alone", () => {
    // Only a *trailing* period is formatting. A period inside a name is part
    // of it, and stripping more would start guessing.
    assert.deepEqual(normalizeName("J.R. Rodgers"), ["j.r.", "rodgers"]);
  });

  test("names that differ by a word do not normalize together", () => {
    assert.notDeepEqual(normalizeName("Scott"), normalizeName("Scott Rodgers"));
    assert.notDeepEqual(normalizeName("Scott"), normalizeName("Scottie"));
    assert.notDeepEqual(normalizeName("Scott R."), normalizeName("Scott K."));
  });
});
