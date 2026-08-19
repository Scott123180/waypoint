import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What these two modules deliberately do NOT reach for.
 *
 * Scope boundaries rot silently, so they are tripwires rather than comments —
 * the discipline `project-scope-boundaries.test.ts` and
 * `intelligence-scope-boundaries.test.ts` already set.
 *
 * Four boundaries matter here:
 *
 *   - **Electron.** Core holds the rules and imports nothing from the client.
 *   - **The network.** FR-031 forbids contacting any external calendar, and the
 *     strongest form of that is a module with no way to contact anything.
 *   - **The review.** Its verbs write a review log line, which is its record of
 *     its own ritual and the one thing this feature must never reach (FR-050).
 *   - **Intelligence.** Nothing here is generated, and there is no dependency
 *     through which something could be (FR-009).
 *
 * The last block is subtler and is the one this feature actually had to think
 * about: `shutdown-service.ts` **does** read `policy.md`, for the policy
 * module's own complaints about its own settings. It must take `problems` and
 * nothing else — reading a threshold, or comparing anything to one, would be
 * core holding a rule (Principle V).
 */

const SRC = join(__dirname, "..", "..", "src");
const MODULES = ["shutdown", "calendar"] as const;

function filesIn(dir: string): Array<{ name: string; source: string; code: string }> {
  return readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(".ts"))
    .map((name) => {
      const source = readFileSync(join(SRC, dir, name), "utf8");
      return {
        name: `${dir}/${name}`,
        source,
        // Comments name what must not be reached; only imports are evidence.
        code: source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
      };
    });
}

const ALL = MODULES.flatMap(filesIn);

const SERVICE = ALL.find((f) => f.name === "shutdown/shutdown-service.ts");
assert.ok(SERVICE, "shutdown-service.ts must exist");

/** Every module specifier imported, per file. */
function importsOf(code: string): string[] {
  return [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1] as string);
}

describe("neither module imports from the client", () => {
  for (const file of ALL) {
    test(`${file.name} never imports electron`, () => {
      assert.ok(
        !importsOf(file.code).some((spec) => spec === "electron" || spec.startsWith("electron/")),
        "core holds the rules; the client renders them",
      );
    });
  }
});

describe("neither module can reach the network", () => {
  const NETWORK = ["node:http", "node:https", "node:net", "node:dns", "node:tls", "http", "https", "net"];

  for (const file of ALL) {
    test(`${file.name} imports no network module`, () => {
      for (const spec of importsOf(file.code)) {
        assert.ok(!NETWORK.includes(spec), `${spec} is a way to contact an external calendar`);
      }
    });

    test(`${file.name} names no fetch, socket, or request`, () => {
      for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "createConnection", "request("]) {
        assert.ok(!file.code.includes(forbidden), `${forbidden} in ${file.name}`);
      }
    });
  }
});

describe("neither module reaches the review or the intelligence layer", () => {
  for (const file of ALL) {
    test(`${file.name} imports from neither`, () => {
      for (const spec of importsOf(file.code)) {
        assert.doesNotMatch(
          spec,
          /\/review\/|\/suggest\/|\/intelligence\//,
          `${spec} would reach a verb that writes a log line, or one that generates something`,
        );
      }
    });
  }

  test("no file names ReviewService, SuggestionService, or a provider", () => {
    for (const file of ALL) {
      for (const forbidden of [
        "ReviewService",
        "SuggestionService",
        "SplitProvider",
        "DestinationProvider",
        "SummaryProvider",
        "Transport",
      ]) {
        assert.ok(!file.code.includes(forbidden), `${file.name} names ${forbidden}`);
      }
    }
  });
});

describe("the shutdown reads policy's complaints and nothing else", () => {
  test("it takes only `problems` from the parsed configuration", () => {
    assert.match(
      SERVICE.code,
      /const \{ problems \} = parsePolicyConfig\(/,
      "destructuring anything else would be core learning a rule's value",
    );
  });

  test("it never names a threshold", () => {
    for (const forbidden of ["stalenessDays", "wipLimit", "milestoneCap", "weeklyOutcomeCap", "inboxGate"]) {
      assert.ok(!SERVICE.code.includes(forbidden), `core read the configured ${forbidden}`);
    }
  });

  test("it makes no comparison a rule should make", () => {
    assert.doesNotMatch(SERVICE.code, />=?\s*config\./, "core compared something to a configured value");
    assert.doesNotMatch(SERVICE.code, /days\s*[<>]/, "core decided what stale means");
  });

  test("it asks the decision point instead, and reads only the verdict and the reason", () => {
    assert.match(SERVICE.code, /point: "waiting\.stale\.check"/);
    assert.match(SERVICE.code, /decision\.verdict === "allow"/);
    assert.match(SERVICE.code, /reason: decision\.reason/);
  });

  test("`calendar/` reaches no rule at all", () => {
    const calendar = ALL.filter((f) => f.name.startsWith("calendar/"));
    for (const file of calendar) {
      assert.ok(!file.code.includes("policy"), `${file.name} reaches for a rule; it is a parser`);
      assert.ok(!file.code.includes("decide("), `${file.name} consults a decision point`);
    }
  });
});

describe("neither module can write", () => {
  test("the shutdown's vault dependency is narrowed to `read`", () => {
    assert.match(SERVICE.source, /vault: Pick<VaultStore, "read">/);
  });

  test("and the calendar module has no vault at all", () => {
    for (const file of ALL.filter((f) => f.name.startsWith("calendar/"))) {
      assert.ok(!file.code.includes("VaultStore"), `${file.name} holds a vault`);
    }
  });
});
