import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TranscriptionFailedError } from "@waypoint/core";
import { WhisperAdapter } from "../src/main/adapters/whisper-adapter";

const FAKE_CLI = resolve(__dirname, "fixtures/fake-whisper-cli.sh");

let dir: string;
let modelPath: string;

function wav(bytes = 64): Uint8Array {
  const buf = Buffer.alloc(bytes);
  buf.write("RIFF", 0, "ascii");
  buf.write("WAVE", 8, "ascii");
  return new Uint8Array(buf);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-whisper-"));
  modelPath = join(dir, "model.bin");
  writeFileSync(modelPath, "not a real model");
  chmodSync(FAKE_CLI, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function adapter(env: Record<string, string> = {}, overrides: { binaryPath?: string } = {}) {
  return new WhisperAdapter({
    binaryPath: overrides.binaryPath ?? FAKE_CLI,
    modelPath,
    timeoutMs: 5000,
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
}

describe("WhisperAdapter", () => {
  test("returns the transcript printed on stdout", async () => {
    const result = await adapter({ FAKE_WHISPER_OUTPUT: "call the roofer back" }).transcribe(wav());
    assert.equal(result, "call the roofer back");
  });

  test("trims surrounding whitespace from the transcript", async () => {
    const result = await adapter({ FAKE_WHISPER_OUTPUT: "  a thought \n" }).transcribe(wav());
    assert.equal(result, "a thought");
  });

  test("pipes the WAV bytes to the child on stdin", async () => {
    const stdinOut = join(dir, "stdin.bin");
    const payload = wav(128);

    await adapter({ FAKE_WHISPER_OUTPUT: "x", FAKE_WHISPER_STDIN_OUT: stdinOut }).transcribe(payload);

    // Audio reaches whisper through the pipe and is never written to disk by us.
    assert.deepEqual(new Uint8Array(readFileSync(stdinOut)), payload);
  });

  test("builds argv with the model and stdin input flag", async () => {
    const argvOut = join(dir, "argv.txt");
    await adapter({ FAKE_WHISPER_OUTPUT: "x", FAKE_WHISPER_ARGV_OUT: argvOut }).transcribe(wav());

    const argv = readFileSync(argvOut, "utf8").trim().split("\n");
    assert.ok(argv.includes("-m"), "model flag missing");
    assert.ok(argv.includes(modelPath), "model path missing");
    assert.ok(argv.includes("-f"), "input flag missing");
    assert.ok(argv.includes("-"), "stdin input marker missing");
    assert.ok(argv.includes("--no-timestamps"), "timestamps should be suppressed");
  });

  test("empty stdout returns an empty string rather than an error", async () => {
    // "nothing intelligible" is a valid outcome; the core maps it to no-speech.
    const result = await adapter({ FAKE_WHISPER_OUTPUT: "" }).transcribe(wav());
    assert.equal(result, "");
  });

  test("stderr output alone is not treated as failure", async () => {
    // The real binary logs progress to stderr on success.
    const result = await adapter({ FAKE_WHISPER_OUTPUT: "fine" }).transcribe(wav());
    assert.equal(result, "fine");
  });

  test("a non-zero exit raises TranscriptionFailedError", async () => {
    await assert.rejects(
      () => adapter({ FAKE_WHISPER_OUTPUT: "", FAKE_WHISPER_EXIT: "3" }).transcribe(wav()),
      TranscriptionFailedError,
    );
  });

  test("a missing binary fails without taking text capture down", async () => {
    await assert.rejects(
      () => adapter({}, { binaryPath: join(dir, "does-not-exist") }).transcribe(wav()),
      TranscriptionFailedError,
    );
  });

  test("a missing model is reported with the expected path", async () => {
    rmSync(modelPath);
    await assert.rejects(
      () => adapter({ FAKE_WHISPER_OUTPUT: "x" }).transcribe(wav()),
      (err: unknown) => {
        assert.ok(err instanceof TranscriptionFailedError);
        assert.match(err.message, /model/i);
        return true;
      },
    );
  });

  test("a hung child is killed at the timeout", async () => {
    const slow = new WhisperAdapter({
      binaryPath: FAKE_CLI,
      modelPath,
      timeoutMs: 300,
      env: { ...process.env, FAKE_WHISPER_HANG: "1" } as NodeJS.ProcessEnv,
    });

    // A wedged subprocess would otherwise pin a core indefinitely.
    await assert.rejects(() => slow.transcribe(wav()), TranscriptionFailedError);
  });

  test("cancel kills the in-flight child", async () => {
    const slow = new WhisperAdapter({
      binaryPath: FAKE_CLI,
      modelPath,
      timeoutMs: 10_000,
      env: { ...process.env, FAKE_WHISPER_HANG: "1" } as NodeJS.ProcessEnv,
    });

    const pending = slow.transcribe(wav());
    await new Promise((r) => setTimeout(r, 100));
    slow.cancel();

    await assert.rejects(() => pending, TranscriptionFailedError);
  });
});
