import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview, passAllSteps, StubSummaryProvider } from "./review-fakes";

/**
 * A provider sees the review's own record and nothing else.
 *
 * This is the privacy boundary, and it is guarded by counting what is *absent*:
 * the fixture plants a distinctive marker in every file a provider must never
 * see, and none of them may appear in the payload. A test that only checked the
 * payload's shape would pass while leaking (FR-108, SC-015c).
 */

const PROJECT_MARKER = "MARKER-PROJECT-e7f1";
const INBOX_MARKER = "MARKER-INBOX-91ab";
const IDENTITY_MARKER = "MARKER-IDENTITY-4c2d";
const POLICY_MARKER = "MARKER-POLICY-55aa";
const WAITING_MARKER = "MARKER-WAITING-3f80";

function plantedVault(): Record<string, string> {
  return {
    "projects/one.md": [`# ${PROJECT_MARKER}`, "", "status: active", "", "## Outcome", "", PROJECT_MARKER, ""].join("\n"),
    "identity.md": [`me: ${IDENTITY_MARKER}`, "", "## Aliases", "", `- ${IDENTITY_MARKER}`, ""].join("\n"),
    "policy.md": ["# Policy", "", "wip limit: 3", `# ${POLICY_MARKER}`, ""].join("\n"),
    "waiting.md": [`- 2026-08-01 @${WAITING_MARKER} — ${WAITING_MARKER}`, ""].join("\n"),
  };
}

describe("the summary payload", () => {
  test("carries nothing from any file but the review's own record", async () => {
    const provider = new StubSummaryProvider({ text: "ok" });
    const { service } = makeReview({
      summary: provider,
      inbox: `- ${INBOX_MARKER}\n`,
      files: plantedVault(),
    });

    await passAllSteps(service);
    await service.draftSummary();

    assert.equal(provider.seen.length, 1);
    const payload = JSON.stringify(provider.seen[0]);

    for (const marker of [PROJECT_MARKER, INBOX_MARKER, IDENTITY_MARKER, POLICY_MARKER, WAITING_MARKER]) {
      assert.doesNotMatch(payload, new RegExp(marker), `${marker} reached the provider`);
    }
  });

  test("carries the week, the start date, and the recorded decisions", async () => {
    const provider = new StubSummaryProvider({ text: "ok" });
    const { service } = makeReview({ summary: provider, inbox: "- one\n- two\n" });

    await passAllSteps(service);
    await service.draftSummary();

    const payload = provider.seen[0] as Record<string, unknown>;
    assert.equal(payload["week"], "2026-W33");
    assert.equal(payload["started"], "2026-08-14");
    assert.ok(Array.isArray(payload["projects"]));
    assert.ok(Array.isArray(payload["waiting"]));
    assert.equal((payload["inbox"] as { count: number } | null)?.count, 2);
  });

  test("carries no vault, path, or callable a provider could fetch with", async () => {
    const provider = new StubSummaryProvider({ text: "ok" });
    const { service } = makeReview({ summary: provider });

    await passAllSteps(service);
    await service.draftSummary();

    const payload = provider.seen[0] as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      assert.notEqual(typeof value, "function", `${key} is callable, which is a way out of the boundary`);
    }
    assert.equal(payload["vault"], undefined);
    assert.equal(payload["path"], undefined);
  });

  test("nothing is sent at all when no provider is supplied", async () => {
    const { service } = makeReview({ inbox: "- one\n", files: plantedVault() });

    await passAllSteps(service);
    const draft = await service.draftSummary();

    assert.equal(draft.available, false, "no provider, no payload, nothing leaves the machine");
  });
});
