import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The week turning over while a review is open.
 *
 * A review belongs to the week it was started in, permanently. Nothing sweeps
 * it, completes it, or deletes it when Monday arrives — the log is a record of
 * what the user did, and a record the system finished on their behalf is a
 * record of nothing (FR-059, FR-060).
 *
 * `2026-08-14` is a Friday in ISO week 33; `2026-08-17` is the Monday of week
 * 34.
 */

const VAULT = { "projects/alpha.md": "# Alpha\n\nstatus: active\n" };

describe("an in-progress review when the week turns over", () => {
  test("stays attached to its own week", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });

    clock.set("2026-08-17T09:00:00-04:00");

    const old = await service.get("2026-W33");
    assert.equal(old?.status, "in-progress");
    assert.equal(old?.step, "projects", "exactly where it was left");
    assert.ok(vault.files.has("log/2026-W33.md"));
  });

  test("is never auto-completed", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    clock.set("2026-08-17T09:00:00-04:00");
    await service.current();
    await service.history();

    const content = vault.files.get("log/2026-W33.md") ?? "";
    assert.match(content, /^status: in progress$/m);
    assert.doesNotMatch(content, /^completed:/m, "nothing finished it on the user's behalf");
  });

  test("is never deleted", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    clock.set("2026-08-17T09:00:00-04:00");
    await service.start();

    assert.ok(vault.files.has("log/2026-W33.md"), "last week's unfinished review is still there");
  });
});

describe("a review started in the new week", () => {
  test("is a separate file", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    clock.set("2026-08-17T09:00:00-04:00");
    const fresh = await service.start();

    assert.equal(fresh.week, "2026-W34");
    assert.equal(fresh.step, "inbox", "a new week starts at the beginning");
    assert.deepEqual(
      [...vault.files.keys()].filter((p) => p.startsWith("log/")).sort(),
      ["log/2026-W33.md", "log/2026-W34.md"],
    );
  });

  test("carries nothing over from the abandoned one", async () => {
    const { service, clock } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    clock.set("2026-08-17T09:00:00-04:00");
    const fresh = await service.start();

    assert.deepEqual(fresh.projects, [], "last week's decisions are last week's");
  });

  test("does not backfill or complete the earlier one", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    const before = vault.files.get("log/2026-W33.md");

    clock.set("2026-08-17T09:00:00-04:00");
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    assert.equal(vault.files.get("log/2026-W33.md"), before, "byte for byte as it was left");
  });

  test("both appear in history, newest first, each honest about its state", async () => {
    const { service, clock } = makeReview({ files: { ...VAULT } });
    await service.start();

    clock.set("2026-08-17T09:00:00-04:00");
    await service.start();

    const history = await service.history();
    assert.deepEqual(
      history.map((h) => `${h.week}:${h.status}`),
      ["2026-W34:in-progress", "2026-W33:in-progress"],
    );
  });
});
