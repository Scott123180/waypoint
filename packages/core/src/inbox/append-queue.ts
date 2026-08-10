import type { InboxStore } from "../ports/index";
import { InboxWriteError } from "../errors";

export type AppendErrorHandler = (error: InboxWriteError) => void;

export interface AppendResult {
  /** File length in bytes before this write, which undo uses as its target. */
  offsetBefore: number;
}

/**
 * Serializes appends through a single promise chain.
 *
 * Two properties matter here:
 *
 * 1. `enqueue` returns as soon as the write is queued, never when it lands on
 *    disk. That is what lets the capture box close instantly (Principle VI).
 * 2. Writes happen strictly in enqueue order, so inbox order matches the order
 *    the user captured in. Firing appends off in parallel would not guarantee
 *    that.
 */
export class AppendQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: InboxStore,
    private readonly onError?: AppendErrorHandler,
  ) {}

  enqueue(block: string, recoverableText: string): Promise<AppendResult> {
    const run = (): Promise<AppendResult> => this.writeWithRetry(block, recoverableText);

    // Chain onto the tail whether or not the previous write succeeded — one
    // failed append must not wedge every thought captured after it.
    const result = this.tail.then(run, run);

    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Drains everything queued, including work enqueued while draining. */
  async flush(): Promise<void> {
    let current = this.tail;
    for (;;) {
      await current;
      if (this.tail === current) return;
      current = this.tail;
    }
  }

  private async writeWithRetry(block: string, recoverableText: string): Promise<AppendResult> {
    try {
      return await this.store.append(block);
    } catch {
      // One retry covers the transient case (a momentary lock, a brief I/O
      // hiccup) without turning a real failure into an endless loop.
      try {
        return await this.store.append(block);
      } catch (secondFailure) {
        const error = new InboxWriteError(
          "Could not write to the inbox. Your thought was not saved.",
          recoverableText,
          { cause: secondFailure },
        );
        this.onError?.(error);
        throw error;
      }
    }
  }
}
