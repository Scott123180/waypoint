import { randomUUID } from "node:crypto";

import type { Notice } from "./hotkey";

export interface DeliverableNotice extends Notice {
  id: string;
}

/**
 * Keeps user-facing notices alive until they have actually been seen.
 *
 * The capture box spends most of its life hidden, and it clears itself on every
 * open. Without this, a notice raised while hidden — a hotkey that failed to
 * register, a bad config, or a failed inbox write — would be sent to a window
 * nobody is looking at and then wiped before it could be read.
 *
 * Notices carrying `recoverableText` are **sticky**: they replay on every open
 * until acknowledged, because that text is the only remaining copy of a thought
 * whose write failed. The core-api contract requires it never be discarded.
 */
export class NoticeQueue {
  private pending: DeliverableNotice[] = [];

  /**
   * Records a notice and returns what should be sent to the renderer now.
   *
   * @param visible whether the capture box is currently on screen
   */
  push(notice: Notice, visible: boolean): DeliverableNotice[] {
    const deliverable: DeliverableNotice = { ...notice, id: randomUUID() };

    if (isSticky(deliverable) || !visible) {
      this.pending.push(deliverable);
    }

    return visible ? [deliverable] : [];
  }

  /** Notices to replay now that the box is opening. */
  onShow(): DeliverableNotice[] {
    const replay = [...this.pending];
    // One-shot notices have now been seen; sticky ones stay until acknowledged.
    this.pending = this.pending.filter(isSticky);
    return replay;
  }

  /** Marks a sticky notice as read, so it stops replaying. */
  acknowledge(id: string): void {
    this.pending = this.pending.filter((notice) => notice.id !== id);
  }

  pendingCount(): number {
    return this.pending.length;
  }
}

function isSticky(notice: Notice): boolean {
  return typeof notice.recoverableText === "string" && notice.recoverableText.length > 0;
}
