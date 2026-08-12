import { mkdir, open, stat, truncate as fsTruncate } from "node:fs/promises";
import { dirname } from "node:path";

import type { InboxStore } from "@waypoint/core";

import type { InboxMutex } from "../inbox-mutex";

const NEWLINE = 0x0a;

/**
 * Filesystem-backed inbox.
 *
 * Append-only during capture: existing bytes are never rewritten, so a file the
 * user is editing by hand in another window cannot be clobbered by a capture.
 *
 * Writes go through a mutex shared with `FsInboxDocument`. Sort rebuilds this
 * file and renames it into place, which orphans the inode an append is writing
 * to — without the lock, a capture made during a sort is destroyed silently
 * (FR-020e, research R4a).
 *
 * This does not make capture block the user. `CaptureService.submit` returns
 * when the write is enqueued, not when it lands, so only the background drain
 * ever waits here.
 */
export class FsInboxStore implements InboxStore {
  constructor(
    private readonly filePath: string,
    private readonly mutex: InboxMutex,
    /**
     * Raised after a write lands, so an open view can re-read. Hung here rather
     * than off the IPC handler that started the capture: `submit` returns when
     * the write is *queued*, and a signal raised there would send listeners
     * back to a file that does not contain the item yet.
     */
    private readonly onChanged?: () => void,
  ) {}

  async append(block: string): Promise<{ offsetBefore: number }> {
    // Raised outside the lock, and only on success — a throw propagates past
    // this and no listener is told about a write that did not happen.
    const result = await this.mutex.run(() => this.appendLocked(block));
    this.onChanged?.();
    return result;
  }

  /** Truncation is a write too, so undo shares the lock — and the signal. */
  async truncate(length: number): Promise<void> {
    await this.mutex.run(() => fsTruncate(this.filePath, length));
    this.onChanged?.();
  }

  private async appendLocked(block: string): Promise<{ offsetBefore: number }> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const { size, endsWithNewline } = await this.inspect();

    // A hand-edited file often ends without a trailing newline. Appending
    // blindly would graft our item onto the end of the user's last line.
    const payload = size > 0 && !endsWithNewline ? `\n${block}` : block;

    // "a" is O_APPEND: the kernel places each write at the current end of file,
    // so a concurrent editor save cannot land inside our item.
    const handle = await open(this.filePath, "a");
    try {
      await handle.write(payload, null, "utf8");
    } finally {
      await handle.close();
    }

    // Reported before any newline fix-up, so undo restores the file exactly as
    // the user had it.
    return { offsetBefore: size };
  }

  async size(): Promise<number> {
    try {
      return (await stat(this.filePath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
  }

  async readTail(byteCount: number): Promise<string> {
    const size = await this.size();
    if (size === 0 || byteCount <= 0) return "";

    const length = Math.min(byteCount, size);
    const handle = await open(this.filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }

  private async inspect(): Promise<{ size: number; endsWithNewline: boolean }> {
    let size: number;
    try {
      size = (await stat(this.filePath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // A missing inbox is normal on first capture, never an error.
        return { size: 0, endsWithNewline: true };
      }
      throw err;
    }

    if (size === 0) return { size: 0, endsWithNewline: true };

    const handle = await open(this.filePath, "r");
    try {
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, size - 1);
      return { size, endsWithNewline: buffer[0] === NEWLINE };
    } finally {
      await handle.close();
    }
  }
}
