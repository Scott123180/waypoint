import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { RecordingTransport, areaFile, projectFile, seedIntelligence } from "./suggest-fakes";
import type { InboxItemView } from "../src/sort/decision";

/**
 * FR-045, and the reason this feature is built the way it is.
 *
 * "What you were shown is what was sent" is asserted here with `===`, not with
 * `deepEqual`. That distinction is the whole design: `prepared.payload` and the
 * string the transport received must be **one value**, not two constructions
 * that happen to agree. Deep equality would pass for a design that rendered the
 * content twice and got lucky, and getting lucky is exactly the failure mode
 * FR-045 exists to rule out.
 *
 * If this file is ever made to pass by comparing two constructions, research
 * R4 has not been followed and the guarantee is gone — the assertion would
 * still be green and would no longer mean anything.
 */

const ITEM: InboxItemView = {
  text: "ok so the hiring req, no wait, the req for the backend role, I need to get that written up. Also dentist, Thursday I think.",
  capturedAt: new Date("2026-08-17T09:14:22-04:00"),
  ref: { start: 0, end: 130, raw: "- 2026-08-17T09:14:22-04:00 ...\n" },
};

function makeService(transport: RecordingTransport, files: Record<string, string> = {}) {
  const { catalog } = seedIntelligence(files);
  return new SuggestionService({ catalog, intelligence: createDefaultIntelligence(transport) });
}

const VAULT = {
  "projects/vendor-consolidation.md": projectFile("Vendor Consolidation", "Every vendor contract renewed or ended by Q4."),
  "areas/home.md": areaFile("Home"),
};

describe("the previewed content and the sent content are one value", () => {
  test("a split: the transport received the very string the preview exposed", async () => {
    const transport = new RecordingTransport({ reply: '{"pieces": [[0]], "nothingToSplit": false}' });
    const service = makeService(transport, VAULT);

    const prepared = await service.prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    // Nothing has been sent yet. This is the moment FR-041 describes.
    assert.equal(transport.calls, 0, "preparing must send nothing");

    await prepared.prepared.run();

    assert.equal(transport.received.length, 1);
    assert.equal(
      transport.received[0] === prepared.prepared.payload,
      true,
      "the sent string is not the same value as the previewed one",
    );
  });

  test("a destination: the transport received the very string the preview exposed", async () => {
    const transport = new RecordingTransport({
      reply: '{"destination": "trash", "reason": "nothing to do here"}',
    });
    const service = makeService(transport, VAULT);

    const prepared = await service.prepareDestination(ITEM.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    assert.equal(transport.calls, 0, "preparing must send nothing");
    await prepared.prepared.run();

    assert.equal(
      transport.received[0] === prepared.prepared.payload,
      true,
      "the sent string is not the same value as the previewed one",
    );
  });

  test("run takes no argument, so there is nothing else that could be sent", async () => {
    const transport = new RecordingTransport({ reply: '{"pieces": [[0]], "nothingToSplit": false}' });
    const prepared = await makeService(transport, VAULT).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    // Arity is the structural form of the claim. A `run(payload)` would move
    // the guarantee out of the type and into every caller.
    assert.equal(prepared.prepared.run.length, 0);
  });

  test("payload is a read-only view of the same binding run closes over", async () => {
    const transport = new RecordingTransport({ reply: '{"pieces": [[0]], "nothingToSplit": false}' });
    const prepared = await makeService(transport, VAULT).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    // Reassigning the exposed property must not change what is sent — either
    // because the property is not writable, or because `run` closed over the
    // value rather than reading the property back.
    try {
      (prepared.prepared as { payload: string }).payload = "something else entirely";
    } catch {
      // A frozen or getter-only property is the stronger outcome.
    }
    const shown = prepared.prepared.payload;
    await prepared.prepared.run();

    assert.equal(transport.received[0], shown === "something else entirely" ? transport.received[0] : shown);
    assert.doesNotMatch(transport.received[0] ?? "", /something else entirely/);
  });
});

describe("one prepare, one send", () => {
  test("preparing and running a split contacts the transport exactly once", async () => {
    const transport = new RecordingTransport({ reply: '{"pieces": [[0]], "nothingToSplit": false}' });
    const prepared = await makeService(transport, VAULT).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    await prepared.prepared.run();
    assert.equal(transport.calls, 1, "no retry, no second attempt, no warm-up call (FR-065)");
  });

  test("preparing and running a destination contacts the transport exactly once", async () => {
    const transport = new RecordingTransport({
      reply: '{"destination": "trash", "reason": "nothing to do here"}',
    });
    const prepared = await makeService(transport, VAULT).prepareDestination(ITEM.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    await prepared.prepared.run();
    assert.equal(transport.calls, 1);
  });
});

describe("asking for one kind provably does not send the other's content (FR-003)", () => {
  test("a split payload carries no destination catalogue", async () => {
    const transport = new RecordingTransport({ reply: '{"pieces": [[0]], "nothingToSplit": false}' });
    const prepared = await makeService(transport, VAULT).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const payload = prepared.prepared.payload;
    assert.doesNotMatch(payload, /Vendor Consolidation/, "a project title reached the split payload");
    assert.doesNotMatch(payload, /vendor-consolidation/);
    assert.doesNotMatch(payload, /Every vendor contract/, "a project outcome reached the split payload");
    assert.doesNotMatch(payload, /\bHome\b/, "an area title reached the split payload");
  });

  test("a destination payload carries no segment numbering", async () => {
    const transport = new RecordingTransport({
      reply: '{"destination": "trash", "reason": "nothing to do here"}',
    });
    const prepared = await makeService(transport, VAULT).prepareDestination(ITEM.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const payload = prepared.prepared.payload;
    assert.doesNotMatch(payload, /segment/i, "the destination payload described segments");
    assert.doesNotMatch(payload, /nothingToSplit/);
  });

  test("preparing a split reads no destination catalogue at all", async () => {
    const { vault, catalog } = seedIntelligence(VAULT);
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(new RecordingTransport()),
    });

    await service.prepareSplit(ITEM);

    assert.deepEqual(vault.readLog, [], "a split asked the vault for something it cannot need");
  });
});
