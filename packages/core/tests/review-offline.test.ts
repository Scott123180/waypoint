import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { makeReview, StubSummaryProvider } from "./review-fakes";

/**
 * Every verb completes with no network available (FR-085, SC-017).
 *
 * Mirrors `project-offline.test.ts`. Principle III is structural — the core
 * imports nothing that could reach a network — and this makes it observable by
 * breaking every network primitive and running the whole surface anyway.
 *
 * The summary port is the reason this test matters more here than elsewhere:
 * it is the first seam in the codebase whose *purpose* is to let something call
 * out. With no provider supplied, completing a review must not touch the
 * network, and the shipped configuration is exactly that (FR-104).
 */

describe("with the network broken", () => {
  test("every review verb still works", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const { service } = makeReview({ inbox: "- one\n" });

      const started = await service.start();
      assert.equal(started.week, "2026-W33");

      assert.equal((await service.inboxStep()).count, 1);
      assert.ok((await service.advance({ confirmed: true })).ok);
      assert.ok((await service.advance()).ok);
      assert.ok((await service.advance()).ok);

      assert.equal((await service.draftSummary()).available, false);

      const done = await service.complete({ note: "offline and finished" });
      assert.ok(done.ok, "completing must not require a network");

      assert.equal((await service.history()).length, 1);
      assert.ok(await service.get("2026-W33"));

      assert.equal(fetchMock.mock.callCount(), 0, "nothing reached for the network");
    } finally {
      mock.restoreAll();
    }
  });

  test("a supplied provider is the only thing that could ever call out, and only when asked", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const provider = new StubSummaryProvider({ text: "drafted locally" });
      const { service } = makeReview({ summary: provider });

      await service.start();
      for (let i = 0; i < 3; i++) await service.advance();
      await service.complete({ note: "no draft asked for" });

      assert.equal(provider.calls, 0);
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      mock.restoreAll();
    }
  });
});
