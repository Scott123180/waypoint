/**
 * Ports the core depends on, implemented by the client/adapter layer and
 * injected in. The core owns the rules; adapters own the I/O.
 *
 * See specs/001-quick-capture/contracts/core-api.md
 */

/** Appends bytes to the inbox and reports where they landed. */
export interface InboxStore {
  /**
   * Atomically appends `block`. Resolves with the file length BEFORE this
   * append, which undo uses as its truncation target. Creates the file and any
   * missing parent directories. Never rewrites existing content.
   */
  append(block: string): Promise<{ offsetBefore: number }>;

  /** Current byte length, for undo tail verification. */
  size(): Promise<number>;

  /** The trailing `byteCount` bytes, for undo tail verification. */
  readTail(byteCount: number): Promise<string>;

  /** Truncates to `length`. Only ever called by a verified undo. */
  truncate(length: number): Promise<void>;
}

/** Turns spoken audio into text. */
export interface TranscriptionPort {
  /**
   * @param wav 16 kHz mono 16-bit PCM in a WAV container, in memory only.
   * @throws TranscriptionFailedError when the underlying engine fails.
   */
  transcribe(wav: Uint8Array): Promise<string>;
}

/** Injected so tests control time and items get deterministic timestamps. */
export interface Clock {
  now(): Date;
}
