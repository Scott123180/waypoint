import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * One threshold, two subjects, no way to configure them apart.
 *
 * A delegated item nobody has chased and a project sitting in `waiting` are the
 * same situation. They share the decision point, the rule, and the configured
 * number — which is structural rather than a promise: there is exactly one
 * `staleness days` key and exactly one `waiting.stale.check` point, so
 * "configure them separately" is not a thing that can be expressed (FR-022c,
 * SC-012a).
 *
 * This test is the guard against the obvious later "improvement": a second key
 * for projects, added because someone wanted a different number for them.
 */

const ITEM = "- 2026-07-01 @Priya — Confirm the migration window moved\n"; // 44 days
const PROJECT = [
  "# Docs refresh",
  "",
  "status: waiting",
  "",
  "## Ledger",
  "",
  "- 2026-07-01 status active → waiting", // the same 44 days
  "",
].join("\n");

function at(threshold: string | null) {
  return makeReview({
    files: {
      "waiting.md": ITEM,
      "projects/docs-refresh.md": PROJECT,
      ...(threshold === null ? {} : { "policy.md": `staleness days: ${threshold}\n` }),
    },
  });
}

async function surfaced(threshold: string | null): Promise<{ item: boolean; project: boolean }> {
  const { service } = at(threshold);
  await service.start();

  const { stale } = await service.waitingStep();
  const walk = await service.projectStep();

  return {
    item: stale.length > 0,
    project: walk.some((entry) => entry.stale !== null),
  };
}

describe("one change to `staleness days`", () => {
  test("moves both subjects together, in both directions", async () => {
    // Below the gap: both surface. Above it: neither does. There is no value
    // that separates them, because there is no second number to set.
    assert.deepEqual(await surfaced("7"), { item: true, project: true });
    assert.deepEqual(await surfaced("44"), { item: true, project: true }, "at the threshold");
    assert.deepEqual(await surfaced("45"), { item: false, project: false });
    assert.deepEqual(await surfaced("100"), { item: false, project: false });
  });

  test("the shipped default applies to both", async () => {
    assert.deepEqual(await surfaced(null), { item: true, project: true });
  });

  test("zero surfaces both", async () => {
    assert.deepEqual(await surfaced("0"), { item: true, project: true });
  });
});

describe("the rule that answers is the same rule", () => {
  test("both subjects reach it through one decision point", async () => {
    const asked: { point: string; subject: string; since: string }[] = [];

    // A recording module in place of the shipped one, so what core *asks* is
    // observable rather than inferred from what it does with the answer.
    const { service } = makeReview({
      files: { "waiting.md": ITEM, "projects/docs-refresh.md": PROJECT },
      policy: {
        decide: (context) => {
          if (context.point === "waiting.stale.check") {
            asked.push({ point: context.point, subject: context.subject, since: context.since });
          }
          return Promise.resolve({ verdict: "allow", reason: "" });
        },
      },
    });
    await service.start();

    await service.waitingStep();
    await service.projectStep();

    assert.deepEqual(
      asked,
      [
        { point: "waiting.stale.check", subject: "item", since: "2026-07-01" },
        { point: "waiting.stale.check", subject: "project", since: "2026-07-01" },
      ],
      "one point, two subjects, the same date — the subject reaches the wording and nothing else",
    );
  });
});
