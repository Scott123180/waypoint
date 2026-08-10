import type { Clock, InboxStore, TranscriptionPort } from "../src/ports/index";

/**
 * In-memory InboxStore with hooks for the two behaviours that are hard to
 * observe otherwise: a write that has not finished yet, and a write that fails.
 */
export class FakeInboxStore implements InboxStore {
  content = "";
  /** Blocks appended, in the order they were actually written. */
  written: string[] = [];
  /** Number of subsequent append attempts that should throw. */
  failuresRemaining = 0;

  private gate: Promise<void> | undefined;
  private openGate: (() => void) | undefined;

  /** Holds every subsequent append open until `release()` is called. */
  block(): void {
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
  }

  release(): void {
    this.openGate?.();
    this.gate = undefined;
    this.openGate = undefined;
  }

  async append(block: string): Promise<{ offsetBefore: number }> {
    if (this.gate) await this.gate;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("fake disk failure");
    }
    const offsetBefore = Buffer.byteLength(this.content, "utf8");
    this.content += block;
    this.written.push(block);
    return { offsetBefore };
  }

  async size(): Promise<number> {
    return Buffer.byteLength(this.content, "utf8");
  }

  async readTail(byteCount: number): Promise<string> {
    const buf = Buffer.from(this.content, "utf8");
    return buf.subarray(Math.max(0, buf.length - byteCount)).toString("utf8");
  }

  async truncate(length: number): Promise<void> {
    this.content = Buffer.from(this.content, "utf8").subarray(0, length).toString("utf8");
  }
}

/** Returns canned transcripts, or throws when `error` is set. */
export class FakeTranscriptionPort implements TranscriptionPort {
  result = "";
  error: Error | undefined;
  /** Every WAV buffer handed to this port, so tests can assert none is retained elsewhere. */
  calls: Uint8Array[] = [];

  async transcribe(wav: Uint8Array): Promise<string> {
    this.calls.push(wav);
    if (this.error) throw this.error;
    return this.result;
  }
}

/** Deterministic clock so timestamps are assertable. */
export class FixedClock implements Clock {
  constructor(private current: Date = new Date("2026-08-09T14:23:05.000Z")) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

/** Resolves once all currently-queued microtasks and timers have run. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
