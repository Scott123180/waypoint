import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { downsampleToMono16k, encodeWav, WHISPER_SAMPLE_RATE } from "../src/main/audio-encode";

function readAscii(buf: Uint8Array, offset: number, length: number): string {
  return Buffer.from(buf.subarray(offset, offset + length)).toString("ascii");
}

function readU32(buf: Uint8Array, offset: number): number {
  return Buffer.from(buf).readUInt32LE(offset);
}

function readU16(buf: Uint8Array, offset: number): number {
  return Buffer.from(buf).readUInt16LE(offset);
}

describe("downsampleToMono16k", () => {
  test("passes 16kHz input through unchanged in length", () => {
    const input = new Float32Array(1600).fill(0.5);
    const out = downsampleToMono16k(input, WHISPER_SAMPLE_RATE);
    assert.equal(out.length, 1600);
  });

  test("halves the sample count when downsampling 32kHz", () => {
    const input = new Float32Array(3200).fill(0.25);
    const out = downsampleToMono16k(input, 32_000);
    assert.equal(out.length, 1600);
  });

  test("downsamples the common 48kHz capture rate by three", () => {
    const input = new Float32Array(4800).fill(0.1);
    const out = downsampleToMono16k(input, 48_000);
    assert.equal(out.length, 1600);
  });

  test("preserves signal amplitude", () => {
    const input = new Float32Array(4800).fill(0.75);
    const out = downsampleToMono16k(input, 48_000);
    for (const sample of out) {
      assert.ok(Math.abs(sample - 0.75) < 0.01, `expected ~0.75, got ${sample}`);
    }
  });

  test("returns an empty result for empty input", () => {
    assert.equal(downsampleToMono16k(new Float32Array(0), 48_000).length, 0);
  });
});

describe("encodeWav", () => {
  test("emits a 44-byte header before the payload", () => {
    const wav = encodeWav(new Float32Array(100));
    assert.equal(wav.length, 44 + 100 * 2);
  });

  test("writes the RIFF/WAVE container markers", () => {
    const wav = encodeWav(new Float32Array(10));
    assert.equal(readAscii(wav, 0, 4), "RIFF");
    assert.equal(readAscii(wav, 8, 4), "WAVE");
    assert.equal(readAscii(wav, 12, 4), "fmt ");
    assert.equal(readAscii(wav, 36, 4), "data");
  });

  test("declares mono 16-bit PCM at 16kHz, which is what whisper requires", () => {
    const wav = encodeWav(new Float32Array(10));
    assert.equal(readU16(wav, 20), 1, "format should be PCM");
    assert.equal(readU16(wav, 22), 1, "should be mono");
    assert.equal(readU32(wav, 24), WHISPER_SAMPLE_RATE);
    assert.equal(readU16(wav, 34), 16, "should be 16 bits per sample");
  });

  test("declares consistent chunk sizes", () => {
    const samples = 250;
    const wav = encodeWav(new Float32Array(samples));
    assert.equal(readU32(wav, 4), 36 + samples * 2, "RIFF chunk size");
    assert.equal(readU32(wav, 40), samples * 2, "data chunk size");
  });

  test("converts float samples to signed 16-bit", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]));
    const view = Buffer.from(wav);
    assert.equal(view.readInt16LE(44), 0);
    assert.equal(view.readInt16LE(46), 32767);
    assert.equal(view.readInt16LE(48), -32768);
  });

  test("clamps out-of-range samples instead of wrapping", () => {
    // Wrapping would turn a loud moment into a burst of noise.
    const wav = encodeWav(new Float32Array([2.5, -2.5]));
    const view = Buffer.from(wav);
    assert.equal(view.readInt16LE(44), 32767);
    assert.equal(view.readInt16LE(46), -32768);
  });

  test("produces a header-only file for empty audio", () => {
    const wav = encodeWav(new Float32Array(0));
    assert.equal(wav.length, 44);
    assert.equal(readU32(wav, 40), 0);
  });
});
