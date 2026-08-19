import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * One source failing costs one panel (FR-011b, FR-011c).
 *
 * `read()` never rejects. Each panel is built inside its own `try`/`catch`, so
 * a source that cannot be read produces a `SourceFailure` naming the path and
 * carrying the underlying message verbatim — and the other three panels are
 * built, populated, and stay fully actionable.
 *
 * The distinction this file exists for: **a missing file is not a failure.**
 * "Nothing here" and "could not read this" have to be different answers, or the
 * difference ends up living in whichever renderer remembers it. `Panel<T>` is a
 * two-state union so a renderer cannot conflate them even by accident.
 */

describe("an unreadable source fails its own panel and no other", () => {
  test("top-three.md", async () => {
    const { service } = shutdownFor(populatedVault(), { unreadable: ["top-three.md"] });

    const view = await service.read();

    assert.equal(view.topThree.week, null);
    assert.equal(view.topThree.failure?.path, "top-three.md");
    assert.match(view.topThree.failure?.message ?? "", /EACCES/);

    assert.equal(view.projects.failure, null);
    assert.ok(view.projects.items.length > 0, "the other panels are still populated");
    assert.ok(view.waiting.items.length > 0);
    assert.ok(view.calendar.items.length > 0);
  });

  test("waiting.md", async () => {
    const { service } = shutdownFor(populatedVault(), { unreadable: ["waiting.md"] });

    const view = await service.read();

    assert.deepEqual(view.waiting.items, []);
    assert.equal(view.waiting.failure?.path, "waiting.md");
    assert.deepEqual(view.unreadableWaiting, []);

    assert.ok(view.topThree.week?.outcomes.length);
    assert.ok(view.calendar.items.length > 0);
  });

  test("calendar.md", async () => {
    const { service } = shutdownFor(populatedVault(), { unreadable: ["calendar.md"] });

    const view = await service.read();

    assert.deepEqual(view.calendar.items, []);
    assert.equal(view.calendar.failure?.path, "calendar.md");

    assert.ok(view.waiting.items.length > 0);
    assert.ok(view.projects.items.length > 0);
  });

  test("a project file, named as `projects/`", async () => {
    const { service } = shutdownFor(populatedVault(), { unreadable: ["projects/bravo.md"] });

    const view = await service.read();

    assert.deepEqual(view.projects.items, []);
    assert.equal(
      view.projects.failure?.path,
      "projects/",
      "`ProjectService.readAll` propagates the error; naming the individual file would mean " +
        "changing a shipped read loop whose blast radius is every caller of list()",
    );

    assert.ok(view.topThree.week?.outcomes.length, "and the other three panels still work");
    assert.ok(view.waiting.items.length > 0);
    assert.ok(view.calendar.items.length > 0);
  });
});

describe("read() never rejects", () => {
  test("not even with every source unreadable at once", async () => {
    const { service } = shutdownFor(populatedVault(), {
      unreadable: ["top-three.md", "waiting.md", "calendar.md", "projects/alpha.md", "identity.md"],
    });

    const view = await service.read();

    assert.equal(view.today, "2026-08-19", "the screen still opens and still knows the date");
    for (const panel of [view.topThree, view.projects, view.waiting, view.calendar]) {
      assert.notEqual(panel.failure, null);
    }
  });

  test("the message is the underlying error's, verbatim — core does not diagnose it", async () => {
    const { service } = shutdownFor(populatedVault(), { unreadable: ["calendar.md"] });

    const view = await service.read();

    assert.equal(view.calendar.failure?.message, "EACCES: permission denied, open 'calendar.md'");
  });
});

describe("missing is not failed", () => {
  test("a vault with no calendar.md reports an empty panel and no failure", async () => {
    const files = populatedVault();
    delete files["calendar.md"];

    const { service } = shutdownFor(files);
    const view = await service.read();

    assert.deepEqual(view.calendar.items, []);
    assert.equal(view.calendar.failure, null);
  });

  test("the two states are distinguishable from the value alone", async () => {
    const missing = populatedVault();
    delete missing["waiting.md"];

    const absent = await shutdownFor(missing).service.read();
    const broken = await shutdownFor(populatedVault(), { unreadable: ["waiting.md"] }).service.read();

    assert.deepEqual(absent.waiting.items, broken.waiting.items, "both are empty…");
    assert.notEqual(
      absent.waiting.failure === null,
      broken.waiting.failure === null,
      "…and a renderer can still tell them apart, which is the whole of FR-011c",
    );
  });

  test("nothing is repaired, recreated, or emptied on the way", async () => {
    const files = populatedVault();

    const { service } = shutdownFor(files, { unreadable: ["waiting.md"] });
    await service.read();

    assert.ok(files["waiting.md"]?.length, "the file that could not be read is untouched");
    assert.deepEqual(Object.keys(files).sort(), Object.keys(populatedVault()).sort());
  });
});
