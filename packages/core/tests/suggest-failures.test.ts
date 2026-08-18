import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SortService } from "../src/sort/sort-service";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { SUGGESTION_FAILURES, type SuggestionFailure } from "../src/suggest/types";
import { parseIntelligenceConfig } from "../src/suggest/intelligence-config";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";
import { RecordingTransport, projectFile } from "./suggest-fakes";

/**
 * FR-062–FR-065 and SC-008: every way this can fail, as one set.
 *
 * Seven members, and the same three things true of each: the data directory is
 * byte-identical afterwards, exactly one message is produced, and **no
 * automatic retry occurs**. Tested as a set rather than one at a time because
 * the property that matters is uniformity — a taxonomy where six members are
 * harmless and the seventh writes something is not a taxonomy.
 *
 * The two transports are what make this more than a shape check: their errors
 * arrive as genuinely different kinds of thing, and both land here.
 */

const ITEM = "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof.\n";

function harness() {
  const vault = new FakeVaultStore();
  vault.files.set("projects/vendor-consolidation.md", projectFile("Vendor Consolidation", "Renewed by Q4."));
  vault.files.set("identity.md", "me: Someone\n");
  vault.files.set("policy.md", "wip limit: 3\n");

  const inbox = new FakeInboxDocument(ITEM);
  const sort = new SortService({ inbox, vault, journal: new FakeSortJournal(), clock: fixedClock() });
  return { vault, inbox, sort };
}

function checksums(vault: FakeVaultStore, inbox: FakeInboxDocument): string[] {
  const digest = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
  return [
    ...[...vault.files.entries()].map(([p, c]) => `${p}:${digest(c)}`),
    `inbox.md:${digest(inbox.content)}`,
  ].sort();
}

/** An error carrying a reason, exactly as both shipped transports produce. */
function transportError(reason: SuggestionFailure, message: string): Error {
  return Object.assign(new Error(message), { reason });
}

/**
 * One provoker per failure mode. Each returns the service to use and how many
 * times the transport was contacted, so "no retry" is checkable.
 */
const MODES: {
  reason: SuggestionFailure;
  /** Whether a message is expected. `not-configured` is the one that carries none. */
  silent?: boolean;
  make(vault: FakeVaultStore): { service: SuggestionService; calls: () => number };
}[] = [
  {
    reason: "not-configured",
    silent: true,
    make: (vault) => ({
      // No intelligence at all — the shipped state.
      service: new SuggestionService({ catalog: catalogOf(vault) }),
      calls: () => 0,
    }),
  },
  {
    reason: "misconfigured",
    make: (vault) => {
      const t = new RecordingTransport({
        fail: transportError("misconfigured", "intelligence.md names a transport that does not exist."),
      });
      return { service: serviceWith(vault, t), calls: () => t.calls };
    },
  },
  {
    reason: "credential",
    make: (vault) => {
      const t = new RecordingTransport({
        fail: transportError("credential", "The client certificate at /home/me/.certs/x.pem is not there."),
      });
      return { service: serviceWith(vault, t), calls: () => t.calls };
    },
  },
  {
    reason: "unreachable",
    make: (vault) => {
      const t = new RecordingTransport({
        fail: transportError("unreachable", "Could not run `claude`: not found."),
      });
      return { service: serviceWith(vault, t), calls: () => t.calls };
    },
  },
  {
    reason: "failed",
    make: (vault) => {
      const t = new RecordingTransport({
        fail: transportError("failed", "The tool exited without answering: boom."),
      });
      return { service: serviceWith(vault, t), calls: () => t.calls };
    },
  },
  {
    reason: "unusable",
    make: (vault) => {
      // Completed, and the answer could not be understood.
      const t = new RecordingTransport({ reply: "this is not JSON at all" });
      return { service: serviceWith(vault, t), calls: () => t.calls };
    },
  },
  {
    reason: "timed-out",
    make: (vault) => {
      const t = new RecordingTransport({ hang: true });
      return {
        service: new SuggestionService({
          catalog: catalogOf(vault),
          intelligence: createDefaultIntelligence(t),
          timeoutMs: 20,
        }),
        calls: () => t.calls,
      };
    },
  },
];

function serviceWith(vault: FakeVaultStore, transport: RecordingTransport): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vault),
    intelligence: createDefaultIntelligence(transport),
  });
}

