import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { VaultChanged } from "../src/main/vault-changed";

/**
 * The change signal reports the fact, never the cause (research R7).
 *
 * That is what lets a writer added later — Feature 6's API, Feature 7's LLM
 * layer — raise it with nothing to remember, and lets a view subscribe once
 * without learning who might write.
 */

describe("VaultChanged", () => {
  test("notifies every subscriber", () => {
    const changed = new VaultChanged();
    const seen: string[] = [];
    changed.subscribe(() => seen.push("a"));
    changed.subscribe(() => seen.push("b"));

    changed.raise();
    assert.deepEqual(seen, ["a", "b"]);
  });

  test("carries no payload naming its cause", () => {
    const changed = new VaultChanged();
    let args: unknown[] = ["not called"];
    changed.subscribe((...received: unknown[]) => {
      args = received;
    });

    changed.raise();
    assert.deepEqual(args, [], "a listener's job is to re-read, not to interpret a reason");
  });

  test("a throwing listener does not fail the write or starve the others", () => {
    const changed = new VaultChanged();
    const seen: string[] = [];
    changed.subscribe(() => {
      throw new Error("a view failed to refresh");
    });
    changed.subscribe(() => seen.push("still ran"));

    assert.doesNotThrow(() => changed.raise());
    assert.deepEqual(seen, ["still ran"]);
  });

  test("raising with no subscribers is harmless", () => {
    assert.doesNotThrow(() => new VaultChanged().raise());
  });

  test("subscribing the same listener twice registers it once", () => {
    const changed = new VaultChanged();
    let count = 0;
    const listener = (): void => {
      count += 1;
    };
    changed.subscribe(listener);
    changed.subscribe(listener);

    changed.raise();
    assert.equal(count, 1);
  });

  test("is a separate emitter from the inbox signal", async () => {
    // Deliberate: InboxChanged fires on every capture, which for a projects
    // window is noise that would trigger a full re-read per keystroke-submit.
    const { InboxChanged } = await import("../src/main/inbox-changed");
    const vault = new VaultChanged();
    const inbox = new InboxChanged();

    let vaultSeen = 0;
    vault.subscribe(() => (vaultSeen += 1));

    inbox.raise();
    assert.equal(vaultSeen, 0, "a capture must not wake the projects view");

    vault.raise();
    assert.equal(vaultSeen, 1);
  });
});
