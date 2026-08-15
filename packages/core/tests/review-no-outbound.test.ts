import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * Nothing leaves the machine, and nobody is contacted.
 *
 * "Waiting for Priya" is a note to *self*. The review surfaces it and the user
 * decides what to do about it in whatever tool they actually talk to Priya in.
 * A nudge sent on the user's behalf would be the application speaking in their
 * name, which is a different product (FR-046, SC-013).
 *
 * Asserted against doubles that would record a send if one happened, rather
 * than by reading the code and concluding there is no sender.
 */

const WAITING = `- 2026-06-01 @Priya — Confirm the migration window moved
- 2026-06-02 @roofer — Send the revised estimate
`;

const PROJECT = [
  "# Docs refresh",
  "",
  "status: waiting",
  "",
  "## Ledger",
  "",
  "- 2026-05-01 status active → waiting",
  "",
].join("\n");

describe("across the whole waiting step", () => {
  test("no network call is attempted", async () => {
    const sends: string[] = [];
    const realFetch = globalThis.fetch;
    // Anything that tried to reach the outside world would go through here.
    (globalThis as { fetch?: unknown }).fetch = (input: unknown): never => {
      sends.push(String(input));
      throw new Error("the review must not reach the network");
    };

    try {
      const { service } = makeReview({
        files: { "waiting.md": WAITING, "projects/docs-refresh.md": PROJECT },
      });
      await service.start();
      await service.advance({ confirmed: true });
      await service.advance();

      const { stale } = await service.waitingStep();
      assert.equal(stale.length, 2, "both are surfaced");

      await service.recordFollowUp({ index: stale[0]?.item.index ?? 0, raw: stale[0]?.item.raw ?? "" });
      const after = await service.waitingStep();
      await service.recordReceived({
        index: after.stale[0]?.item.index ?? 1,
        raw: after.stale[0]?.item.raw ?? "",
      });
      await service.recordLeft({ slug: "docs-refresh" });

      assert.deepEqual(sends, [], "recording a follow-up is a note, not a message");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = realFetch;
    }
  });

  test("no notification, reminder, or message reaches an injected sink", async () => {
    // There is deliberately no outbound port to inject. The nearest thing the
    // service takes is a summary provider, and even that is only reached at
    // completion and only with the review's own record — so a provider that
    // recorded every call is the strictest available witness for the waiting
    // step, and it must record nothing.
    const calls: unknown[] = [];
    const { service } = makeReview({
      files: { "waiting.md": WAITING, "projects/docs-refresh.md": PROJECT },
      summary: {
        name: "witness",
        draft: (record: unknown): Promise<string> => {
          calls.push(record);
          return Promise.resolve("");
        },
      },
    });

    await service.start();
    await service.advance({ confirmed: true });
    await service.advance();
    const { stale } = await service.waitingStep();
    await service.recordFollowUp({ index: stale[0]?.item.index ?? 0, raw: stale[0]?.item.raw ?? "" });

    assert.deepEqual(calls, [], "nothing about the waiting step reaches anything outbound");
  });

  test("the owner's name never leaves the vault it was written in", async () => {
    const { service, vault } = makeReview({
      files: { "waiting.md": WAITING, "projects/docs-refresh.md": PROJECT },
    });
    await service.start();
    await service.advance({ confirmed: true });
    await service.advance();

    const { stale } = await service.waitingStep();
    await service.recordFollowUp({ index: stale[0]?.item.index ?? 0, raw: stale[0]?.item.raw ?? "" });

    // Every write went to a file in the vault, and to nowhere else.
    for (const path of new Set(vault.writeLog)) {
      assert.ok(
        path === "waiting.md" || path.startsWith("log/") || path.startsWith("projects/"),
        `wrote to ${path}, which is not a vault file this step owns`,
      );
    }
  });
});
