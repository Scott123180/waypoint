import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_POLICY_CONFIG } from "../src/policy/policy-config";
import { policyFile, populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * A typo in `policy.md` costs the user one setting, not their evening (FR-030).
 *
 * The fallback is **per value, never per file**: a `staleness days` that will not
 * parse restores the documented default for that value alone, and every other
 * setting the user made deliberately survives.
 *
 * A notice, never a refusal. This is the discipline Feature 5 established for
 * `review.inbox.advance` — a configuration error must not stop the user working
 * — and the words are the policy module's own, so nothing here composes a
 * sentence about the user's settings.
 */

describe("with no policy.md", () => {
  test("the documented default of seven applies", async () => {
    const view = await shutdownFor(populatedVault()).service.read();

    assert.equal(DEFAULT_POLICY_CONFIG.stalenessDays, 7);
    assert.deepEqual(view.waiting.items.map((s) => s.untouchedDays).sort((a, b) => a - b), [7, 79]);
  });

  test("and there is no notice — absence is not a problem", async () => {
    const view = await shutdownFor(populatedVault()).service.read();

    assert.deepEqual(view.policyNotices, []);
  });

  test("and no policy.md is created by having been consulted", async () => {
    const files = populatedVault();

    await shutdownFor(files).service.read();

    assert.ok(!("policy.md" in files));
  });
});

describe("with a malformed value", () => {
  const files = () => ({
    ...populatedVault(),
    "policy.md": policyFile({ "staleness days": "soon", "wip limit": 6 }),
  });

  test("the default applies for that value alone", async () => {
    const view = await shutdownFor(files()).service.read();

    assert.deepEqual(
      view.waiting.items.map((s) => s.untouchedDays).sort((a, b) => a - b),
      [7, 79],
      "seven days, exactly as if the line were not there",
    );
  });

  test("the problem is reported for display", async () => {
    const view = await shutdownFor(files()).service.read();

    assert.equal(view.policyNotices.length, 1);
    assert.match(view.policyNotices[0] ?? "", /"staleness days"/, "the line to look at");
    assert.match(view.policyNotices[0] ?? "", /"soon"/, "and what was typed there");
    assert.match(view.policyNotices[0] ?? "", /default of 7/, "and what applies instead");
  });

  test("nothing throws and nothing is refused", async () => {
    const { service } = shutdownFor(files());

    await assert.doesNotReject(() => service.read());

    const view = await service.read();
    assert.equal(view.waiting.failure, null);
    assert.equal(view.calendar.failure, null);
    assert.ok(view.calendar.items.length > 0, "the screen is fully usable");
  });

  test("two broken values are both reported", async () => {
    const view = await shutdownFor({
      ...populatedVault(),
      "policy.md": policyFile({ "staleness days": "soon", "inbox gate": "sometimes" }),
    }).service.read();

    assert.equal(view.policyNotices.length, 2);
    assert.ok(view.policyNotices.some((n) => /staleness days/.test(n)));
    assert.ok(view.policyNotices.some((n) => /inbox gate/.test(n)));
  });

  test("the notice appears even when nothing is stale", async () => {
    // The review surfaces the same complaint from its inbox step for the same
    // reason: a problem the user never sees is not "reported plainly", and a
    // quiet week is exactly when nothing else would mention it.
    const view = await shutdownFor({
      "policy.md": policyFile({ "staleness days": "soon" }),
    }).service.read();

    assert.deepEqual(view.waiting.items, []);
    assert.deepEqual(view.calendar.items, []);
    assert.equal(view.policyNotices.length, 1);
  });
});

describe("with a healthy policy.md", () => {
  test("silence is what nothing-wrong looks like", async () => {
    const view = await shutdownFor({
      ...populatedVault(),
      "policy.md": policyFile({ "staleness days": 14, "inbox gate": "block" }),
    }).service.read();

    assert.deepEqual(view.policyNotices, []);
    assert.deepEqual(
      view.waiting.items.map((s) => s.untouchedDays),
      [79],
      "and the configured value is the one that applied",
    );
  });
});
