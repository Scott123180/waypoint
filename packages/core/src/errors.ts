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

/**
 * A vault write failed irrecoverably.
 *
 * Carries the item text for the same reason `InboxWriteError` does: when the
 * write failed, this may be the only remaining copy of the thought, so callers
 * can show it back rather than dropping it silently.
 */
export class VaultWriteError extends Error {
  readonly recoverableText: string;
  /** Vault-relative path we were trying to write. */
  readonly destination: string;

  constructor(
    message: string,
    destination: string,
    recoverableText: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "VaultWriteError";
    this.destination = destination;
    this.recoverableText = recoverableText;
  }
}
