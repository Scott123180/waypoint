import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { InboxStore } from "@waypoint/core";

const NEWLINE = 0x0a;

/**
 * Filesystem-backed inbox.
 *
 * Append-only during capture: existing bytes are never rewritten, so a file the
 * user is editing by hand in another window cannot be clobbered by a capture.
 */
export class FsInboxStore implements InboxStore {
  constructor(private readonly filePath: string) {}

  async append(block: string): Promise<{ offsetBefore: number }> {
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
    throw new Error("FsInboxStore.size is implemented in User Story 3 (undo)");
  }

  async readTail(_byteCount: number): Promise<string> {
    throw new Error("FsInboxStore.readTail is implemented in User Story 3 (undo)");
  }

  async truncate(_length: number): Promise<void> {
    throw new Error("FsInboxStore.truncate is implemented in User Story 3 (undo)");
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
