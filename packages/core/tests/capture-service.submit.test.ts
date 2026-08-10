import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CaptureService } from "../src/capture/capture-service";
import { EmptyCaptureError } from "../src/errors";
import { FakeInboxStore, FakeTranscriptionPort, FixedClock, tick } from "./fakes";

function build() {
  const inbox = new FakeInboxStore();
  const transcription = new FakeTranscriptionPort();
  const clock = new FixedClock(new Date("2026-08-09T18:23:05.000Z"));
  const service = new CaptureService({ inbox, transcription, clock });
  return { inbox, transcription, clock, service };
}

describe("CaptureService.submit", () => {
  test("returns an id and the capture time", async () => {
    const { service } = build();
    const result = await service.submit("call the roofer", "typed");

    assert.match(result.id, /^[0-9a-f-]{36}$/);
    assert.equal(result.capturedAt.toISOString(), "2026-08-09T18:23:05.000Z");
  });

  test("returns without waiting for the write to reach the store", async () => {
    const { inbox, service } = build();
    inbox.block();

    const result = await service.submit("a thought", "typed");

    // Submit has resolved while the write is still held open. If this ever
    // regresses, the capture box starts waiting on disk (Principle VI).
    assert.ok(result.id);
    assert.equal(inbox.written.length, 0);

    inbox.release();
    await service.flush();
    assert.equal(inbox.written.length, 1);
  });

  test("appends the serialized item to the inbox", async () => {
    const { inbox, service } = build();
    await service.submit("call the roofer", "typed");
    await service.flush();

    assert.equal(inbox.content, "- 2026-08-09T14:23:05-04:00 call the roofer\n");
  });

  test("rejects empty text", async () => {
    const { service } = build();
    await assert.rejects(() => service.submit("", "typed"), EmptyCaptureError);
  });

  test("rejects whitespace-only text", async () => {
    const { service } = build();
    await assert.rejects(() => service.submit("   \n\t ", "typed"), EmptyCaptureError);
  });

  test("enqueues nothing when the text was empty", async () => {
    const { inbox, service } = build();
    await assert.rejects(() => service.submit("  ", "typed"));
    await tick();

    assert.equal(inbox.written.length, 0);
    assert.equal(inbox.content, "");
  });

  test("preserves submit order in the inbox", async () => {
    const { inbox, service } = build();
    await service.submit("first", "typed");
    await service.submit("second", "typed");
    await service.submit("third", "typed");
    await service.flush();

    const lines = inbox.content.trim().split("\n");
    assert.ok(lines[0]?.endsWith("first"));
    assert.ok(lines[1]?.endsWith("second"));
    assert.ok(lines[2]?.endsWith("third"));
  });

  test("flush drains queued writes", async () => {
    const { inbox, service } = build();
    inbox.block();
    void service.submit("a thought", "typed");
    inbox.release();

    await service.flush();
    assert.equal(inbox.written.length, 1);
  });

  test("keeps only one undo window live at a time", async () => {
    const { service } = build();
    const first = await service.submit("first", "dictated");
    const second = await service.submit("second", "dictated");
    await service.flush();

    // The older window has expired; only the most recent capture is undoable.
    assert.equal(service.undoableId(), second.id);
    assert.notEqual(service.undoableId(), first.id);
  });

  test("timestamps come from the clock, so a client cannot forge one", async () => {
    const { clock, service } = build();
    clock.set(new Date("2027-03-01T12:00:00.000Z"));
    const result = await service.submit("later thought", "typed");

    assert.equal(result.capturedAt.toISOString(), "2027-03-01T12:00:00.000Z");
  });
});
