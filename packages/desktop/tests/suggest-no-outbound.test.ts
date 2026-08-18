import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";

import {
  SortService,
  SuggestionService,
  catalogOf,
  parseIntelligenceConfig,
  type VaultStore,
} from "@waypoint/core";

import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { FsVaultStore } from "../src/main/adapters/fs-vault-store";
import { FsSortJournal } from "../src/main/adapters/fs-sort-journal";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault } from "./vault-fixture";

/**
 * FR-040 and SC-002: with nothing configured, nothing leaves the machine.
 *
 * Proved against **doubles rather than by reading the code** — the technique
 * `review-no-outbound.test.ts` established. Every way this process could reach
 * the network or start a subprocess is replaced with a recorder that throws,
 * and then a whole sort walk is driven through the real services. If anything
 * reached for any of them, the walk fails loudly and names what it touched.
 *
 * A static check of the source would be weaker in exactly the way that
 * matters: it proves the code as written contains no call, not that no call
 * happens. A transitive dependency, a lazy require, or a future refactor that
 * moved a transport up a layer would all pass a grep and fail this.
 */

type Recorded = { what: string; detail: string };

const attempts: Recorded[] = [];

const REAL = {
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
  exec: childProcess.exec,
  execFile: childProcess.execFile,
  fork: childProcess.fork,
  httpsRequest: https.request,
  httpRequest: http.request,
  netConnect: net.connect,
  tlsConnect: tls.connect,
  fetch: globalThis.fetch,
};

function trap(what: string): (...args: unknown[]) => never {
  return (...args: unknown[]): never => {
    const detail = String(args[0] ?? "").slice(0, 120);
    attempts.push({ what, detail });
    throw new Error(`${what} was called with ${detail}, and nothing is configured`);
  };
}

function installTraps(): void {
  attempts.length = 0;
  (childProcess as Record<string, unknown>)["spawn"] = trap("child_process.spawn");
  (childProcess as Record<string, unknown>)["spawnSync"] = trap("child_process.spawnSync");
  (childProcess as Record<string, unknown>)["exec"] = trap("child_process.exec");
  (childProcess as Record<string, unknown>)["execFile"] = trap("child_process.execFile");
  (childProcess as Record<string, unknown>)["fork"] = trap("child_process.fork");
  (https as Record<string, unknown>)["request"] = trap("https.request");
  (http as Record<string, unknown>)["request"] = trap("http.request");
  (net as Record<string, unknown>)["connect"] = trap("net.connect");
  (tls as Record<string, unknown>)["connect"] = trap("tls.connect");
  (globalThis as Record<string, unknown>)["fetch"] = trap("fetch");
}

function restoreTraps(): void {
  (childProcess as Record<string, unknown>)["spawn"] = REAL.spawn;
  (childProcess as Record<string, unknown>)["spawnSync"] = REAL.spawnSync;
  (childProcess as Record<string, unknown>)["exec"] = REAL.exec;
  (childProcess as Record<string, unknown>)["execFile"] = REAL.execFile;
  (childProcess as Record<string, unknown>)["fork"] = REAL.fork;
  (https as Record<string, unknown>)["request"] = REAL.httpsRequest;
  (http as Record<string, unknown>)["request"] = REAL.httpRequest;
  (net as Record<string, unknown>)["connect"] = REAL.netConnect;
  (tls as Record<string, unknown>)["connect"] = REAL.tlsConnect;
  (globalThis as Record<string, unknown>)["fetch"] = REAL.fetch;
}

afterEach(restoreTraps);

const SEED =
  "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof.\n" +
  "- 2026-08-17T09:20:00-04:00 book the dentist\n" +
  "- 2026-08-17T09:30:00-04:00 a third thing entirely\n";

function buildVault() {
  const vault = makeTempVault();
  vault.write("inbox.md", SEED);
  vault.write("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n\n## Outcome\n\nSurvives a winter.\n");
  vault.write("areas/home.md", "# Home\n\nstatus: active\n");
  return vault;
}

describe("a whole sort walk, with nothing configured", () => {
  test("reaches for no subprocess, socket, or fetch", async () => {
    const vault = buildVault();
    try {
      const store = new FsVaultStore(vault.root);
      const sort = new SortService({
        inbox: new FsInboxDocument(vault.inboxPath, new InboxMutex()),
        vault: store,
        journal: new FsSortJournal(vault.path("sort-journal.json")),
      });

      // Exactly what `main.ts` does with a vault that has no intelligence.md.
      const config = parseIntelligenceConfig(await store.read("intelligence.md"));
      assert.equal(config.kind, "off");

      const suggest = new SuggestionService({ catalog: catalogOf(store as VaultStore) });

      installTraps();

      // The whole walk: count, destinations, and every item routed — plus an
      // ask on each one, which is the path that could reach out if anything
      // could.
      await sort.count();
      await sort.destinations();

      for (let i = 0; i < 3; i++) {
        const item = await sort.next();
        assert.ok(item, "an item must remain");

        const split = await suggest.prepareSplit(item);
        assert.equal(split.ok, false);
        const destination = await suggest.prepareDestination(item.text);
        assert.equal(destination.ok, false);

        assert.equal((await sort.sort(item.ref, { to: "trash" })).ok, true);
      }

      await sort.recover();
      assert.equal(await sort.isEmpty(), true);

      restoreTraps();
      assert.deepEqual(attempts, [], "something reached for the outside world");
    } finally {
      restoreTraps();
      vault.cleanup();
    }
  });

  test("a split accepted by hand writes the file and still reaches for nothing", async () => {
    const vault = buildVault();
    try {
      const store = new FsVaultStore(vault.root);
      const sort = new SortService({
        inbox: new FsInboxDocument(vault.inboxPath, new InboxMutex()),
        vault: store,
        journal: new FsSortJournal(vault.path("sort-journal.json")),
      });

      installTraps();

      const item = await sort.next();
      assert.ok(item);
      // A user with no transport, typing the pieces themselves.
      assert.equal((await sort.split(item.ref, ["chase the vendor contract", "also the roof"])).ok, true);

      restoreTraps();
      assert.deepEqual(attempts, []);
      assert.match(vault.read("inbox.md"), /also the roof/);
    } finally {
      restoreTraps();
      vault.cleanup();
    }
  });
});

describe("the traps themselves work", () => {
  test("a deliberate call is recorded, so a green above means something", () => {
    installTraps();
    try {
      assert.throws(() => childProcess.spawn("echo", ["hello"]));
      assert.throws(() => https.request("https://example.invalid/"));
    } finally {
      restoreTraps();
    }

    // Without this, a bug that made `installTraps` a no-op would turn every
    // assertion above into a tautology.
    assert.deepEqual(
      attempts.map((a) => a.what),
      ["child_process.spawn", "https.request"],
    );
  });
});
