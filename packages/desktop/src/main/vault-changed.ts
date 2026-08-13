/**
 * "A project or area file changed" — the fact, never the cause.
 *
 * The counterpart to `InboxChanged`, and deliberately a separate emitter rather
 * than a reuse of it: `InboxChanged` fires on every capture, which for a
 * projects window is pure noise that would trigger a full re-read each time the
 * user jots a thought. Both are generic with respect to *cause* — neither says
 * whether an outcome was edited, a milestone completed, or a status changed —
 * and they differ in *subject*, which is what makes them useful.
 *
 * A writer added later (the local API in Feature 7, the LLM layer in Feature 8)
 * raises this by going through the same path, with nothing to remember and no
 * view to teach about it.
 *
 * See specs/003-project-structure/research.md R7
 */
export type VaultChangedListener = () => void;

export class VaultChanged {
  private readonly listeners = new Set<VaultChangedListener>();

  subscribe(listener: VaultChangedListener): void {
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
