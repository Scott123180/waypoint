import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * No file is created by being looked for (FR-011c, Principle IV).
 *
 * Absence is the normal case, not an error branch: every vault already on disk
 * has no `policy.md`, most have no `calendar.md`, and a new one has none of the
 * four. An application that quietly wrote scaffolding into a git-tracked
 * directory on first run would be putting its own bookkeeping into the user's
 * repository and their next commit — the plain-text promise cuts both ways.
 *
 * A vault gains `calendar.md` by sorting something into it, and `top-three.md`
 * by committing to an outcome. Never by being read.
 */

const SOURCES = ["top-three.md", "waiting.md", "calendar.md", "policy.md", "identity.md"];

describe("with none of the files this screen reads", () => {
  test("the vault holds exactly what it held before", async () => {
    const files: Record<string, string> = {};

    const { service } = shutdownFor(files);
    await service.read();

    assert.deepEqual(Object.keys(files), []);
  });

  test("each missing source produces its empty state rather than a file", async () => {
    const files: Record<string, string> = {};
    const { service } = shutdownFor(files);

    const view = await service.read();

    assert.deepEqual(view.topThree.week?.outcomes, []);
    assert.deepEqual(view.calendar.items, []);
    assert.deepEqual(view.waiting.items, []);
    for (const path of SOURCES) assert.ok(!(path in files), `${path} was created`);
  });

  test("and no directory appears either", async () => {
    const files: Record<string, string> = {};
    const { service } = shutdownFor(files);

    await service.read();

    assert.equal(
      Object.keys(files).filter((p) => p.includes("/")).length,
      0,
      "no `projects/`, no `log/`, nothing",
    );
  });
});

describe("with a populated vault", () => {
  test("nothing new appears beside what was already there", async () => {
    const files = populatedVault();
    const before = Object.keys(files).sort();

    const { service } = shutdownFor(files);
    await service.read();

    assert.deepEqual(Object.keys(files).sort(), before);
  });

  test("in particular, nothing under `log/`", async () => {
    const files = populatedVault();

    const { service } = shutdownFor(files);
    await service.read();

    assert.deepEqual(
      Object.keys(files).filter((p) => p.startsWith("log/")),
      [],
      "a record of the shutdown having happened is the one thing this feature must never write",
    );
  });
});
