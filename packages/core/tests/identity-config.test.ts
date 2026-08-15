import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseIdentity } from "../src/identity/identity-config";

/**
 * Reading `identity.md`.
 *
 * Stored with the data rather than with the application, so any client opening
 * the vault resolves identity the same way (FR-018). Kept in its own file
 * because identity is a fact about the data while policy is an opinion about
 * how to work — and identity outlives any policy module (FR-019).
 */

describe("identity config", () => {
  test("an absent file means identity is not configured", () => {
    assert.deepEqual(parseIdentity(null), { canonical: null, aliases: [] });
  });

  test("an empty file means identity is not configured", () => {
    assert.deepEqual(parseIdentity(""), { canonical: null, aliases: [] });
  });

  test("reads the canonical name", () => {
    assert.equal(parseIdentity("# Identity\n\nme: Scott Rodgers\n").canonical, "Scott Rodgers");
  });

  test("reads the alias list", () => {
    const identity = parseIdentity(
      ["# Identity", "", "me: Scott Rodgers", "", "## Aliases", "", "- scott", "- Scott R.", ""].join("\n"),
    );
    assert.deepEqual(identity.aliases, ["scott", "Scott R."]);
  });

  test("aliases are stored as written — normalization happens at match time", () => {
    const identity = parseIdentity(["me: Scott", "", "## Aliases", "-   Scott R.  "].join("\n"));
    assert.deepEqual(identity.aliases, ["Scott R."]);
  });

  test("a blank canonical value means not configured", () => {
    assert.equal(parseIdentity("me:\n").canonical, null);
    assert.equal(parseIdentity("me:    \n").canonical, null);
  });

  test("an absent alias section is valid — the canonical value alone is enough", () => {
    const identity = parseIdentity("me: Scott Rodgers\n");
    assert.equal(identity.canonical, "Scott Rodgers");
    assert.deepEqual(identity.aliases, []);
  });

  test("an empty alias section is valid", () => {
    assert.deepEqual(parseIdentity("me: Scott\n\n## Aliases\n\n").aliases, []);
  });

  test("aliases may exist without a canonical value, and that is still not configured", () => {
    // A vault that names spellings but never says which is the real one has not
    // answered "who are you?". Guessing one of the aliases would be inventing
    // an answer the file does not give (FR-031).
    const identity = parseIdentity(["## Aliases", "- scott"].join("\n"));
    assert.equal(identity.canonical, null);
  });

  test("duplicate and redundant aliases are harmless", () => {
    const identity = parseIdentity(
      ["me: Scott Rodgers", "", "## Aliases", "- scott rodgers", "- scott rodgers", "- Scott R."].join("\n"),
    );
    assert.equal(identity.aliases.length, 3, "kept as written; deduplication happens at match time");
  });

  test("the key is matched case-insensitively and tolerates hand-edited spacing", () => {
    assert.equal(parseIdentity("Me:   Scott Rodgers").canonical, "Scott Rodgers");
    assert.equal(parseIdentity("  me:Scott").canonical, "Scott");
  });

  test("unknown keys and prose are ignored rather than rejected", () => {
    const identity = parseIdentity(
      ["# Identity", "", "me: Scott", "note: hello", "", "## Notes", "", "- not an alias"].join("\n"),
    );
    assert.equal(identity.canonical, "Scott");
    assert.deepEqual(identity.aliases, []);
  });
});
