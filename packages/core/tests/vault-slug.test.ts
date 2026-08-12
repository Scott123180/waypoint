import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { slugify, uniqueSlug } from "../src/vault/slug";

/**
 * Slug equality is the duplicate test (FR-012), so these rules decide whether
 * two titles are "the same project".
 */

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    assert.equal(slugify("Roof Repair"), "roof-repair");
  });

  test("collapses runs of punctuation and whitespace", () => {
    assert.equal(slugify("Roof   Repair!!!"), "roof-repair");
  });

  test("trims leading and trailing separators", () => {
    assert.equal(slugify("  Roof Repair  "), "roof-repair");
    assert.equal(slugify("--Roof--"), "roof");
  });

  test("case and spacing variants collapse to one slug", () => {
    // This is what makes "Roof Repair" and "roof  repair" the same project.
    const variants = ["Roof Repair", "roof repair", "  ROOF   repair ", "Roof-Repair"];
    const slugs = new Set(variants.map(slugify));
    assert.equal(slugs.size, 1);
  });

  test("keeps digits", () => {
    assert.equal(slugify("Q3 2026 planning"), "q3-2026-planning");
  });

  test("a title of only punctuation slugs to empty", () => {
    // Callers treat this as an empty title (FR-011) rather than writing a file
    // named nothing.
    assert.equal(slugify("???"), "");
    assert.equal(slugify("   "), "");
  });

  test("non-ASCII characters are replaced rather than dropped silently", () => {
    // A filename-safe slug; the verbatim title still lives in the heading.
    assert.equal(slugify("Café ☕ planning"), "caf-planning");
  });
});

describe("uniqueSlug", () => {
  test("returns the base when nothing has taken it", () => {
    assert.equal(uniqueSlug("roof-repair", []), "roof-repair");
  });

  test("suffixes only when a different title collides", () => {
    assert.equal(uniqueSlug("roof-repair", ["roof-repair"]), "roof-repair-2");
  });

  test("keeps counting past an existing suffix", () => {
    assert.equal(
      uniqueSlug("roof-repair", ["roof-repair", "roof-repair-2", "roof-repair-3"]),
      "roof-repair-4",
    );
  });

  test("ignores unrelated slugs", () => {
    assert.equal(uniqueSlug("roof-repair", ["gutters", "windows"]), "roof-repair");
  });
});
