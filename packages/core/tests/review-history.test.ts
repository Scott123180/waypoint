import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview, passAllSteps } from "./review-fakes";

/**
 * Past reviews are a permanent record.
 *
 * The whole point of writing a weekly log is being able to read it a year
 * later, so the properties that matter are that nothing prunes it, nothing
 * rewrites it, and a hand-edit is honoured rather than repaired.
 */

describe("reading past reviews", () => {
  test("lists them newest first, each identified by its week", async () => {
    const { service, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await service.start();

    clock.set("2026-08-21T09:00:00-04:00");
    await service.start();

    clock.set("2026-08-28T09:00:00-04:00");
    await service.start();

    assert.deepEqual(
      (await service.history()).map((r) => r.week),
      ["2026-W35", "2026-W34", "2026-W33"],
    );
  });

  test("a listed review says whether it was finished", async () => {
    const { service, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await passAllSteps(service);
    await service.complete({ note: "done" });

    clock.set("2026-08-21T09:00:00-04:00");
    await service.start();

    const [newest, older] = await service.history();
    assert.equal(newest?.status, "in-progress");
    assert.equal(older?.status, "complete");
    assert.equal(older?.completed, "2026-08-14");
  });

  test("get() reads one week as it stands", async () => {
    const { service } = makeReview();
    await service.start();

    assert.equal((await service.get("2026-W33"))?.week, "2026-W33");
    assert.equal(await service.get("2026-W01"), null, "a week with no review is absent, not an error");
  });

  test("completing this week leaves every earlier log byte-for-byte unchanged", async () => {
    const { service, vault, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await passAllSteps(service);
    await service.complete({ note: "week one" });
    const first = vault.files.get("log/2026-W33.md");

    clock.set("2026-08-21T09:00:00-04:00");
    await passAllSteps(service);
    await service.complete({ note: "week two" });

    assert.equal(vault.files.get("log/2026-W33.md"), first);
  });

  test("a hand-edited log is returned as it reads and never repaired", async () => {
    const { service, vault } = makeReview();
    await service.start();

    const handEdited = [
      "# Weekly review 2026-W33",
      "",
      "status: in progress",
      "started: 2026-08-14",
      "step: waiting",
      "",
      "## Inbox",
      "",
      "- 2026-08-14 inbox clear",
      "",
      "## Projects",
      "",
      "I wrote this bit myself",
      "",
      "## My own section",
      "",
      "and this",
      "",
    ].join("\n");
    vault.files.set("log/2026-W33.md", handEdited);

    const review = await service.get("2026-W33");
    assert.equal(review?.step, "waiting", "the file's own account is what is read back");
    assert.equal(vault.files.get("log/2026-W33.md"), handEdited, "reading rewrites nothing");
  });

  test("history survives a log directory holding something unreadable", async () => {
    const { service, vault } = makeReview();
    await service.start();
    vault.files.set("log/not-a-week.md", "# who knows\n");

    const weeks = (await service.history()).map((r) => r.week);
    assert.ok(weeks.includes("2026-W33"), "one odd file does not hide the real ones");
  });

  test("nothing prunes, rotates, or compacts a past review", async () => {
    const { service, vault, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });

    for (const day of ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04"]) {
      clock.set(`${day}T09:00:00-04:00`);
      await passAllSteps(service);
      await service.complete({});
    }

    const logs = [...vault.files.keys()].filter((p) => p.startsWith("log/"));
    assert.equal(logs.length, 4, "four weeks reviewed, four logs kept");
  });
});
