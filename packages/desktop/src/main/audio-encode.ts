/**
 * Turns captured microphone audio into the one format whisper.cpp accepts:
 * 16 kHz mono 16-bit PCM in a WAV container.
 *
 * Pure functions with no DOM or Electron dependency, so they run in the fast
 * test suite. The renderer captures raw samples and hands them here; nothing
 * on this path ever touches disk.
 */

export const WHISPER_SAMPLE_RATE = 16_000;

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/**
 * Resamples to 16 kHz by averaging each source window, which avoids the
 * aliasing that naive sample-dropping introduces on speech.
 */
export function downsampleToMono16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (sourceRate === WHISPER_SAMPLE_RATE) return samples;
  if (sourceRate < WHISPER_SAMPLE_RATE) {
    throw new Error(`Cannot upsample from ${sourceRate}Hz; whisper needs ${WHISPER_SAMPLE_RATE}Hz`);
  }

  const ratio = sourceRate / WHISPER_SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);

    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0;
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }

  return out;
}

/** Wraps 16 kHz mono float samples in a WAV container. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  const byteRate = (WHISPER_SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, WHISPER_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    // Clamp rather than let a loud moment wrap into a burst of noise.
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

/** Convenience for the full renderer-samples → whisper-input path. */
export function toWhisperWav(samples: Float32Array, sourceRate: number): Uint8Array {
  return encodeWav(downsampleToMono16k(samples, sourceRate));
}
