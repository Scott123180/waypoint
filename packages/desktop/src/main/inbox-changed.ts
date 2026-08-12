/**
 * "The inbox changed" — the fact, never the cause.
 *
 * Deliberately says nothing about *who* wrote: capture, undo, and sort all
 * raise it through the same adapters, and so will the local API and the LLM
 * organization layer, which write to the inbox from outside the GUI. A view
 * subscribes once and reacts to every writer, so a new writer needs no new
 * plumbing and no view needs to learn about it.
 *
 * The counterpart to this is `SortWindow.show()`, which re-reads on open. That
 * covers hand-edits made in a text editor, which no in-process signal can see.
 */
export type InboxChangedListener = () => void;

export class InboxChanged {
  private readonly listeners = new Set<InboxChangedListener>();

  subscribe(listener: InboxChangedListener): void {
    this.listeners.add(listener);
  }

  /**
   * Raised once a write has actually landed on disk, never when it is merely
   * queued. A listener's whole job is to re-read the file, so raising early
   * would hand it the state from *before* the write and teach it to distrust
   * the signal.
   */
  raise(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Best-effort notification. A view that fails to refresh must not fail
        // the write that triggered it, nor starve the other listeners.
      }
    }
  }
}
