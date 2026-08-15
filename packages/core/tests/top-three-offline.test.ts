import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Every top-three verb completes with no network available (FR-065, SC-016).
 *
 * Mirrors `project-offline.test.ts`. Principle III is structural — core imports
 * nothing that could reach a network — and this makes that observable by
 * breaking the runtime's network primitive and running the whole surface
 * anyway.
 */

describe("with the network broken", () => {
  test("every top-three verb still works", async () => {
    const explode = (): never => {
      throw new Error("network access attempted");
    };
    const fetchMock = mock.method(globalThis, "fetch", explode);

    try {
      const vault = seedVault({
        "top-three.md": ["# Top three", "", "## 2026-W32", "", "- [x] older — done 2026-08-08", ""].join("\n"),
      });
      const topThree = new TopThreeService({ vault, clock: new FixedClock("2026-08-14T10:00:00-04:00") });

      assert.equal((await topThree.current()).id, "2026-W33");
      assert.equal((await topThree.history()).length, 2);

      assert.ok((await topThree.addOutcome("a")).ok);
      assert.ok((await topThree.addOutcome("b")).ok);

      let week = await topThree.current();
      assert.ok(
        (await topThree.editOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" }, "a2")).ok,
      );

      week = await topThree.current();
      assert.ok(
        (await topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" })).ok,
      );

      week = await topThree.current();
      assert.ok(
        (await topThree.reopenOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" })).ok,
      );

      week = await topThree.current();
      assert.ok(
        (await topThree.removeOutcome({ week: week.id, index: 1, raw: week.outcomes[1]?.raw ?? "" })).ok,
      );

      assert.equal(fetchMock.mock.callCount(), 0, "nothing reached for the network");
    } finally {
      mock.restoreAll();
    }
  });
});
