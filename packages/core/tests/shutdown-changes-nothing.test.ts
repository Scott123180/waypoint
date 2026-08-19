import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { populatedVault, shutdownFor, shutdownVault } from "./shutdown-fakes";

/**
 * The vault is byte-for-byte unchanged. Always (FR-053, SC-002).
 *
 * **This assertion passes vacuously more easily than most.** "Nothing changed"
 * is true of a test that never ran the service, never opened the vault, or
 * swallowed an error on the way. The dirtying sibling at the bottom is the guard
 * on the guard: it applies the same comparison to a fixture that *was* modified
 * and asserts the comparison fails. Delete it and this file stops meaning
 * anything — a green that proves nothing is worse than a red.
 *
 * The primary guarantee is not this test. `ShutdownServiceDeps` narrows `vault`
 * to `Pick<VaultStore, "read">` and the three service dependencies to structural
 * shapes carrying one read verb each, so a write does not compile; the Proxy in
 * `shutdown-fakes` catches anything reaching one dynamically, with a message
 * naming this feature's requirement. This is the regression net under both.
 */

function fingerprint(files: Record<string, string>): string {
  const h = createHash("sha256");
  for (const path of Object.keys(files).sort()) h.update(`${path}\0${files[path]}\0`);
  return h.digest("hex");
}

describe("reading the whole screen writes nothing", () => {
  test("every file is byte-identical afterwards", async () => {
    const files = populatedVault();
    const before = fingerprint(files);

    const { service } = shutdownFor(files);
    const view = await service.read();

    // And the read actually happened, so the assertion above is not vacuous.
    assert.ok(view.topThree.week?.outcomes.length, "the fixture must produce a top three");
    assert.ok(view.projects.items.length, "and projects");
    assert.ok(view.waiting.items.length, "and stale waiting items");
    assert.ok(view.calendar.items.length, "and stale calendar flags");

    assert.equal(fingerprint(files), before);
  });

  test("reading every panel of the value changes nothing either", async () => {
    const files = populatedVault();
    const before = fingerprint(files);

    const { service } = shutdownFor(files);
    const view = await service.read();

    // Walk everything a renderer would walk.
    JSON.stringify({
      week: view.topThree.week?.outcomes.map((o) => o.raw),
      projects: view.projects.items.map((p) => [p.nextAction, p.openMilestones.map((m) => m.raw)]),
      waiting: view.waiting.items.map((s) => [s.reason, s.untouchedDays, s.waitingDays]),
      calendar: view.calendar.items.map((s) => [s.reason, s.unscheduledDays]),
      unreadable: [view.unreadableWaiting, view.unreadableCalendar],
      notices: view.policyNotices,
    });

    assert.equal(fingerprint(files), before);
  });

  test("opening it three times in a row still changes nothing", async () => {
    const files = populatedVault();
    const before = fingerprint(files);

    const { service } = shutdownFor(files);
    await service.read();
    await service.read();
    await service.read();

    assert.equal(fingerprint(files), before);
  });

  test("an empty vault gains no file by being looked at", async () => {
    const files: Record<string, string> = {};

    const { service } = shutdownFor(files);
    await service.read();

    assert.deepEqual(Object.keys(files), []);
  });
});

describe("the vault stub refuses to be written to", () => {
  test("reaching for a write verb throws rather than silently doing nothing", () => {
    const vault = shutdownVault(populatedVault());

    for (const verb of ["write", "appendLine"]) {
      assert.throws(
        // The type forbids this; the cast is what a dynamic reach would look like.
        () => (vault as unknown as Record<string, unknown>)[verb],
        /may only read/,
      );
    }
  });

  test("and the message names this feature, not the retrospective", () => {
    const vault = shutdownVault({});

    assert.throws(
      () => (vault as unknown as Record<string, unknown>)["write"],
      /the shutdown touched `write`.*009 FR-053/,
    );
  });
});

describe("the guard's guard", () => {
  /**
   * If this ever passes, `fingerprint` has stopped discriminating and every
   * assertion above is worthless. It is **not** a test of the code — it is the
   * reason the tests above mean anything. Do not delete it for "testing the
   * test": a read-mostly feature whose headline guarantee is "nothing changed"
   * is exactly where a vacuously green immutability test rots unnoticed, and
   * Feature 6 recorded that the hard way.
   */
  test("the same comparison fails on a fixture that did change", () => {
    const files = populatedVault();
    const before = fingerprint(files);

    files["waiting.md"] = `${files["waiting.md"]}  - followed up 2026-08-19\n`;

    assert.notEqual(
      fingerprint(files),
      before,
      "the immutability check cannot detect a change, so it proves nothing",
    );
  });

  test("and it notices a change to any of the four sources", () => {
    for (const path of ["top-three.md", "projects/alpha.md", "waiting.md", "calendar.md"]) {
      const files = populatedVault();
      const before = fingerprint(files);

      files[path] = `${files[path]}\n`;

      assert.notEqual(fingerprint(files), before, `a change to ${path} went undetected`);
    }
  });

  test("and it notices a file appearing that was not there", () => {
    const files = populatedVault();
    const before = fingerprint(files);

    files["log/2026-W34.md"] = "# Review 2026-W34\n";

    assert.notEqual(
      fingerprint(files),
      before,
      "a shutdown that wrote a record of itself would land here, and must be visible",
    );
  });
});
