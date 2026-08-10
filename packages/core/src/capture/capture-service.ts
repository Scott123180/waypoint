import type { Clock, InboxStore, TranscriptionPort } from "../ports/index";
import type { InboxWriteError } from "../errors";
import { AppendQueue, type AppendResult } from "../inbox/append-queue";
import { serializeItem } from "../inbox/serialize";
import { createCaptureItem, type CaptureSource } from "./capture-item";

export interface SubmitResult {
  id: string;
  capturedAt: Date;
}

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
  private undoWindow: UndoWindow | undefined;

  constructor(deps: CaptureServiceDeps) {
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

    // Opening a new window closes the previous one: only the most recent
    // capture is ever undoable.
    this.undoWindow = { id: item.id, block, source, text: item.text, write };

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

  /** The id of the currently undoable capture, if any. */
  undoableId(): string | undefined {
    return this.undoWindow?.id;
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
