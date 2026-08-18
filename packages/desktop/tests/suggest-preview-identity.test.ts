import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SuggestionService,
  catalogOf,
  createDefaultIntelligence,
  type Transport,
  type VaultStore,
} from "@waypoint/core";

/**
 * FR-041, FR-045, SC-007 — end to end, across the process boundary.
 *
 * `suggest-payload-identity.test.ts` proves the identity *inside core*, where
 * one string can be compared with `===`. That is the strong claim, and it is
 * where the design lives. But the desktop client puts an IPC bridge between
 * the value core produced and the value a person reads, and a bridge
 * serializes: whatever comes out the other side is a *copy*, so `===` cannot
 * be the assertion here and byte equality has to be.
 *
 * What this file adds, that `suggest-ipc-contract.test.ts` does not: that one
 * runs against the source and checks the *channel shape* — `run` takes an id,
 * not content. This one runs the values through the same round trip Electron's
 * structured clone performs and asserts the bytes survive it, for both request
 * kinds. Together they say: the renderer cannot influence what is sent, and
 * what it displays is what was sent.
 */

/** Exactly what `ipcRenderer.invoke` does to a value: structured clone. */
function acrossTheBridge<T>(value: T): T {
  return structuredClone(value);
}

class Recorder implements Transport {
  readonly name = "recorder";
  readonly received: string[] = [];

  send(request: string): Promise<string> {
    this.received.push(request);
    return Promise.resolve('{"pieces":[[0]],"nothingToSplit":false}');
  }
}

function vaultWith(files: Record<string, string>): Pick<VaultStore, "list" | "read"> {
  return {
    list: (dir) =>
      Promise.resolve(
        Object.keys(files)
          .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".md"))
          .map((p) => p.slice(dir.length + 1, -3))
          .sort(),
      ),
    read: (relPath) => Promise.resolve(files[relPath] ?? null),
  };
}

const VAULT = {
  "projects/roof-repair.md": "# Roof repair\n\nstatus: active\n\n## Outcome\n\nThe roof survives a winter.\n",
  "areas/home.md": "# Home\n\nstatus: active\n",
};

const ITEM = {
  text: "call the roofer about the estimate. also the gutters.",
  capturedAt: new Date("2026-08-17T09:14:22-04:00"),
  ref: { start: 0, end: 60, raw: "- 2026-08-17T09:14:22-04:00 ...\n" },
};

function serviceWith(transport: Transport): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vaultWith(VAULT)),
    intelligence: createDefaultIntelligence(transport),
  });
}

describe("the string the bridge returned is the string the transport received", () => {
  test("for a split", async () => {
    const transport = new Recorder();
    const result = await serviceWith(transport).prepareSplit(ITEM);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // What `suggest:prepare-split` hands back, cloned as Electron clones it.
    const crossed = acrossTheBridge({ id: "s1", payload: result.prepared.payload });
    // What the renderer would render, verbatim.
    const displayed = crossed.payload;

    await result.prepared.run();

    assert.equal(transport.received.length, 1);
    assert.equal(displayed, transport.received[0], "the displayed string is not the sent string");
    assert.equal(
      Buffer.from(displayed, "utf8").equals(Buffer.from(transport.received[0] ?? "", "utf8")),
      true,
      "the strings compare equal but the bytes differ",
    );
  });

  test("for a destination", async () => {
    const transport = new Recorder();
    const result = await serviceWith(transport).prepareDestination(ITEM.text);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const displayed = acrossTheBridge({ id: "s1", payload: result.prepared.payload }).payload;
    await result.prepared.run();

    assert.equal(displayed, transport.received[0]);
  });

  test("non-ASCII content survives the crossing byte for byte", async () => {
    const transport = new Recorder();
    const text = "café renovation 🎉. 日本語のメモ. naïve résumé.";
    const result = await serviceWith(transport).prepareDestination(text);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const displayed = acrossTheBridge({ payload: result.prepared.payload }).payload;
    await result.prepared.run();

    assert.equal(
      Buffer.from(displayed, "utf8").equals(Buffer.from(transport.received[0] ?? "", "utf8")),
      true,
    );
    assert.ok(displayed.includes("🎉"), "the emoji did not survive the crossing");
  });

  test("newlines and trailing whitespace survive, since they are part of the content", async () => {
    const transport = new Recorder();
    const result = await serviceWith(transport).prepareSplit({
      ...ITEM,
      text: "first line\n\n  indented second   \nthird",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const displayed = acrossTheBridge({ payload: result.prepared.payload }).payload;
    await result.prepared.run();

    assert.equal(displayed, transport.received[0]);
  });
});

describe("the renderer cannot influence what is sent", () => {
  test("a renderer that mutated its copy changes nothing about the send", async () => {
    const transport = new Recorder();
    const result = await serviceWith(transport).prepareSplit(ITEM);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The bridge hands the renderer a *copy*. Tampering with it is exactly
    // what `suggest:run` taking an opaque id makes irrelevant — there is no
    // argument through which the tampered value could travel back.
    const crossed = acrossTheBridge({ id: "s1", payload: result.prepared.payload });
    crossed.payload = "something the user never saw";

    await result.prepared.run();

    assert.doesNotMatch(transport.received[0] ?? "", /never saw/);
    assert.equal(transport.received[0], result.prepared.payload);
  });

  test("run takes no argument on the core side either", async () => {
    const result = await serviceWith(new Recorder()).prepareSplit(ITEM);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prepared.run.length, 0);
  });
});
