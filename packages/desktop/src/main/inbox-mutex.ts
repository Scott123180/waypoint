/**
 * One write lock, shared by every writer to the inbox file.
 *
 * Capture appends with O_APPEND to the open inode; sort rebuilds the file and
 * `rename`s it into place, which orphans that inode. A capture landing between
 * sort's read and sort's rename would be written to the file about to be
 * discarded — the thought would vanish with no error and nothing on disk to
 * show it ever existed.
 *
 * Both writers live in this process, so serializing them here removes the race
 * by construction rather than narrowing it (FR-020e, research R4a).
 *
 * This does not make capture block the user: `CaptureService.submit` already
 * returns when the write is *enqueued*, so the only thing that ever waits here
 * is the background queue drain, for as long as one inbox rewrite takes.
 */
export class InboxMutex {
  /** Tail of the queue. Each waiter chains onto the previous one. */
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    // Chain onto the tail regardless of how the previous operation settled, so
    // a thrown error cannot wedge the lock for everything behind it.
    const result = this.tail.then(operation, operation);

    // The queue advances on settlement, not success.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
