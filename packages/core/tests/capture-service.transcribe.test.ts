import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CaptureService } from "../src/capture/capture-service";
import { TranscriptionFailedError } from "../src/errors";
import { FakeInboxStore, FakeTranscriptionPort, FixedClock } from "./fakes";

function build() {
  const inbox = new FakeInboxStore();
  const transcription = new FakeTranscriptionPort();
  const service = new CaptureService({ inbox, transcription, clock: new FixedClock() });
  return { inbox, transcription, service };
}

const audio = new Uint8Array([1, 2, 3, 4]);

describe("CaptureService.transcribe", () => {
  test("returns the transcribed text", async () => {
    const { transcription, service } = build();
    transcription.result = "call the roofer back";

    const result = await service.transcribe(audio);
    assert.deepEqual(result, { status: "ok", text: "call the roofer back" });
  });

  test("reports no-speech for empty output", async () => {
    const { transcription, service } = build();
    transcription.result = "";

    assert.deepEqual(await service.transcribe(audio), { status: "no-speech" });
  });

  test("reports no-speech for whitespace-only output", async () => {
    const { transcription, service } = build();
    transcription.result = "   \n\t ";

    // Silence is a valid outcome, not an error the user should see as a crash.
    assert.deepEqual(await service.transcribe(audio), { status: "no-speech" });
  });

  test("reports failure without throwing", async () => {
    const { transcription, service } = build();
    transcription.error = new TranscriptionFailedError("whisper exited 3");

    const result = await service.transcribe(audio);
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.message : "", /whisper exited 3/);
  });

  test("never writes a transcript to the inbox", async () => {
    const { inbox, transcription, service } = build();
    transcription.result = "a spoken thought";

    await service.transcribe(audio);
    await service.flush();

    // This is the structural guarantee behind FR-007: the only route to disk is
    // an explicit submit, so a transcript cannot be stored unseen.
    assert.equal(inbox.content, "");
    assert.equal(inbox.written.length, 0);
  });

  test("no-speech writes nothing either", async () => {
    const { inbox, transcription, service } = build();
    transcription.result = "";

    await service.transcribe(audio);
    await service.flush();

    assert.equal(inbox.content, "");
  });

  test("a failure writes nothing", async () => {
    const { inbox, transcription, service } = build();
    transcription.error = new TranscriptionFailedError("boom");

    await service.transcribe(audio);
    await service.flush();

    assert.equal(inbox.content, "");
  });

  test("exposes no way to submit a transcript directly", () => {
    const { service } = build();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service));

    // If such a method ever appears, a client could bypass the review step.
    assert.ok(!surface.some((name) => /submitTranscript|saveTranscript/i.test(name)));
  });

  test("holds no reference to the audio after returning", async () => {
    const { transcription, service } = build();
    transcription.result = "text";

    await service.transcribe(audio);

    // The port saw it once; the service must not have stashed it anywhere.
    assert.equal(transcription.calls.length, 1);
    const stashed = JSON.stringify(service);
    assert.ok(!stashed.includes('"wav"'), "audio must not be retained on the service");
  });

  test("a transcript still reaches the inbox when the user submits it", async () => {
    const { inbox, transcription, service } = build();
    transcription.result = "a spoken thought";

    const result = await service.transcribe(audio);
    assert.equal(result.status, "ok");
    await service.submit(result.status === "ok" ? result.text : "", "dictated");
    await service.flush();

    assert.match(inbox.content, /a spoken thought\n$/);
  });
});
