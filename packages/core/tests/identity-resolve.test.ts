import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildCorpus } from "../src/identity/corpus";
import { resolveDri } from "../src/identity/resolve";
import type { Identity } from "../src/identity/types";

/**
 * The four-way answer, and the prohibition that gives it its value.
 *
 * `resolveDri` is pure and synchronous, which is what lets the whole matrix be
 * a table with no fakes and no filesystem.
 *
 * The second half of this file is the important one. It is a **prohibition**:
 * matching handles formatting differences and never guesses at identity. If
 * any row there flips to `mine`, the feature is misattributing another
 * person's work to the user, or counting it against their limit.
 */

const ME: Identity = { canonical: "Scott Rodgers", aliases: ["scott", "S. Rodgers"] };
const NO_CORPUS = buildCorpus([]);

/** A corpus built from bare names, without needing whole projects. */
function corpusOf(...names: string[]) {
  return buildCorpus(
    names.map((dri, i) => ({
      slug: `p${i}`,
      title: `P${i}`,
      status: "active" as const,
      outcome: null,
      nextAction: null,
      dri,
      milestones: [],
      completedOn: null,
      unprocessed: [],
    })),
  );
}

describe("resolveDri: the four answers", () => {
  test("the canonical value is the user", () => {
    assert.equal(resolveDri("Scott Rodgers", ME, NO_CORPUS).resolution, "mine");
  });

  test("an alias is the user, exactly as if it were the canonical value", () => {
    assert.equal(resolveDri("scott", ME, NO_CORPUS).resolution, "mine");
    assert.equal(resolveDri("S. Rodgers", ME, NO_CORPUS).resolution, "mine");
  });

  test("every formatting variant of a configured name is the user (SC-005)", () => {
    for (const variant of [
      "Scott Rodgers",
      "scott rodgers",
      "  Scott Rodgers  ",
      "Scott   Rodgers",
      "Scott Rodgers.",
      " SCOTT   rodgers. ",
    ]) {
      assert.equal(
        resolveDri(variant, ME, NO_CORPUS).resolution,
        "mine",
        `${JSON.stringify(variant)} is a formatting variant, not a different person`,
      );
    }
  });

  test("an unknown name is someone else's", () => {
    assert.equal(resolveDri("Priya Sharma", ME, NO_CORPUS).resolution, "theirs");
  });

  test("no DRI at all is unassigned, which is not the same as someone else's", () => {
    assert.equal(resolveDri(null, ME, NO_CORPUS).resolution, "unassigned");
    assert.equal(resolveDri("   ", ME, NO_CORPUS).resolution, "unassigned");
    assert.equal(resolveDri(null, ME, NO_CORPUS).raw, null);
  });

  test("with no identity configured, a named DRI is theirs — never unassigned", () => {
    // Conflating the two would make every named project look unowned the
    // moment identity was missing, and `unassigned` is what drives the
    // needs-a-DRI signal (FR-031, FR-032).
    const none: Identity = { canonical: null, aliases: [] };
    assert.equal(resolveDri("Scott Rodgers", none, NO_CORPUS).resolution, "theirs");
    assert.equal(resolveDri(null, none, NO_CORPUS).resolution, "unassigned");
  });

  test("aliases without a canonical value resolve nothing to the user", () => {
    const halfConfigured: Identity = { canonical: null, aliases: ["scott"] };
    assert.equal(resolveDri("scott", halfConfigured, NO_CORPUS).resolution, "theirs");
  });

  test("the raw value is carried through exactly as written", () => {
    assert.equal(resolveDri("  Scott Rodgers  ", ME, NO_CORPUS).raw, "  Scott Rodgers  ");
  });

  test("the answer is always exactly one of the four", () => {
    const all = ["Scott Rodgers", "Priya", null, "scott"];
    for (const dri of all) {
      const { resolution } = resolveDri(dri, ME, corpusOf("Scott R."));
      assert.ok(
        ["mine", "theirs", "unassigned", "ambiguous"].includes(resolution),
        `${resolution} is not one of the four`,
      );
    }
  });
});

describe("resolveDri: a shorter name is never a longer one (FR-026, SC-006)", () => {
  /**
   * The prohibition. Two people on a team can share a first name, and quietly
   * merging them would misattribute their work or count it against the user's
   * limit. If the user wants two spellings treated as themselves, they add both
   * to the alias list deliberately (FR-027).
   */
  const pairs: Array<[string, Identity, string]> = [
    ["a longer name is a different person", { canonical: "Scott", aliases: [] }, "Scott Rodgers"],
    ["a shorter name is a different person", { canonical: "Scott Rodgers", aliases: [] }, "Scott"],
    ["initials are never expanded", { canonical: "Scott Rodgers", aliases: [] }, "S. Rodgers"],
    ["an initial is not the full name", { canonical: "S. Rodgers", aliases: [] }, "Scott Rodgers"],
    ["no substring containment", { canonical: "Scott Rodgers", aliases: [] }, "scottrodgers"],
    ["no character-prefix matching", { canonical: "Scott", aliases: [] }, "Scottie"],
    ["no edit-distance matching", { canonical: "Scott", aliases: [] }, "Scot"],
    ["no middle-name dropping", { canonical: "Scott Rodgers", aliases: [] }, "Scott A Rodgers"],
    ["no surname-only matching", { canonical: "Scott Rodgers", aliases: [] }, "Rodgers"],
    ["no reordering", { canonical: "Scott Rodgers", aliases: [] }, "Rodgers Scott"],
  ];

  for (const [name, identity, dri] of pairs) {
    test(name, () => {
      assert.equal(
        resolveDri(dri, identity, NO_CORPUS).resolution,
        "theirs",
        `${JSON.stringify(dri)} must not resolve to ${JSON.stringify(identity.canonical)}`,
      );
    });
  }

  test("adding the spelling to the alias list is the only way in", () => {
    const before: Identity = { canonical: "Scott Rodgers", aliases: [] };
    assert.equal(resolveDri("Scott", before, NO_CORPUS).resolution, "theirs");

    const after: Identity = { canonical: "Scott Rodgers", aliases: ["Scott"] };
    assert.equal(resolveDri("Scott", after, NO_CORPUS).resolution, "mine");
  });

  test("0% of the shorter/longer fixture resolves to the user", () => {
    const resolved = pairs.filter(
      ([, identity, dri]) => resolveDri(dri, identity, NO_CORPUS).resolution === "mine",
    );
    assert.deepEqual(resolved, [], "the matching rules must never merge two names on their own");
  });
});
