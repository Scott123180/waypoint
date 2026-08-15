import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The waiting-for step.
 *
 * Everything the user sees is decided here: which items are outstanding, which
 * of those have gone quiet, how long each has, and what to say about it. The
 * threshold itself lives in the policy module, and nothing in core compares a
 * number to it (FR-036, FR-039, FR-040).
 *
 * The fixture is aged in days from the harness's 2026-08-14.
 */

function daysAgo(days: number): string {
  const date = new Date("2026-08-14T09:00:00-04:00");
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const WAITING = [
  `- ${daysAgo(30)} @Priya — Confirm the migration window moved`,
  `- ${daysAgo(8)} @roofer — Send the revised estimate`,
  `- ${daysAgo(7)} @legal — Contract review`,
  `- ${daysAgo(3)} @finance — Approve the invoice`,
  `- ${daysAgo(0)} @sam — Just delegated this morning`,
  `- ${daysAgo(60)} @archive — Long since arrived`,
  "  - received " + daysAgo(50),
  "",
].join("\n");

function harness(policy?: string) {
  return makeReview({
    files: { "waiting.md": WAITING, ...(policy === undefined ? {} : { "policy.md": policy }) },
  });
}

describe("the total", () => {
  test("counts outstanding items only", async () => {
    const { service } = harness();
    await service.start();

    const { total } = await service.waitingStep();
    assert.equal(total, 5, "the received one is settled and is not waited on");
  });
});

describe("the stale set", () => {
  test("matches the threshold exactly at the shipped default of seven days", async () => {
    const { service } = harness();
    await service.start();

    const { stale } = await service.waitingStep();
    assert.deepEqual(
      stale.map((s) => s.item.owner),
      ["Priya", "roofer", "legal"],
      "eight and thirty days over; seven days at it; three and zero under",
    );
  });

  test("matches a different configured threshold just as exactly", async () => {
    const { service } = harness("staleness days: 29\n");
    await service.start();

    const { stale } = await service.waitingStep();
    assert.deepEqual(stale.map((s) => s.item.owner), ["Priya"]);
  });

  test("excludes received items whatever the threshold", async () => {
    const { service } = harness("staleness days: 0\n");
    await service.start();

    const { stale, total } = await service.waitingStep();
    assert.equal(stale.length, 5);
    assert.equal(total, 5);
    assert.ok(!stale.some((s) => s.item.owner === "archive"), "settled is settled");
  });
});

describe("each surfaced item", () => {
  test("carries the whole field set the user needs to decide", async () => {
    const { service } = harness();
    await service.start();

    const { stale } = await service.waitingStep();
    const priya = stale.find((s) => s.item.owner === "Priya");
    assert.ok(priya);

    assert.equal(priya.item.text, "Confirm the migration window moved");
    assert.equal(priya.item.since, daysAgo(30), "the date it started waiting, never rewritten");
    assert.deepEqual(priya.item.actions, [], "any follow-ups already recorded — none yet");
    assert.equal(priya.days, 30, "how long it has gone untouched");
    assert.ok(priya.reason.length > 0, "and policy's own words about it");
    assert.match(priya.reason, /30/);
  });

  test("shows a chased item as quieted, with its total age still visible", async () => {
    const chased = `- ${daysAgo(30)} @Priya — Confirm the migration window moved\n  - followed up ${daysAgo(2)}\n`;
    const { service } = makeReview({ files: { "waiting.md": chased } });
    await service.start();

    const { total, stale } = await service.waitingStep();
    assert.equal(total, 1);
    assert.deepEqual(stale, [], "chasing it is touching it — two days is not neglect");
  });
});

describe("lines the step cannot read", () => {
  /**
   * Not an item is not the same as not there.
   *
   * A line the parser cannot attribute is dropped from the item list — it has
   * no owner and no date, so there is nothing to be stale about. But dropping it
   * from the *step* would mean the one place the user looks at their delegated
   * work quietly omits a line they wrote, which is how a forgotten commitment
   * becomes invisible rather than merely untidy (FR-044).
   */
  const MESSY = [
    `- ${daysAgo(30)} @Priya — Confirm the migration window moved`,
    "- @nodate — I typed this in a hurry and left the date off",
    `- ${daysAgo(3)} @finance — Approve the invoice`,
    "",
  ].join("\n");

  test("are surfaced as they read, with the line to find them on", async () => {
    const { service } = makeReview({ files: { "waiting.md": MESSY } });
    await service.start();

    const { unreadable } = await service.waitingStep();
    assert.deepEqual(unreadable, [
      { line: 2, raw: "- @nodate — I typed this in a hurry and left the date off" },
    ]);
  });

  test("are counted in neither the total nor the stale set", async () => {
    const { service } = makeReview({ files: { "waiting.md": MESSY } });
    await service.start();

    const { total, stale } = await service.waitingStep();
    assert.equal(total, 2, "an unreadable line has no owner to be waiting on");
    assert.deepEqual(
      stale.map((s) => s.item.owner),
      ["Priya"],
      "and nothing to be stale about",
    );
  });

  test("are never rewritten to make the file parse", async () => {
    const { service, vault } = makeReview({ files: { "waiting.md": MESSY } });
    await service.start();
    await service.waitingStep();

    assert.equal(vault.files.get("waiting.md"), MESSY, "looking at it changes nothing");
  });
});

describe("an absent waiting.md", () => {
  test("reports an empty list rather than failing", async () => {
    const { service, vault } = makeReview();
    await service.start();

    assert.deepEqual(await service.waitingStep(), { total: 0, stale: [], unreadable: [] });
    assert.ok(!vault.files.has("waiting.md"), "and no file is created to answer the question");
  });

  test("and the step still passes", async () => {
    const { service } = makeReview();
    await service.start();
    await service.advance({ confirmed: true });
    await service.advance();

    const result = await service.advance();
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.review.step, "top-three");
  });
});
