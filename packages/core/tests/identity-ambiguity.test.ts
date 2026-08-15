import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildCorpus } from "../src/identity/corpus";
import { resolveDri } from "../src/identity/resolve";
import type { Identity } from "../src/identity/types";
import type { Milestone, Project } from "../src/projects/types";

/**
 * Ambiguity: a matched name that could also be somebody else (FR-028, FR-029).
 *
 * The operational definition is a **leading-word collision** — a matched value
 * that is a strict leading subsequence of another distinct name in the data.
 * `Scott` against `Scott R.` is ambiguous; `Scott` against `Scottie` is not,
 * because the question is about words, not characters.
 *
 * What matters most: ambiguity never *resolves* anything. It only demotes a
 * confident `mine` to "ask a human", which is why an ambiguous DRI does not
 * count toward the WIP limit either — an unresolved identity is not the user's.
 */

function project(dri: string | null, verifiers: string[] = []): Project {
  const milestones: Milestone[] = verifiers.map((verifier, index) => ({
    index,
    definitionOfDone: `m${index}`,
    verifier,
    done: false,
    completedOn: null,
    raw: `- [ ] m${index} — @${verifier}`,
  }));
  return {
    slug: "p",
    title: "P",
    status: "active",
    outcome: null,
    nextAction: null,
    dri,
    milestones,
    completedOn: null,
    unprocessed: [],
    // Feature 5 added the ledger to `Project`. Empty is the honest value for a
    // fixture that has had no action recorded against it.
    ledger: [],
  };
}

describe("ambiguity", () => {
  test("a matched alias colliding with a longer distinct name is ambiguous", () => {
    const me: Identity = { canonical: "Scott Rodgers", aliases: ["Scott"] };
    const corpus = buildCorpus([project("Scott"), project("Scott R.")]);

    const result = resolveDri("Scott", me, corpus);
    assert.equal(result.resolution, "ambiguous");
    assert.deepEqual(result.collidesWith, ["Scott R."]);
  });

  test("the reason names the other name, as written", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Scott"), project("  scott   r.  ")]);

    const result = resolveDri("Scott", me, corpus);
    assert.equal(result.resolution, "ambiguous");
    assert.deepEqual(result.collidesWith, ["  scott   r.  "], "as written, so the user can find it");
  });

  test("more than one collision is reported", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Scott"), project("Scott R."), project("Scott K.")]);

    const result = resolveDri("Scott", me, corpus);
    assert.equal(result.resolution, "ambiguous");
    assert.equal(result.collidesWith?.length, 2);
  });

  test("a corpus name SHORTER than the match is not a collision", () => {
    // `Scott Rodgers` is unambiguous even when a bare `Scott` exists: the bare
    // one is somebody else, and the full one can only be the user.
    const me: Identity = { canonical: "Scott Rodgers", aliases: [] };
    const corpus = buildCorpus([project("Scott Rodgers"), project("Scott")]);

    assert.equal(resolveDri("Scott Rodgers", me, corpus).resolution, "mine");
  });

  test("collision is word-level, not character-level", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Scott"), project("Scottie")]);

    assert.equal(resolveDri("Scott", me, corpus).resolution, "mine", "Scottie is not Scott plus a word");
  });

  test("a name matching an identity value is not evidence against itself (FR-028c)", () => {
    // Both spellings in this vault are the user's own. `Scott` is a leading
    // prefix of `Scott Rodgers`, but `Scott Rodgers` is *the user*, not a
    // second person — so there is nothing to be ambiguous about, in either
    // direction. This is the whole point of excluding identity values from the
    // evidence: otherwise declaring an alias would make yourself ambiguous
    // with yourself.
    const me: Identity = { canonical: "Scott Rodgers", aliases: ["Scott"] };
    const corpus = buildCorpus([project("Scott"), project("Scott Rodgers", ["Scott"])]);

    assert.equal(resolveDri("Scott", me, corpus).resolution, "mine");
    assert.equal(resolveDri("Scott Rodgers", me, corpus).resolution, "mine");
  });

  test("a real second person still makes the alias ambiguous", () => {
    // The contrast to the case above: add a name that is *not* the user's, and
    // the same alias becomes ambiguous.
    const me: Identity = { canonical: "Scott Rodgers", aliases: ["Scott"] };
    const corpus = buildCorpus([project("Scott"), project("Scott Rodgers"), project("Scott Kim")]);

    const result = resolveDri("Scott", me, corpus);
    assert.equal(result.resolution, "ambiguous");
    assert.deepEqual(result.collidesWith, ["Scott Kim"]);
  });

  test("an unmatched name is never ambiguous — it is simply theirs", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Priya"), project("Priya Sharma")]);

    // Two other people sharing a first name is not the user's problem to be
    // warned about: nothing is being resolved to the user, so nothing can be
    // misattributed. Detecting it would require inferring who they are.
    assert.equal(resolveDri("Priya", me, corpus).resolution, "theirs");
  });

  test("ambiguity is a property of the whole vault, not of one project", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };

    assert.equal(resolveDri("Scott", me, buildCorpus([project("Scott")])).resolution, "mine");
    assert.equal(
      resolveDri("Scott", me, buildCorpus([project("Scott"), project("Scott R.")])).resolution,
      "ambiguous",
      "the same project resolves differently once a second Scott exists elsewhere",
    );
  });

  test("an ambiguous result still carries the raw value", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Scott"), project("Scott R.")]);
    assert.equal(resolveDri("Scott", me, corpus).raw, "Scott");
  });

  test("collidesWith is absent, not empty, when there is no collision", () => {
    const me: Identity = { canonical: "Scott", aliases: [] };
    assert.equal(resolveDri("Scott", me, buildCorpus([project("Scott")])).collidesWith, undefined);
  });
});
