import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { WhisperAdapter } from "../src/main/adapters/whisper-adapter";
import {
  whisperBinaryName,
  whisperResourcesDir,
  WHISPER_MODEL_FILENAME,
} from "../src/main/resources";

/**
 * Exercises the REAL whisper.cpp binary and model.
 *
 * Opt-in on purpose: the model is ~500MB and the binary needs cmake to build,
 * so requiring this in the default suite would make the test loop unusable.
 * Everything about the subprocess wiring — argv, stdin piping, exit codes,
 * timeouts — is already covered against a fake binary in whisper-adapter.test.ts.
 * What this adds is proof that the contract holds against the actual program.
 *
 *   ./scripts/fetch-whisper.sh && npm run test:whisper
 */

// Resolved through the same helper the app uses, so this cannot drift from
// where the binary and model actually live.
const RESOURCES = whisperResourcesDir({
  isPackaged: false,
  resourcesPath: "",
  mainDir: resolve(__dirname, "..", "src", "main"),
});
const BINARY = join(RESOURCES, whisperBinaryName(process.platform));
const MODEL = join(RESOURCES, WHISPER_MODEL_FILENAME);
const FIXTURE = resolve(__dirname, "fixtures", "sample-16k-mono.wav");

const enabled = process.env["WAYPOINT_WHISPER_INTEGRATION"] === "1";
const hasBinary = existsSync(BINARY);
const hasModel = existsSync(MODEL);
const available = hasBinary && hasModel;

// Name the missing piece: they are fetched independently, and needing cmake for
// the binary is a very different fix from needing a 500MB download.
function missingReason(): string {
  if (!hasBinary && !hasModel) {
    return `no binary or model in ${RESOURCES}; run ./scripts/fetch-whisper.sh`;
  }
  if (!hasBinary) {
    return `model present but whisper-cli missing in ${RESOURCES}; ` +
      `needs cmake, then ./scripts/fetch-whisper.sh --binary-only`;
  }
  return `binary present but model missing in ${RESOURCES}; ` +
    `run ./scripts/fetch-whisper.sh --model-only`;
}

const why = !enabled ? "set WAYPOINT_WHISPER_INTEGRATION=1 to run" : missingReason();

describe("whisper.cpp integration (opt-in)", { skip: !enabled || !available ? why : false }, () => {
  function adapter(): WhisperAdapter {
    return new WhisperAdapter({ binaryPath: BINARY, modelPath: MODEL, timeoutMs: 180_000 });
  }

  test("transcribes a real WAV piped on stdin without writing it to disk", async () => {
    const wav = new Uint8Array(readFileSync(FIXTURE));
    const before = Date.now();

    const text = await adapter().transcribe(wav);

    // The fixture is a tone, not speech, so the transcript may legitimately be
    // empty. What matters is that the binary accepted stdin, ran offline, and
    // exited cleanly — the `-f -` path this whole design depends on.
    assert.equal(typeof text, "string");
    assert.ok(Date.now() - before < 180_000);
  });

  test("reports a missing model rather than hanging", async () => {
    const broken = new WhisperAdapter({
      binaryPath: BINARY,
      modelPath: join(RESOURCES, "does-not-exist.bin"),
      timeoutMs: 30_000,
    });

    await assert.rejects(() => broken.transcribe(new Uint8Array(readFileSync(FIXTURE))));
  });

  test("leaves no temporary audio file behind", async () => {
    const { readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const wavsBefore = readdirSync(tmpdir()).filter((f) => f.endsWith(".wav")).length;
    await adapter().transcribe(new Uint8Array(readFileSync(FIXTURE)));
    const wavsAfter = readdirSync(tmpdir()).filter((f) => f.endsWith(".wav")).length;

    // FR-006a: audio is processed in memory and never written to disk.
    assert.equal(wavsAfter, wavsBefore);
  });
});
