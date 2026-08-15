import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseReview, parseReviewSummary } from "../src/review/review-document";
import { makeReview } from "./review-fakes";

/**
 * An abandoned review, read back weeks later.
 *
 * It is raw material for the retrospective Feature 6 will build, so it has to
 * survive as what it actually was: a partial pass, honestly labelled. Two
 * failure modes are being ruled out — presenting it as finished, and hiding it
 * because it is not.
 *
 * "Marked plainly" is meant literally: the first line of the preamble says so,
 * in words, in a file the user can open in any editor (FR-057, FR-072).
 */

const VAULT = { "projects/alpha.md": "# Alpha\n\nstatus: active\n" };

async function abandonedThenLater() {
  const harness = makeReview({ files: { ...VAULT } });
  await harness.service.start();
  await harness.service.advance({ confirmed: true });
  await harness.service.recordNoChange("alpha");

  // Two weeks on, a review that does get finished.
  harness.clock.set("2026-08-28T09:00:00-04:00");
  await harness.service.start();
  for (let i = 0; i < 4; i++) await harness.service.advance({ confirmed: true });
  await harness.service.complete({ note: "this one I finished" });

  return harness;
}

describe("an abandoned earlier week", () => {
  test("is listed in history beside the finished ones", async () => {
    const { service } = await abandonedThenLater();

    const history = await service.history();
    assert.deepEqual(
      history.map((h) => `${h.week}:${h.status}`),
      ["2026-W35:complete", "2026-W33:in-progress"],
      "newest first, and neither is hidden or relabelled",
    );
  });

  test("carries no completion date, because it was never completed", async () => {
    const { service } = await abandonedThenLater();

    const old = (await service.history()).find((h) => h.week === "2026-W33");
    assert.equal(old?.completed, null);
    assert.equal(old?.started, "2026-08-14", "when it was started is still known");
  });

  test("is readable in full, with the decisions that were made", async () => {
    const { service } = await abandonedThenLater();

    const old = await service.get("2026-W33");
    assert.equal(old?.status, "in-progress");
    assert.equal(old?.step, "projects", "it says where it stopped");
    assert.equal(old?.projects.length, 1, "and what had been decided by then");
    assert.equal(old?.note, null, "nothing was invented to fill the gap");
  });
});

describe("the file itself", () => {
  test("says it is unfinished on its first preamble line", async () => {
    const { vault } = await abandonedThenLater();

    const content = vault.files.get("log/2026-W33.md") ?? "";
    const preamble = content.split("\n").filter((l) => l.includes(":"));
    assert.equal(
      preamble[0],
      "status: in progress",
      "the thing a person opening the file needs to know first",
    );
    assert.doesNotMatch(content, /^completed:/m);
  });

  test("is never repaired on read", async () => {
    const { service, vault } = await abandonedThenLater();
    const before = vault.files.get("log/2026-W33.md");

    await service.history();
    await service.get("2026-W33");

    assert.equal(vault.files.get("log/2026-W33.md"), before, "reading is reading");
  });
});

describe("a hand-written half-finished log", () => {
  test("is read as it stands, not corrected", async () => {
    // No `step:` at all, a section the app never writes, and prose where lines
    // are expected. All of it survives; none of it is repaired.
    const handWritten = `# Weekly review 2026-W30

status: in progress
started: 2026-07-24

## Inbox

I never actually counted these

## Projects

- 2026-07-24 alpha no change

## Thoughts

Gave up halfway. Worth trying again on a Thursday.
`;

    const { service, vault } = makeReview({ files: { ...VAULT, "log/2026-W30.md": handWritten } });

    const review = await service.get("2026-W30");
    assert.equal(review?.status, "in-progress");
    assert.equal(review?.step, "inbox", "an absent step reads as the beginning, and nothing is written");
    assert.equal(review?.projects.length, 1);
    assert.equal(review?.inbox, null, "prose under a heading is not a record, and is not a failure either");

    assert.equal(vault.files.get("log/2026-W30.md"), handWritten, "byte for byte");
    assert.deepEqual(vault.writeLog, []);
  });

  test("summarises without being parsed in full", async () => {
    const content = "# Weekly review 2026-W30\n\nstatus: in progress\nstarted: 2026-07-24\n";

    const summary = parseReviewSummary(content, "2026-W30");
    assert.deepEqual(summary, {
      week: "2026-W30",
      started: "2026-07-24",
      status: "in-progress",
      completed: null,
    });
    assert.equal(parseReview(content, "2026-W30").step, "inbox");
  });
});
