import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Everything works with no network (Principle III, FR-059, SC-016).
 *
 * Mirrors `project-offline.test.ts`: rather than trusting that nothing reaches
 * the network, the network modules are replaced with ones that throw, so a
 * reach becomes a failure here instead of a surprise on a train.
 *
 * This is close to vacuous for this feature — there is no network path to lose —
 * and it is written anyway, because "obviously offline" is exactly the claim
 * that stops being true when someone adds a font, a telemetry ping, or an
 * update check to a rendering path.
 */

const NETWORK_MODULES = ["node:http", "node:https", "node:net", "node:dns", "node:tls"];

function severNetwork(): () => void {
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = function (...args: unknown[]) {
    const request = String(args[0]);
    if (NETWORK_MODULES.includes(request) || NETWORK_MODULES.includes(`node:${request}`)) {
      throw new Error(`the retrospective reached for ${request}; it must work offline`);
    }
    return load.apply(this, args);
  };
  return () => {
    (Module as unknown as { _load: unknown })._load = load;
  };
}

const VAULT = {
  "projects/roof.md": projectFile({
    slug: "roof",
    title: "Roof repair",
    status: "done",
    completed: "2026-06-30",
    milestones: [{ text: "Estimate approved", done: true, completedOn: "2026-06-10" }],
    ledger: ["- 2026-01-02 status created → active"],
  }),
  "top-three.md": topThreeFile([
    { week: "2026-W24", outcomes: [{ text: "Ship it", done: true, completedOn: "2026-06-11" }] },
  ]),
  "log/2026-W24.md": logFile({ week: "2026-W24", note: "A fine week." }),
};

describe("with the network severed", () => {
  test("a full reading and its report still work", async () => {
    const restore = severNetwork();
    try {
      const { service } = serviceFor(VAULT);
      const r = await readOk(service, range("2026-01-01", "2026-12-31"));
      const text = renderReport(r);

      assert.ok(r.completions.length > 0);
      assert.match(text, /Roof repair/);
    } finally {
      restore();
    }
  });

  test("narrowing, the history, and the export still work", async () => {
    const restore = severNetwork();
    try {
      const { service } = serviceFor(VAULT);
      const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
      assert.ok(r.history);
      assert.ok(renderReport(r).length > 0);
    } finally {
      restore();
    }
  });

  test("a refusal still works", async () => {
    const restore = severNetwork();
    try {
      const { service } = serviceFor(VAULT);
      const result = await service.read(range("2026-12-31", "2026-01-01"));
      assert.equal(result.ok, false);
    } finally {
      restore();
    }
  });
});
