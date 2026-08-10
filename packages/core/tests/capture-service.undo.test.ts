import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CaptureService } from "../src/capture/capture-service";
import { FakeInboxStore, FakeTranscriptionPort, FixedClock } from "./fakes";

function build() {
  const inbox = new FakeInboxStore();
  const service = new CaptureService({
    inbox,
    transcription: new FakeTranscriptionPort(),
    clock: new FixedClock(),
  });
  return { inbox, service };
}

describe("CaptureService.undo", () => {
  test("removes a just-dictated capture from the inbox", async () => {
    const { inbox, service } = build();
    const { id } = await service.submit("a spoken thought", "dictated");
    await service.flush();

    assert.deepEqual(await service.undo(id), { ok: true });
    assert.equal(inbox.content, "");
  });

  test("leaves earlier items untouched", async () => {
    const { inbox, service } = build();
    await service.submit("first", "dictated");
    const second = await service.submit("second", "dictated");
    await service.flush();

    await service.undo(second.id);

    assert.match(inbox.content, /first\n$/);
    assert.ok(!inbox.content.includes("second"));
  });

  test("refuses with file-changed when the inbox changed underneath", async () => {
    const { inbox, service } = build();
    const { id } = await service.submit("a spoken thought", "dictated");
    await service.flush();

    inbox.content += "- something the user added by hand\n";

    // Failure is a value, not a throw: refusing is an expected outcome.
    assert.deepEqual(await service.undo(id), { ok: false, reason: "file-changed" });
  });

  test("preserves the hand-added content when it refuses", async () => {
    const { inbox, service } = build();
    const { id } = await service.submit("a spoken thought", "dictated");
    await service.flush();
    inbox.content += "- added by hand\n";
    const before = inbox.content;

    await service.undo(id);

    assert.equal(inbox.content, before);
  });

  test("reports expired once the next capture begins", async () => {
    const { service } = build();
    const first = await service.submit("first", "dictated");
    await service.submit("second", "dictated");
    await service.flush();

    assert.deepEqual(await service.undo(first.id), { ok: false, reason: "unknown-id" });
  });

  test("reports expired after the window is closed", async () => {
    const { service } = build();
    const { id } = await service.submit("a thought", "dictated");
    await service.flush();

    service.expireUndoWindow();

    assert.deepEqual(await service.undo(id), { ok: false, reason: "expired" });
  });

  test("reports unknown-id for an id it never issued", async () => {
    const { service } = build();
    await service.submit("a thought", "dictated");
    await service.flush();

    assert.deepEqual(await service.undo("no-such-id"), { ok: false, reason: "unknown-id" });
  });

  test("offers no undo for a typed capture", async () => {
    const { service } = build();
    const { id } = await service.submit("typed thought", "typed");
    await service.flush();

    // FR-009 scopes undo to dictated captures; FR-018 bounds it there.
    assert.equal(service.undoableId(), undefined);
    assert.deepEqual(await service.undo(id), { ok: false, reason: "expired" });
  });

  test("a typed capture still closes the previous undo window", async () => {
    const { service } = build();
    const dictated = await service.submit("spoken", "dictated");
    await service.submit("typed", "typed");
    await service.flush();

    assert.deepEqual(await service.undo(dictated.id), { ok: false, reason: "expired" });
  });

  test("waits for the pending write before verifying", async () => {
    const { inbox, service } = build();
    inbox.block();
    const { id } = await service.submit("a spoken thought", "dictated");

    const pending = service.undo(id);
    inbox.release();

    // Undo must not race the append it is undoing.
    assert.deepEqual(await pending, { ok: true });
    assert.equal(inbox.content, "");
  });

  test("cannot be undone twice", async () => {
    const { service } = build();
    const { id } = await service.submit("a thought", "dictated");
    await service.flush();

    assert.deepEqual(await service.undo(id), { ok: true });
    assert.deepEqual(await service.undo(id), { ok: false, reason: "expired" });
  });
});
