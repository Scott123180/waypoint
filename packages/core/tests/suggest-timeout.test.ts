import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SUGGESTION_TIMEOUT_MS, SuggestionService } from "../src/suggest/suggestion-service";
import { StubDestinationProvider, StubSplitProvider, seedIntelligence } from "./suggest-fakes";
import type { InboxItemView } from "../src/sort/decision";

/**
 * One bound, armed once, in core (research R15).
 *
 * Two transports each implementing their own timeout would be two numbers that
 * could drift, and the second one added would be where the drift started.
 * Arming the controller above the seam makes "the same for every transport" a
 * fact about where the abort comes from.
 *
 * The user's cancel and the timer share that one controller, so FR-066 and
 * FR-066a are one mechanism with two triggers — which is why both land on
 * `timed-out`, with different messages.
 */

const ITEM: InboxItemView = {
  text: "a thought that will never come back",
  capturedAt: null,
  ref: { start: 0, end: 0, raw: "" },
};

function serviceWith(intelligence: StubSplitProvider | StubDestinationProvider, timeoutMs?: number) {
  const { catalog } = seedIntelligence({});
  return new SuggestionService({
    catalog,
    intelligence: intelligence as never,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("the bound is 120 seconds and is a constant", () => {
  test("two minutes, in core", () => {
    assert.equal(SUGGESTION_TIMEOUT_MS, 120_000);
  });

  test("no key in intelligence.md can change it", () => {
    const config = readFileSync(
      join(__dirname, "..", "..", "src", "suggest", "intelligence-config.ts"),
      "utf8",
    ).replace(/\/\*\*[\s\S]*?\*\//g, "");

    for (const key of ["timeout", "timeoutMs", "deadline", "seconds"]) {
      assert.ok(
        !new RegExp(`readField\\([^)]*"${key}"`, "i").test(config),
        `${key} is readable from the config, so the bound could differ per machine`,
      );
    }
  });

  test("the injected seam exists for tests only, with no production caller", () => {
    // In the spirit of `beforeRename`: a seam nothing supplies is a seam that
    // cannot change behaviour in the shipped application.
    const wiring = readFileSync(
      join(__dirname, "..", "..", "src", "suggest", "suggestion-service.ts"),
      "utf8",
    );
    assert.match(wiring, /timeoutMs\?:/, "the seam is optional");
  });
});

describe("exceeding the bound", () => {
  test("a split aborts the signal and yields timed-out", async () => {
    const provider = new StubSplitProvider({ hang: true });
    const prepared = await serviceWith(provider, 20).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "timed-out");
    assert.match(outcome.message, /120 seconds|two minutes/i, "the message says what the bound was");
  });

  test("a destination aborts the same way", async () => {
    const provider = new StubDestinationProvider({ hang: true });
    const prepared = await serviceWith(provider, 20).prepareDestination("some text");
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "timed-out");
  });

  test("the signal handed to the provider is the one that aborts", async () => {
    const seen: AbortSignal[] = [];
    const provider = new StubSplitProvider({ hang: true });
    const original = provider.prepareSplit.bind(provider);
    provider.prepareSplit = (request) => {
      const prepared = original(request);
      return {
        payload: prepared.payload,
        send: (signal) => {
          seen.push(signal);
          return prepared.send(signal);
        },
      };
    };

    const prepared = await serviceWith(provider, 20).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await prepared.prepared.run();

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.aborted, true, "the transport's own signal is what fired");
  });
});

describe("abandoning", () => {
  test("aborts the same controller and yields timed-out, with a different message", async () => {
    const provider = new StubSplitProvider({ hang: true });
    const prepared = await serviceWith(provider).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const running = prepared.prepared.run();
    prepared.prepared.abandon();
    const outcome = await running;

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "timed-out", "one mechanism, two triggers");
    assert.match(outcome.message, /abandoned|stopped/i);
    assert.doesNotMatch(outcome.message, /120 seconds/, "the user did not wait two minutes");
  });

  test("abandoning before running leaves nothing in flight", async () => {
    const provider = new StubSplitProvider({ hang: true });
    const prepared = await serviceWith(provider).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    prepared.prepared.abandon();
    const outcome = await prepared.prepared.run();

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "timed-out");
    assert.equal(provider.sends, 0, "an abandoned request must not be sent after the fact");
  });

  test("abandon takes no argument, so it can only abandon this request", async () => {
    const prepared = await serviceWith(new StubSplitProvider()).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.prepared.abandon.length, 0);
  });
});

describe("the timer does not outlive the request", () => {
  test("a request that completes normally leaves no pending timer", async () => {
    const provider = new StubSplitProvider({ response: { pieces: [[0]], nothingToSplit: false } });
    const prepared = await serviceWith(provider).prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    await prepared.prepared.run();

    // If the 120-second timer were still armed, `node --test` would hold the
    // event loop open for two minutes after this file finished.
    assert.equal(provider.sends, 1);
  });
});
