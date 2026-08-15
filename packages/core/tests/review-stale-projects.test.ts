import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * A waiting project that has gone quiet.
 *
 * The **prompt** is the whole feature: the review surfaces it and says nothing
 * about what to do. It does not park it, does not nudge anyone, and does not
 * change a byte of the project whatever the user answers (FR-022a, FR-022b).
 *
 * The threshold is a rule and lives in the policy module — the same rule, the
 * same decision point, and the same configured number the waiting-for items
 * use. Nothing here knows the number.
 */

function waitingSince(date: string | null): string {
  return [
    "# Docs refresh",
    "",
    "status: waiting",
    "",
    ...(date === null ? [] : ["## Ledger", "", `- ${date} status active → waiting`, ""]),
  ].join("\n");
}

/** 2026-08-14 is the harness's default today. */
const LONG_AGO = "2026-06-01"; // 74 days
const RECENTLY = "2026-08-12"; // 2 days

describe("a waiting project past the threshold", () => {
  test("is flagged, in policy's own words, with its day count", async () => {
    const { service } = makeReview({ files: { "projects/docs-refresh.md": waitingSince(LONG_AGO) } });
    await service.start();

    const [entry] = await service.projectStep();
    assert.ok(entry?.stale, "74 days of silence is what the review exists to surface");
    assert.equal(entry.stale.days, 74);
    assert.ok(entry.stale.reason.length > 0, "the words are the module's, not core's");
    assert.match(entry.stale.reason, /74/, "the user is told how long, not merely that it is stale");
  });

  test("one under the threshold is not flagged", async () => {
    const { service } = makeReview({ files: { "projects/docs-refresh.md": waitingSince(RECENTLY) } });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.stale, null);
  });

  test("one whose start date is unknown is walked, but never put to the rule", async () => {
    // No ledger entry entering `waiting` — a hand-edited status, or a project
    // older than the ledger. Unknown is never stale, and a substituted date
    // would be a fact the system invented (FR-094).
    const { service } = makeReview({ files: { "projects/docs-refresh.md": waitingSince(null) } });
    await service.start();

    const walk = await service.projectStep();
    assert.equal(walk.length, 1, "it is still walked — it is a waiting project");
    assert.equal(walk[0]?.project.statusSince, null);
    assert.equal(walk[0]?.stale, null);
  });

  test("an active project is never put to the rule, however long it has sat", async () => {
    const { service } = makeReview({
      files: {
        "projects/old-active.md": [
          "# Old active",
          "",
          "status: active",
          "",
          "## Ledger",
          "",
          "- 2025-01-01 status waiting → active",
          "",
        ].join("\n"),
      },
    });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.stale, null, "staleness is about waiting, not about age");
  });
});

describe("what the review does about it", () => {
  test("nothing, whatever the user answers", async () => {
    const { service, vault } = makeReview({
      files: { "projects/docs-refresh.md": waitingSince(LONG_AGO) },
    });
    await service.start();
    vault.writeLog.length = 0;

    const result = await service.recordLeft({ slug: "docs-refresh" });
    assert.ok(result.ok);

    const project = await service.projectStep();
    assert.equal(project[0]?.project.status, "waiting", "no auto-park, ever");
    assert.deepEqual(
      vault.writeLog.filter((p) => p.startsWith("projects/")),
      [],
      "the project file was not touched",
    );
  });

  test("a stale project the user leaves is recorded as surfaced and left", async () => {
    const { service } = makeReview({
      files: { "projects/docs-refresh.md": waitingSince(LONG_AGO) },
    });
    await service.start();

    await service.recordLeft({ slug: "docs-refresh" });

    const review = await service.current();
    const record = review?.waiting.find((w) => w.subject === "project");
    assert.ok(record, "the log shows it was surfaced, so a later reader knows it was not missed");
    assert.equal(record.owner, "docs-refresh");
    assert.equal(record.days, 74);
    assert.equal(record.action, "none");
  });

  test("a project left is a project reviewed — the walk does not offer it again", async () => {
    const { service } = makeReview({
      files: {
        "projects/docs-refresh.md": waitingSince(LONG_AGO),
        "projects/other.md": "# Other\n\nstatus: active\n",
      },
    });
    await service.start();

    await service.recordLeft({ slug: "docs-refresh" });

    const walk = await service.projectStep();
    assert.equal(walk.find((w) => w.project.slug === "docs-refresh")?.reviewed, true);
    assert.equal(walk.find((w) => w.project.slug === "other")?.reviewed, false);
  });
});

describe("the threshold is configured, not compiled in", () => {
  test("raising it above the gap unflags the project", async () => {
    const { service } = makeReview({
      files: {
        "projects/docs-refresh.md": waitingSince(LONG_AGO),
        "policy.md": "staleness days: 100\n",
      },
    });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.stale, null, "74 days is not stale when the user says 100");
  });

  test("lowering it to zero flags everything that has a known date", async () => {
    const { service } = makeReview({
      files: {
        "projects/docs-refresh.md": waitingSince(RECENTLY),
        "policy.md": "staleness days: 0\n",
      },
    });
    await service.start();

    const [entry] = await service.projectStep();
    assert.ok(entry?.stale, "zero is honored as written, not corrected to something sensible");
  });
});
