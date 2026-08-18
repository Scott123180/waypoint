import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { RecordingTransport } from "./suggest-fakes";

/**
 * One factory, one default module, configured with a transport (research R2,
 * mirroring `createDefaultPolicy()`).
 *
 * What it *cannot* be handed is the point. A module that took a vault could
 * read `identity.md`; one that took a catalog could decide what to send; one
 * that took a policy could consult a rule from a place no decision point
 * exists. It takes a transport, and a transport carries bytes.
 */

describe("createDefaultIntelligence", () => {
  test("returns one object satisfying both provider interfaces", () => {
    const module = createDefaultIntelligence(new RecordingTransport());

    assert.equal(typeof module.prepareSplit, "function");
    assert.equal(typeof module.prepareDestination, "function");
  });

  test("carries a name, for attribution before it runs", () => {
    const module = createDefaultIntelligence(new RecordingTransport({}, "a-named-transport"));
    assert.equal(typeof module.name, "string");
    assert.ok(module.name.length > 0);
  });

  test("accepts a transport and nothing else", () => {
    // Arity is the structural claim: a second parameter is where a vault, a
    // catalog, a policy, or a clock would arrive, and each of those would be a
    // capability this module must not have (FR-035, research R11).
    assert.equal(createDefaultIntelligence.length, 1);
  });

  test("exposes exactly the two provider verbs and a name", () => {
    const module = createDefaultIntelligence(new RecordingTransport());
    assert.deepEqual(Object.keys(module).sort(), ["name", "prepareDestination", "prepareSplit"]);
  });

  test("preparing renders the payload and sends nothing", () => {
    const transport = new RecordingTransport();
    const module = createDefaultIntelligence(transport);

    const prepared = module.prepareSplit({ text: "one thought", segments: [{ index: 0, text: "one thought" }] });

    assert.equal(typeof prepared.payload, "string");
    assert.ok(prepared.payload.length > 0);
    assert.equal(transport.calls, 0, "preparing must not contact the transport");
  });

  test("send takes only a signal, so the content is already fixed", () => {
    const module = createDefaultIntelligence(new RecordingTransport());
    const prepared = module.prepareSplit({ text: "x", segments: [{ index: 0, text: "x" }] });
    assert.equal(prepared.send.length, 1);
  });
});

describe("before its response path exists", () => {
  /**
   * The skeleton sends, and then refuses to invent a proposal from a response
   * it cannot yet read. Throwing is the right Red: a module that returned an
   * empty proposal here would be indistinguishable from one that worked and
   * found nothing, and that is the failure this feature can least afford.
   */
  test("a split throws rather than returning a proposal", async () => {
    const module = createDefaultIntelligence(new RecordingTransport({ reply: "{}" }));
    const prepared = module.prepareSplit({ text: "x", segments: [{ index: 0, text: "x" }] });

    await assert.rejects(() => prepared.send(new AbortController().signal));
  });

  test("a destination throws rather than returning a proposal", async () => {
    const module = createDefaultIntelligence(new RecordingTransport({ reply: "{}" }));
    const prepared = module.prepareDestination({ item: "x", projects: [], areas: [] });

    await assert.rejects(() => prepared.send(new AbortController().signal));
  });
});
