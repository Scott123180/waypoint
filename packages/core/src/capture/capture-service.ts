import type { Clock, InboxStore, TranscriptionPort } from "../ports/index";
import type { InboxWriteError } from "../errors";
import { AppendQueue, type AppendResult } from "../inbox/append-queue";
import { performUndo } from "./undo-token";
import { serializeItem } from "../inbox/serialize";
import { createCaptureItem, type CaptureSource } from "./capture-item";

export interface SubmitResult {
  id: string;
  capturedAt: Date;
}

export type UndoResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "file-changed" | "unknown-id" };

export type TranscribeResult =
  | { status: "ok"; text: string }
  | { status: "no-speech" }
  | { status: "failed"; message: string };

export interface CaptureServiceDeps {
  inbox: InboxStore;
  transcription: TranscriptionPort;
  clock?: Clock;
  onError?: (error: InboxWriteError) => void;
}

const systemClock: Clock = { now: () => new Date() };

/** In-memory record of the one capture that is currently undoable. */
interface UndoWindow {
  id: string;
  block: string;
  source: CaptureSource;
  text: string;
  write: Promise<AppendResult>;
}

/**
 * The single entry point for capture.
 *
 * Every rule the feature depends on lives behind this class, so the Electron
 * client — and later the HTTP API and agent — all get identical behaviour
 * without reimplementing anything.
 */
export class CaptureService {
  private readonly queue: AppendQueue;
  private readonly clock: Clock;
  private readonly transcription: TranscriptionPort;
  private readonly inbox: InboxStore;
  private undoWindow: UndoWindow | undefined;

  constructor(deps: CaptureServiceDeps) {
    this.inbox = deps.inbox;
    this.queue = new AppendQueue(deps.inbox, deps.onError);
    this.clock = deps.clock ?? systemClock;
    this.transcription = deps.transcription;
  }

  /**
   * Creates the item and queues its append.
   *
   * Resolves as soon as the write is *queued*, deliberately not when it lands
   * on disk. A client cannot restore non-blocking behaviour if this blocks.
   *
   * @throws EmptyCaptureError when the text is empty or whitespace-only.
   */
  async submit(text: string, source: CaptureSource): Promise<SubmitResult> {
    const item = createCaptureItem(text, source, this.clock);
    const block = serializeItem(item);

    const write = this.queue.enqueue(block, item.text);
    // Mark it handled so a failed write is not an unhandled rejection; the
    // error still reaches the user through the queue's onError handler.
    write.catch(() => undefined);

    // Every capture closes the previous undo window, so only the most recent
    // one is ever undoable. Only dictated captures open a new one: FR-009
    // scopes undo to transcription errors, and FR-018 bounds it there.
    this.undoWindow =
      source === "dictated"
        ? { id: item.id, block, source, text: item.text, write }
        : undefined;

    return { id: item.id, capturedAt: item.capturedAt };
  }

  /**
   * Transcribes dictated audio.
   *
   * Deliberately has no path to the inbox. A transcript can only be stored by
   * being placed in the capture box and explicitly submitted, which is what
   * makes "never stored unseen" structural rather than a convention a client
   * could forget to follow.
   *
   * The audio is not retained after this returns.
   */
  async transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    let text: string;
    try {
      text = await this.transcription.transcribe(wav);
    } catch (err) {
      return {
        status: "failed",
        message: err instanceof Error ? err.message : "Transcription failed.",
      };
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // Silence or unintelligible noise is a valid outcome, not an error.
      return { status: "no-speech" };
    }

    return { status: "ok", text: trimmed };
  }

  /**
   * Removes a just-dictated capture from the inbox.
   *
   * Refusal is returned as a value rather than thrown, because refusing is an
   * expected outcome: if the file changed underneath us, the safe answer is to
   * leave it alone. Callers must show the captured text alongside a refusal so
   * the thought stays recoverable.
   */
  async undo(id: string): Promise<UndoResult> {
    const window = this.undoWindow;
    if (!window) return { ok: false, reason: "expired" };
    if (window.id !== id) return { ok: false, reason: "unknown-id" };

    // The append may still be in flight; undo must not race it.
    let offsetBefore: number;
    try {
      ({ offsetBefore } = await window.write);
    } catch {
      // The write failed, so there is nothing on disk to undo.
      this.undoWindow = undefined;
      return { ok: false, reason: "file-changed" };
    }

    const outcome = await performUndo(this.inbox, {
      itemId: window.id,
      serializedBlock: window.block,
      offsetBefore,
    });

    if (outcome.ok) {
      this.undoWindow = undefined;
      return { ok: true };
    }
    return outcome;
  }

  /** The id of the currently undoable capture, if any. */
  undoableId(): string | undefined {
    return this.undoWindow?.id;
  }

  /** The text of the currently undoable capture, for a recoverable refusal. */
  undoableText(): string | undefined {
    return this.undoWindow?.text;
  }

  /** Closes the undo window without touching the inbox. */
  expireUndoWindow(): void {
    this.undoWindow = undefined;
  }

  /** Drains queued writes. Called on quit so a normal exit loses nothing. */
  async flush(): Promise<void> {
    await this.queue.flush();
  }
}
