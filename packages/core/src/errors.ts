/** Submit was called with text that is empty or whitespace-only. No item, no write. */
export class EmptyCaptureError extends Error {
  constructor() {
    super("Capture was empty; nothing was saved.");
    this.name = "EmptyCaptureError";
  }
}

/** The transcription engine failed. Voice failing must never take text capture down. */
export class TranscriptionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionFailedError";
  }
}

/**
 * An append failed after its retry.
 *
 * Carries the raw text deliberately: a thought must stay recoverable by the
 * user even when the disk write failed, so callers can show it back rather
 * than silently dropping it.
 */
export class InboxWriteError extends Error {
  readonly recoverableText: string;

  constructor(message: string, recoverableText: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InboxWriteError";
    this.recoverableText = recoverableText;
  }
}
