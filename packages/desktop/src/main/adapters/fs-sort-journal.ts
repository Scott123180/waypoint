import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import type { JournalEntry, SortJournal } from "@waypoint/core";

/**
 * JSON-lines write-ahead log for in-flight sort decisions.
 *
 * Lives at the platform state directory, not in the user's vault: this is app
 * recovery bookkeeping with a lifetime measured in milliseconds, and putting
 * it in a git-tracked vault would add churn and a file the user would
 * reasonably wonder about (research R9).
 *
 * Each line is one entry. A malformed line — a torn write from a crash — is
 * skipped rather than throwing, because refusing to start over an unreadable
 * journal would be worse than the problem it describes.
 */
export class FsSortJournal implements SortJournal {
  constructor(private readonly filePath: string) {}

  async begin(entry: JournalEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const handle = await open(this.filePath, "a");
    try {
      await handle.write(`${JSON.stringify(entry)}\n`, null, "utf8");
      // The whole point of a write-ahead log is that it survives the crash it
      // is describing, so this one flush is not optional.
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async markDestinationWritten(id: string): Promise<void> {
    await this.rewrite((entries) =>
      entries.map((e) => (e.id === id ? { ...e, destinationWritten: true } : e)),
    );
  }

  async clear(id: string): Promise<void> {
    await this.rewrite((entries) => entries.filter((e) => e.id !== id));
  }

  async pending(): Promise<JournalEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const entries: JournalEntry[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as JournalEntry;
        if (typeof parsed?.id === "string") entries.push(parsed);
      } catch {
        // A torn final line from a crash mid-write. The decision it described
        // never got past its first step, so skipping it is correct.
      }
    }
    return entries;
  }

  private async rewrite(
    transform: (entries: JournalEntry[]) => JournalEntry[],
  ): Promise<void> {
    const next = transform(await this.pending());

    if (next.length === 0) {
      await unlink(this.filePath).catch(() => undefined);
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const handle = await open(tmp, "w");
    try {
      await handle.write(next.map((e) => `${JSON.stringify(e)}\n`).join(""), null, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, this.filePath);
  }
}
