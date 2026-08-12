import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { InboxDocument } from "@waypoint/core";

import type { InboxMutex } from "../inbox-mutex";

/**
 * Read/modify access to the inbox, for sorting.
 *
 * Removing an item from the middle of a file has no in-place primitive, so
 * this rebuilds the file and `rename`s it over the original — atomic within a
 * filesystem, so a reader sees the whole old file or the whole new one.
 *
 * Two hazards come with that, and they get different answers:
 *
 * - **In-process writers** (capture's `FsInboxStore`) are serialized on a
 *   shared mutex, which removes the race by construction. The mutex is a
 *   required constructor argument precisely so an unsafe instance cannot be
 *   built by accident (research R4a).
 * - **Out-of-process writers** (the user's text editor) cannot be locked, so
 *   the size is re-checked immediately before the rename and the splice is
 *   retried from a fresh read if the file moved underneath us.
 *
 * See specs/002-inbox-view-sort/research.md R1, R4, R4a
 */
export class FsInboxDocument implements InboxDocument {
  /** Bounded so a file being written continuously cannot spin forever. */
  private static readonly MAX_ATTEMPTS = 3;

  constructor(
    private readonly filePath: string,
    private readonly mutex: InboxMutex,
    /**
     * Raised after a splice lands, so an open view can re-read. Sorting is the
     * other writer to this file, and it raises the same signal capture does —
     * listeners are told the inbox changed, never which client changed it.
     */
    private readonly onChanged?: () => void,
    /**
     * Test seam. Runs in the one window a size check cannot cover: after the
     * final `stat`, before the `rename`. A concurrent append landing here is
     * discarded by the rename, so this is what lets the regression test prove
     * the mutex is doing something rather than passing by timing luck.
     *
     * Never set in production; there is no code path that supplies it.
     */
    private readonly beforeRename?: () => Promise<void> | void,
  ) {}

  async read(): Promise<string> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  async removeRange(start: number, end: number, expected: string): Promise<"removed" | "mismatch"> {
    const result = await this.mutex.run(() => this.spliceWithRetry(start, end, expected));
    // A mismatch leaves the file exactly as it was, so it is not a change and
    // must not wake a view: the signal has to mean the bytes actually moved.
    if (result === "removed") this.onChanged?.();
    return result;
  }

  private async spliceWithRetry(
    start: number,
    end: number,
    expected: string,
  ): Promise<"removed" | "mismatch"> {
    for (let attempt = 0; attempt < FsInboxDocument.MAX_ATTEMPTS; attempt++) {
      const result = await this.spliceOnce(start, end, expected);
      if (result !== "retry") return result;
    }
    // Something outside this process is writing continuously. Refusing is the
    // safe answer; the caller re-presents the item.
    return "mismatch";
  }

  private async spliceOnce(
    start: number,
    end: number,
    expected: string,
  ): Promise<"removed" | "mismatch" | "retry"> {
    let current: Buffer;
    try {
      current = await readFile(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "mismatch";
      throw err;
    }

    const actual = current.subarray(start, end).toString("utf8");
    if (actual !== expected) return "mismatch";

    const next = Buffer.concat([current.subarray(0, start), current.subarray(end)]);

    const tmpPath = join(dirname(this.filePath), `.inbox.${process.pid}.${Date.now()}.tmp`);
    const handle = await open(tmpPath, "wx");
    try {
      await handle.write(next);
      // Durable before the rename, so a crash cannot leave a truncated file
      // where the inbox used to be.
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      // Last check before committing. An out-of-process writer that appended
      // since our read would have its bytes discarded by the rename, so start
      // over from a fresh read instead.
      const onDisk = await stat(this.filePath);
      if (onDisk.size !== current.byteLength) {
        await unlink(tmpPath);
        return "retry";
      }

      if (this.beforeRename) await this.beforeRename();

      await rename(tmpPath, this.filePath);
      return "removed";
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }
}
