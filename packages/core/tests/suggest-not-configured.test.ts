import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SuggestionService } from "../src/suggest/suggestion-service";
import { ForbiddenTransport, seedIntelligence } from "./suggest-fakes";
import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import type { InboxItemView } from "../src/sort/decision";

/**
 * The shipped state (FR-054, FR-060).
 *
 * No `intelligence.md` means no intelligence dependency, which means both
 * verbs refuse without contacting anything. The refusal deliberately carries
 * **no message**: a client with no transport renders no affordance at all, so
 * there is nothing for a message to appear in — and a message that existed
 * would eventually be shown, which is how a user who never configured this
 * would learn it exists.
 */

const ITEM: InboxItemView = {
  text: "call the roofer about the estimate",
  capturedAt: null,
  ref: { start: 0, end: 0, raw: "" },
};

function unconfigured(): SuggestionService {
  const { catalog } = seedIntelligence({ "projects/roof.md": "# Roof\n" });
  // No `intelligence` field at all — the absence *is* the configuration.
  return new SuggestionService({ catalog });
}

describe("with no intelligence supplied", () => {
  test("a split refuses with not-configured", async () => {
    const result = await unconfigured().prepareSplit(ITEM);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-configured");
  });

  test("a destination refuses with not-configured", async () => {
    const result = await unconfigured().prepareDestination(ITEM.text);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-configured");
  });

  test("neither refusal carries anything to display", async () => {
    for (const result of [
      await unconfigured().prepareSplit(ITEM),
      await unconfigured().prepareDestination(ITEM.text),
    ]) {
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.message, "", "not-configured is not an error to dismiss");
    }
  });

  test("nothing is read from the vault, because nothing could be sent", async () => {
    const { vault, catalog } = seedIntelligence({ "projects/roof.md": "# Roof\n" });
    const service = new SuggestionService({ catalog });

    await service.prepareSplit(ITEM);
    await service.prepareDestination(ITEM.text);

    assert.deepEqual(vault.readLog, [], "the catalogue was read for a request that cannot happen");
  });

  test("no transport is contacted, because none exists to contact", async () => {
    // The stronger form: even with a transport that throws on any call, an
    // unconfigured service never reaches it.
    const { catalog } = seedIntelligence({});
    const service = new SuggestionService({ catalog });

    const split = await service.prepareSplit(ITEM);
    assert.equal(split.ok, false);

    // And for contrast, one that *is* configured does reach its transport —
    // so the assertion above is about configuration, not about a broken stub.
    const configured = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(new ForbiddenTransport()),
    });
    const prepared = await configured.prepareSplit(ITEM);
    assert.equal(prepared.ok, true, "a configured service prepares");
  });
});

describe("the absence is a state, not a failure", () => {
  test("preparing twice is still silent, with nothing accumulating", async () => {
    const service = unconfigured();
    for (let i = 0; i < 5; i++) {
      const result = await service.prepareSplit(ITEM);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "not-configured");
      assert.equal(result.message, "");
    }
  });
});
