import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as core from "../src/index";
import { TRANSPORTS } from "../src/suggest/intelligence-config";
import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { RecordingTransport } from "./suggest-fakes";

/**
 * The standing tripwire, in the shape of `project-scope-boundaries.test.ts`.
 *
 * **Its first run is expected green.** This test is written to fail *later* —
 * the moment a loader, a discovery mechanism, a registration API, or a
 * task-management concept appears in either seam. Nobody should mistake it for
 * a test that was never wired up.
 *
 * What it guards is Constitution Principle V, and the roadmap's stated
 * position: the transport interface should survive two genuinely different
 * real environments before anyone considers publishing it. Publishing an
 * extension API is a promise that is expensive to take back, and the way it
 * gets made is by accident — a `registerTransport` added for a test, a
 * `plugins/` directory added for convenience (FR-057, FR-058, FR-072).
 */

const PORTS = readFileSync(join(__dirname, "..", "..", "src", "ports", "index.ts"), "utf8");
const CONFIG = readFileSync(
  join(__dirname, "..", "..", "src", "suggest", "intelligence-config.ts"),
  "utf8",
);

/** Comments describe the restraint; only the code is evidence of it. */
function code(source: string): string {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("no loader, no discovery, no registration API", () => {
  test("core exports nothing that would register or find an implementation", () => {
    for (const name of Object.keys(core)) {
      assert.doesNotMatch(
        name,
        /register|discover|loadTransport|plugin|extension/i,
        `${name} is the first step toward a public extension API`,
      );
    }
  });

  test("createDefaultIntelligence is the only factory exported for the seam", () => {
    const factories = Object.keys(core).filter((n) => /^create/.test(n));
    assert.deepEqual(
      factories.sort(),
      ["createDefaultIntelligence", "createDefaultPolicy"],
      "a second factory here is a second way to supply a module",
    );
  });

  test("nothing in the config module resolves a name into an implementation", () => {
    const source = code(CONFIG);
    for (const needle of ["require(", "import(", "eval(", "Function("]) {
      assert.ok(!source.includes(needle), `${needle} in the config is dynamic loading`);
    }
  });
});

describe("the transport set is closed", () => {
  test("exactly two values, and they are the two that ship", () => {
    assert.deepEqual([...TRANSPORTS], ["command", "certificate"]);
  });

  test("selection cannot be a runtime lookup, because there is no registry", () => {
    const source = code(CONFIG);
    assert.ok(!/new Map\(|Object\.keys\(|\[\s*name\s*\]/.test(source), "the config looks a transport up by name");
  });

  test("an unrecognised value is refused rather than resolved", () => {
    const config = core.parseIntelligenceConfig("transport: anything-else\n");
    assert.equal(config.kind, "problem");
  });
});

describe("a transport has never heard of task management", () => {
  test("its interface mentions nothing about projects, items, or sorting", () => {
    const declaration = /export interface Transport \{([\s\S]*?)\n\}/.exec(PORTS);
    assert.ok(declaration, "Transport must be declared in ports/index.ts");

    const body = code(declaration[1] ?? "");
    for (const concept of [
      "project",
      "area",
      "inbox",
      "item",
      "destination",
      "sort",
      "split",
      "milestone",
      "waiting",
    ]) {
      assert.doesNotMatch(
        body,
        new RegExp(concept, "i"),
        `Transport names "${concept}" — a transport that knew what it carried would be an intelligence module wearing the wrong interface`,
      );
    }
  });

  test("it carries bytes: a name, and one send", () => {
    const transport = new RecordingTransport();
    assert.equal(typeof transport.send, "function");
    assert.equal(transport.send.length, 2, "content and a signal, and nothing else");
  });
});

describe("the provider verbs are named for what they do, not for what they read", () => {
  test("no provider method is named for a project, milestone, outcome, DRI, or review", () => {
    const module = createDefaultIntelligence(new RecordingTransport());
    for (const name of Object.keys(module)) {
      assert.doesNotMatch(
        name,
        /project|milestone|outcome|nextaction|next-action|dri|review|ledger|status/i,
        `${name} names something a proposal must never be about (FR-072)`,
      );
    }
  });

  test("the module is handed a transport and nothing else", () => {
    assert.equal(createDefaultIntelligence.length, 1);
  });

  test("this feature suggests nothing about a project or a milestone", () => {
    // FR-072's scope line: splitting an item and placing an item. Not
    // proposing an outcome, a next action, a DRI, or a milestone — those are
    // Feature 3's, and a suggestion about them is a different feature.
    for (const name of Object.keys(core)) {
      assert.doesNotMatch(
        name,
        /suggestMilestone|suggestOutcome|suggestProject|suggestNextAction|draftSummary/i,
        `${name} is a suggestion this feature deliberately does not make`,
      );
    }
  });
});

describe("Feature 5's summary port is still unimplemented, and deliberately so", () => {
  test("no summary provider ships from here", () => {
    // The ROADMAP anticipated that this feature would supply one. The user
    // excluded weekly-review summary drafting, so the port is left as it is
    // rather than quietly filled — recorded in the spec's Out of Scope.
    assert.equal("createDefaultSummaryProvider" in core, false);
    const module = createDefaultIntelligence(new RecordingTransport()) as unknown as Record<string, unknown>;
    assert.equal("draft" in module, false, "the default module must not satisfy SummaryProvider");
  });
});
