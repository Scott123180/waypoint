import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createCaptureItem } from "../src/capture/capture-item";
import { EmptyCaptureError } from "../src/errors";
import { FixedClock } from "./fakes";

describe("createCaptureItem", () => {
  test("trims surrounding whitespace", () => {
    const item = createCaptureItem("   call the roofer  ", "typed", new FixedClock());
    assert.equal(item.text, "call the roofer");
  });

  test("preserves the text verbatim otherwise", () => {
    // Capture is raw: no capitalization, punctuation, or reflow fixes.
    const raw = "call   the roofer about the estimate and ask re: gutters";
    const item = createCaptureItem(raw, "typed", new FixedClock());
    assert.equal(item.text, raw);
  });

  test("preserves internal newlines", () => {
    const raw = "first line\nsecond line";
    const item = createCaptureItem(raw, "dictated", new FixedClock());
    assert.equal(item.text, raw);
  });

  test("rejects empty text", () => {
    assert.throws(() => createCaptureItem("", "typed", new FixedClock()), EmptyCaptureError);
  });

  test("rejects whitespace-only text", () => {
    assert.throws(() => createCaptureItem("   \t\n  ", "typed", new FixedClock()), EmptyCaptureError);
  });

  test("takes capturedAt from the clock, not the caller", () => {
    const clock = new FixedClock(new Date("2026-08-09T18:23:05.000Z"));
    const item = createCaptureItem("a thought", "typed", clock);
    assert.equal(item.capturedAt.toISOString(), "2026-08-09T18:23:05.000Z");
  });

  test("assigns a unique id per item", () => {
    const clock = new FixedClock();
    const a = createCaptureItem("one", "typed", clock);
    const b = createCaptureItem("two", "typed", clock);
    assert.notEqual(a.id, b.id);
    assert.match(a.id, /^[0-9a-f-]{36}$/);
  });

  test("records the source", () => {
    const clock = new FixedClock();
    assert.equal(createCaptureItem("x", "typed", clock).source, "typed");
    assert.equal(createCaptureItem("x", "dictated", clock).source, "dictated");
  });

  test("carries no organizing metadata", () => {
    // Capture never asks the user to categorize, so the entity has nowhere to
    // put a tag or project even if a client tried.
    const item = createCaptureItem("a thought", "typed", new FixedClock());
    assert.deepEqual(Object.keys(item).sort(), ["capturedAt", "id", "source", "text"]);
  });

  test("accepts long text without truncating", () => {
    const long = "word ".repeat(2000).trim();
    const item = createCaptureItem(long, "dictated", new FixedClock());
    assert.equal(item.text, long);
  });
});
