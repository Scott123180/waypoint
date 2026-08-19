import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

import { policyFile, populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * Everything works with no network (Principle III, FR-008, FR-031, SC-009).
 *
 * Mirrors `retrospective-offline.test.ts` and `review-no-outbound.test.ts`:
 * rather than trusting that nothing reaches the network, the network modules are
 * replaced with ones that throw, so a reach becomes a failure here instead of a
 * surprise on a train.
 *
 * This is close to vacuous for this feature — there is no network path to lose,
 * and `calendar/` is a string parser with no way to contact anything — and it is
 * written anyway, because "obviously offline" is exactly the claim that stops
 * being true when someone adds a font, a telemetry ping, an update check, or a
 * "sync with your real calendar" to a reading path.
 */

const NETWORK_MODULES = ["node:http", "node:https", "node:net", "node:dns", "node:tls"];

function severNetwork(): () => void {
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = function (...args: unknown[]) {
    const request = String(args[0]);
    if (NETWORK_MODULES.includes(request) || NETWORK_MODULES.includes(`node:${request}`)) {
      throw new Error(`the shutdown reached for ${request}; it must work offline`);
    }
    return load.apply(this, args);
  };
  return () => {
    (Module as unknown as { _load: unknown })._load = load;
  };
}

describe("with the network severed", () => {
  test("a full reading still produces all four panels", async () => {
    const restore = severNetwork();
    try {
      const { service } = shutdownFor(populatedVault());
      const view = await service.read();

      assert.ok(view.topThree.week?.outcomes.length);
      assert.ok(view.projects.items.length > 0);
      assert.ok(view.waiting.items.length > 0);
      assert.ok(view.calendar.items.length > 0);
    } finally {
      restore();
    }
  });

  test("the calendar panel in particular — nothing external is consulted about it", async () => {
    const restore = severNetwork();
    try {
      const { service } = shutdownFor(populatedVault());
      const view = await service.read();

      assert.equal(
        view.calendar.items[0]?.item.text,
        "Quarterly planning day",
        "`calendar.md` is a file, and reading it is the whole of what this panel does",
      );
    } finally {
      restore();
    }
  });

  test("degraded paths still work", async () => {
    const restore = severNetwork();
    try {
      const { service } = shutdownFor(
        { ...populatedVault(), "policy.md": policyFile({ "staleness days": "soon" }) },
        { unreadable: ["projects/alpha.md"] },
      );
      const view = await service.read();

      assert.equal(view.projects.failure?.path, "projects/");
      assert.equal(view.policyNotices.length, 1);
    } finally {
      restore();
    }
  });

  test("an empty vault still resolves", async () => {
    const restore = severNetwork();
    try {
      const { service } = shutdownFor({});
      assert.equal((await service.read()).today, "2026-08-19");
    } finally {
      restore();
    }
  });
});

describe("no outbound attempt is made", () => {
  test("global fetch is never called", async () => {
    const original = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts += 1;
      throw new Error("the shutdown attempted an outbound request");
    }) as typeof fetch;

    try {
      const { service } = shutdownFor(populatedVault());
      await service.read();
      assert.equal(attempts, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