describe("the taxonomy is closed and complete", () => {
  test("seven members, and this file provokes every one", () => {
    assert.equal(SUGGESTION_FAILURES.length, 7);
    assert.deepEqual(
      MODES.map((m) => m.reason).sort(),
      [...SUGGESTION_FAILURES].sort(),
      "a failure mode exists that nothing here provokes",
    );
  });
});

for (const mode of MODES) {
  describe(`${mode.reason}`, () => {
    for (const kind of ["split", "destination"] as const) {
      test(`a ${kind} request reports it, writes nothing, and does not retry`, async () => {
        const h = harness();
        const before = checksums(h.vault, h.inbox);
        const { service, calls } = mode.make(h.vault);

        const item = await h.sort.next();
        assert.ok(item);

        const prepared =
          kind === "split" ? await service.prepareSplit(item) : await service.prepareDestination(item.text);

        // `not-configured` refuses at prepare; every other mode refuses at run.
        const outcome = prepared.ok ? await prepared.prepared.run() : prepared;

        assert.equal(outcome.ok, false, "a failure produced a proposal");
        if (outcome.ok) return;
        assert.equal(outcome.reason, mode.reason);

        // Exactly one message, and it is a string a client can render as-is.
        if (mode.silent) {
          assert.equal(outcome.message, "", "not-configured must carry nothing to show");
        } else {
          assert.equal(typeof outcome.message, "string");
          assert.ok(outcome.message.length > 0, "the user is told, plainly");
          assert.ok(!Array.isArray((outcome as { messages?: unknown }).messages), "one message, never a list");
        }

        // No automatic retry. One attempt at most, ever (FR-065).
        assert.ok(calls() <= 1, `the transport was contacted ${calls()} times`);

        // The data directory is byte-identical.
        assert.deepEqual(checksums(h.vault, h.inbox), before, "a failure wrote something");
      });
    }

    test("and the ordinary sort path works immediately afterwards", async () => {
      const h = harness();
      const { service } = mode.make(h.vault);

      const item = await h.sort.next();
      assert.ok(item);
      const prepared = await service.prepareDestination(item.text);
      if (prepared.ok) await prepared.prepared.run();

      // The whole promise of "you are told plainly, and you sort by hand".
      assert.equal((await h.sort.sort(item.ref, { to: "trash" })).ok, true);
    });
  });
}

describe("no failure leaks what should not be shown", () => {
  test("no message contains the request that was being sent", async () => {
    const h = harness();
    const secret = "a private dictation about a colleague";
    h.inbox.content = `- 2026-08-17T09:14:22-04:00 ${secret}\n`;

    for (const mode of MODES.filter((m) => m.silent !== true)) {
      const { service } = mode.make(h.vault);
      const item = await h.sort.next();
      assert.ok(item);

      const prepared = await service.prepareDestination(item.text);
      const outcome = prepared.ok ? await prepared.prepared.run() : prepared;

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.doesNotMatch(outcome.message, new RegExp(secret), `${mode.reason} echoed the request`);
    }
  });

  test("no message contains credential material", async () => {
    const h = harness();
    for (const mode of MODES) {
      const { service } = mode.make(h.vault);
      const item = await h.sort.next();
      assert.ok(item);
      const prepared = await service.prepareSplit(item);
      const outcome = prepared.ok ? await prepared.prepared.run() : prepared;

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.doesNotMatch(outcome.message, /BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });
});

describe("a configuration problem is reported once, and blocks nothing", () => {
  test("a malformed setting yields one message naming the line to fix", () => {
    const config = parseIntelligenceConfig("transport: copilot\n");

    assert.equal(config.kind, "problem");
    if (config.kind !== "problem") return;
    assert.equal(typeof config.message, "string");
    assert.match(config.message, /copilot/);
    assert.match(config.message, /sorting is unaffected/i);
  });

  test("and the layer is off rather than half-configured", () => {
    for (const content of [
      "transport: copilot\n",
      "transport: certificate\n",
      "transport: certificate\nendpoint: http://insecure\ncertificate: /a\nkey: /b\n",
    ]) {
      const config = parseIntelligenceConfig(content);
      assert.equal(config.kind, "problem");
      // Never a partial config a caller could half-use, and never a fallback
      // to the other transport — falling back is a choice the user did not
      // make, and on a work machine the fallback is the one that is blocked.
      assert.equal("command" in config, false);
      assert.equal("endpoint" in config, false);
    }
  });
});
