import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";
import type { ProjectOutcome } from "../src/projects/types";
import type { ReviewRecordResult } from "../src/review/types";

/** Everything a client would render, from either path, in one comparable shape. */
function refusalOf(result: ReviewRecordResult | ProjectOutcome): {
  reason: string;
  message: string;
  subjects: string[] | undefined;
} {
  assert.equal(result.ok, false, "expected a refusal");
  if (result.ok) throw new Error("unreachable");
  return {
    reason: result.reason,
    message: result.message,
    subjects: "subjects" in result ? result.subjects : undefined,
  };
}

/**
 * The WIP limit gives the same answer inside the review as outside it.
 *
 * This is the property the whole design rests on: the review does not enforce
 * rules, it drives the verbs that already do. If these two paths could ever
 * disagree, the review would have become a second write path — the thing the
 * plan forbids — and the disagreement would show up as a project the user could
 * only activate on Fridays (FR-031, SC-009).
 *
 * Asserted on the verdict, the message, *and* the named subjects. Comparing
 * only "both refused" would pass while the review showed the user a different
 * explanation, which is most of what a refusal is for.
 */

const IDENTITY = "me: Scott Rodgers\n";

function driving(slug: string): string {
  return `# ${slug}\n\nstatus: active\ndri: Scott Rodgers\n`;
}

/** Three active projects driven by the user — the shipped limit — plus a candidate. */
function atTheLimit(): Record<string, string> {
  return {
    "identity.md": IDENTITY,
    "projects/one.md": driving("One"),
    "projects/two.md": driving("Two"),
    "projects/three.md": driving("Three"),
    "projects/candidate.md": "# Candidate\n\nstatus: parked\ndri: Scott Rodgers\n",
  };
}

describe("taking a project active at the limit", () => {
  test("refuses identically through the review and through the service", async () => {
    const inside = makeReview({ files: atTheLimit() });
    await inside.service.start();
    const throughReview = await inside.service.recordStatus("candidate", "parked", "active");

    const outside = makeReview({ files: atTheLimit() });
    const throughService = await outside.projects.setStatus("candidate", "parked", "active");

    const inReview = refusalOf(throughReview);
    const inService = refusalOf(throughService);

    // The verdict, the words, and the projects named as the ones to finish or
    // park — compared together, because a refusal that agreed on only two of
    // the three would still show the user a different screen.
    assert.deepEqual(inReview, inService);
    assert.equal(inReview.reason, "wip-limit");
    assert.equal(inReview.subjects?.length, 3);
  });

  test("the refusal records nothing in the log", async () => {
    const { service } = makeReview({ files: atTheLimit() });
    await service.start();

    await service.recordStatus("candidate", "parked", "active");

    const review = await service.current();
    assert.deepEqual(review?.projects, [], "nothing happened, so there is nothing to record");
  });

  test("the file is untouched by the refusal", async () => {
    const { service, vault } = makeReview({ files: atTheLimit() });
    await service.start();
    vault.writeLog.length = 0;

    await service.recordStatus("candidate", "parked", "active");

    assert.deepEqual(vault.writeLog, []);
  });
});

describe("under the limit", () => {
  test("both paths allow it, and both record the ledger entry", async () => {
    const files = atTheLimit();
    delete files["projects/three.md"];

    const inside = makeReview({ files: { ...files } });
    await inside.service.start();
    const throughReview = await inside.service.recordStatus("candidate", "parked", "active");

    const outside = makeReview({ files: { ...files } });
    const throughService = await outside.projects.setStatus("candidate", "parked", "active");

    assert.ok(throughReview.ok);
    assert.ok(throughService.ok);

    const insideFile = inside.vault.files.get("projects/candidate.md") ?? "";
    const outsideFile = outside.vault.files.get("projects/candidate.md") ?? "";
    assert.equal(
      insideFile,
      outsideFile,
      "the same action from two surfaces produces the same file, ledger included",
    );
  });
});

describe("the limit is configured, and both paths read the same configuration", () => {
  test("raising it lets both through", async () => {
    const files = { ...atTheLimit(), "policy.md": "wip limit: 9\n" };

    const inside = makeReview({ files: { ...files } });
    await inside.service.start();
    const throughReview = await inside.service.recordStatus("candidate", "parked", "active");

    const outside = makeReview({ files: { ...files } });
    const throughService = await outside.projects.setStatus("candidate", "parked", "active");

    assert.equal(throughReview.ok, true);
    assert.equal(throughService.ok, true);
  });
});
