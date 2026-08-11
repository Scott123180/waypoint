import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { VaultWriteError } from "../src/errors";

describe("VaultWriteError", () => {
  test("carries the item text so a failed write stays recoverable", () => {
    // Same reasoning as InboxWriteError: if the write failed, this object may
    // hold the only remaining copy of the thought.
    const err = new VaultWriteError("could not write", "projects/roof.md", "call the roofer");

    assert.equal(err.recoverableText, "call the roofer");
    assert.equal(err.destination, "projects/roof.md");
    assert.equal(err.name, "VaultWriteError");
    assert.ok(err instanceof Error);
  });

  test("preserves the underlying cause", () => {
    const cause = new Error("EACCES");
    const err = new VaultWriteError("nope", "waiting.md", "text", { cause });
    assert.equal(err.cause, cause);
  });
});
