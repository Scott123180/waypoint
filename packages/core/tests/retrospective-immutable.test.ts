import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { renderReport } from "../src/retrospective/report";
import {
  logFile,
  projectFile,
  range,
  readOk,
  readOnlyVault,
  serviceFor,
  topThreeFile,
} from "./retro-fakes";

/**
 * The vault is byte-for-byte unchanged. Always (FR-051, SC-004).
 *
 * **This assertion passes vacuously more easily than most.** "Nothing changed"
 * is true of a test that never ran the service, never opened the vault, or
 * swallowed an error on the way. The `dirtying sibling` below is the guard on
 * the guard: it applies the same comparison to a fixture that *was* modified
 * and asserts the comparison fails. Delete it and this file stops meaning
 * anything — a green that proves nothing is worse than a red.
 *
 * The primary guarantee is not this test. `RetrospectiveServiceDeps` narrows
 * `vault` to `Pick<VaultStore, "list" | "read">`, so a write does not compile;
 * the Proxy in `retro-fakes` catches anything reaching one dynamically. This is
 * the regression net under both.
 */

const VAULT: Record<string, string> = {
  "projects/roof.md": projectFile({
    slug: "roof",
    title: "Roof repair",
    status: "done",
    completed: "2026-06-30",
    milestones: [
      { text: "Estimate approved", done: true, completedOn: "2026-06-10" },
      { text: "Undated one", done: true },
    ],
    ledger: ["- 2026-01-02 status created → active"],
  }),
  "projects/fence.md": projectFile({ slug: "fence", title: "Fix the fence" }),
  "top-three.md": topThreeFile([
    { week: "2026-W24", outcomes: [{ text: "Ship it", done: true, completedOn: "2026-06-11" }] },
  ]),
  "log/2026-W24.md": logFile({ week: "2026-W24", note: "A fine week." }),
};

function fingerprint(files: Record<string, string>): string {
  const h = createHash("sha256");
  for (const path of Object.keys(files).sort()) h.update(`${path}\0${files[path]}\0`);
  return h.digest("hex");
}

describe("nothing is written, ever", () => {
  test("a full read leaves every file byte-for-byte identical", async () => {
    const files = { ...VAULT };
    const before = fingerprint(files);

    const { service } = serviceFor(files);
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    renderReport(r);

    assert.equal(fingerprint(files), before);
    // And the read actually happened, so the assertion above is not vacuous.
    assert.ok(r.completions.length > 0, "the fixture must produce completions");
  });

  test("narrowing, clearing, and changing the range write nothing (FR-035)", async () => {
    const files = { ...VAULT };
    const before = fingerprint(files);
    const { service } = serviceFor(files);

    await readOk(service, range("2026-01-01", "2026-12-31"));
    await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    await readOk(service, range("2026-06-01", "2026-06-30", "roof"));
    await readOk(service, range("2026-06-01", "2026-06-30"));

    assert.equal(fingerprint(files), before);
  });

  test("viewing a project history writes, reorders, and compacts nothing (FR-043)", async () => {
    const files = { ...VAULT };
    const before = fingerprint(files);
    const { service } = serviceFor(files);

    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    assert.ok(r.history, "the fixture must have a history to view");
    assert.equal(fingerprint(files), before);
  });

  test("a refusal writes nothing and reads nothing", async () => {
    const files = { ...VAULT };
    const before = fingerprint(files);
    const { service, vault } = serviceFor(files);

    const result = await service.read(range("2026-12-31", "2026-01-01"));
    assert.equal(result.ok, false);
    assert.equal(fingerprint(files), before);
    assert.deepEqual(vault.reads, []);
  });

  test("the guard's guard: the same comparison fails on a fixture that did change", () => {
    // If this ever passes, `fingerprint` has stopped discriminating and every
    // assertion above is worthless.
    const files = { ...VAULT };
    const before = fingerprint(files);
    files["projects/fence.md"] = `${files["projects/fence.md"]}\nnext action: something\n`;

    assert.notEqual(
      fingerprint(files),
      before,
      "the immutability check cannot detect a change, so it proves nothing",
    );
  });
});

describe("the vault stub refuses to be written to", () => {
  test("reaching for a write verb throws rather than silently doing nothing", () => {
    const vault = readOnlyVault({ "projects/roof.md": projectFile({ slug: "roof" }) });
    assert.throws(
      // The type forbids this; the cast is what a dynamic reach would look like.
      () => (vault as unknown as Record<string, unknown>)["write"],
      /may only read/,
    );
    assert.throws(() => (vault as unknown as Record<string, unknown>)["appendLine"], /may only read/);
  });
});
