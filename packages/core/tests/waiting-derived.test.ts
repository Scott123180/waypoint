import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseWaiting } from "../src/waiting/waiting-document";
import { outstanding, untouchedSince } from "../src/waiting/derive";

/**
 * The two things derived from a waiting-for item, neither of them stored.
 *
 * `untouchedSince` is what the staleness rule is asked about, and it is
 * deliberately *not* `since`. Chasing something is touching it: an item chased
 * last Friday is not neglected, however long it has been outstanding. Keeping
 * both means the review can say "chased weekly for three months" rather than
 * flattening that into one number (FR-037).
 */

function item(...lines: string[]) {
  const parsed = parseWaiting(`${lines.join("\n")}\n`)[0];
  assert.ok(parsed, "fixture does not parse");
  return parsed;
}

describe("untouchedSince", () => {
  test("is the date it started waiting when nothing has happened", () => {
    const waiting = item("- 2026-07-02 @roofer — Send the revised estimate");
    assert.equal(untouchedSince(waiting), "2026-07-02");
  });

  test("is the last action's date once something has", () => {
    const waiting = item(
      "- 2026-07-02 @roofer — Send the revised estimate",
      "  - followed up 2026-08-01",
      "  - followed up 2026-08-20",
    );
    assert.equal(untouchedSince(waiting), "2026-08-20", "chasing it quiets it for a while");
  });

  test("leaves the total age visible beside it", () => {
    const waiting = item(
      "- 2026-07-02 @roofer — Send the revised estimate",
      "  - followed up 2026-08-20",
    );
    assert.equal(waiting.since, "2026-07-02", "never rewritten (FR-043a)");
    assert.equal(untouchedSince(waiting), "2026-08-20");
  });

  test("a receipt counts as touching it too", () => {
    const waiting = item(
      "- 2026-07-02 @roofer — Send the revised estimate",
      "  - received 2026-08-14",
    );
    assert.equal(untouchedSince(waiting), "2026-08-14");
  });
});

describe("outstanding", () => {
  test("is true while nothing has been received", () => {
    assert.equal(outstanding(item("- 2026-07-02 @roofer — Send the estimate")), true);
    assert.equal(
      outstanding(item("- 2026-07-02 @roofer — Send the estimate", "  - followed up 2026-08-01")),
      true,
      "chasing it does not settle it",
    );
  });

  test("is false once a receipt is recorded", () => {
    const waiting = item(
      "- 2026-07-02 @roofer — Send the estimate",
      "  - followed up 2026-08-01",
      "  - received 2026-08-14",
    );
    assert.equal(outstanding(waiting), false);
  });

  test("a receipt anywhere in the history settles it", () => {
    // A hand-edited file can put them in any order. The question is whether it
    // arrived, not when the user typed the line.
    const waiting = item(
      "- 2026-07-02 @roofer — Send the estimate",
      "  - received 2026-08-14",
      "  - followed up 2026-08-20",
    );
    assert.equal(outstanding(waiting), false);
  });
});

describe("a future-dated item", () => {
  test("is not corrected", () => {
    const waiting = item("- 2027-01-01 @Priya — Something dated in the future by hand");
    assert.equal(waiting.since, "2027-01-01", "shown as it reads");
    assert.equal(untouchedSince(waiting), "2027-01-01");
  });

  test("is not stale — a negative wait is not neglect", async () => {
    // The rule's own answer, from the other side of the seam: core withholds
    // nothing here, and policy declines to complain about a date in the future.
    const { createDefaultPolicy } = await import("../src/policy/default-policy");
    const { FakeVaultStore } = await import("./sort-fakes");

    const policy = createDefaultPolicy(new FakeVaultStore());
    const decision = await policy.decide({
      point: "waiting.stale.check",
      subject: "item",
      since: "2027-01-01",
      today: "2026-08-14",
    });

    assert.equal(decision.verdict, "allow");
  });
});
