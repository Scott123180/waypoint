import type { InboxDocument, JournalEntry, SortJournal, VaultStore } from "../src/ports/index";

/**
 * In-memory ports for sort tests.
 *
 * Each can simulate the failures that matter: a byte mismatch, an I/O error,
 * and a concurrent append landing mid-operation.
 */

export class FakeInboxDocument implements InboxDocument {
  content: string;
  /** Set to throw on the next write. */
  failNextWrite = false;
  /** Appended to the document immediately before the next removeRange commits. */
  concurrentAppend: string | undefined;
  removeCalls = 0;

  constructor(content = "") {
    this.content = content;
  }

  read(): Promise<string> {
    return Promise.resolve(this.content);
  }

  removeRange(start: number, end: number, expected: string): Promise<"removed" | "mismatch"> {
    this.removeCalls += 1;

    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error("simulated inbox write failure"));
    }

    // A capture landing between our read and our write. A correct
    // implementation preserves it (FR-020e).
    if (this.concurrentAppend !== undefined) {
      this.content += this.concurrentAppend;
      this.concurrentAppend = undefined;
    }

    const buf = Buffer.from(this.content, "utf8");
    const actual = buf.subarray(start, end).toString("utf8");
    if (actual !== expected) return Promise.resolve("mismatch");

    this.content = Buffer.concat([buf.subarray(0, start), buf.subarray(end)]).toString("utf8");
    return Promise.resolve("removed");
  }
}

export class FakeVaultStore implements VaultStore {
  files = new Map<string, string>();
  /** Vault-relative paths whose next write should throw. */
  failWrites = new Set<string>();
  writeLog: string[] = [];
  /**
   * Every path read, in order, including misses.
   *
   * Feature 4 asserts on the *count*: producing a project list must read each
   * project file at most once. Timing cannot catch a quadratic read path on
   * fast hardware; counting can (004 research R6).
   */
  readLog: string[] = [];

  list(dir: "projects" | "areas"): Promise<string[]> {
    const prefix = `${dir}/`;
    const slugs = [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && p.endsWith(".md"))
      .map((p) => p.slice(prefix.length, -".md".length))
      .sort();
    return Promise.resolve(slugs);
  }

  read(relPath: string): Promise<string | null> {
    this.readLog.push(relPath);
    return Promise.resolve(this.files.get(relPath) ?? null);
  }

  write(relPath: string, content: string): Promise<void> {
    if (this.failWrites.has(relPath)) {
      return Promise.reject(new Error(`simulated write failure for ${relPath}`));
    }
    this.files.set(relPath, content);
    this.writeLog.push(relPath);
    return Promise.resolve();
  }

  appendLine(relPath: string, line: string): Promise<void> {
    if (this.failWrites.has(relPath)) {
      return Promise.reject(new Error(`simulated append failure for ${relPath}`));
    }
    const existing = this.files.get(relPath) ?? "";
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    this.files.set(relPath, `${existing}${needsNewline ? "\n" : ""}${line}\n`);
    this.writeLog.push(relPath);
    return Promise.resolve();
  }
}

export class FakeSortJournal implements SortJournal {
  entries: JournalEntry[] = [];
  /** Ordered record of operations, for asserting commit sequence. */
  log: string[] = [];

  begin(entry: JournalEntry): Promise<void> {
    this.entries.push({ ...entry });
    this.log.push(`begin:${entry.id}`);
    return Promise.resolve();
  }

  markDestinationWritten(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.destinationWritten = true;
    this.log.push(`written:${id}`);
    return Promise.resolve();
  }

  clear(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.log.push(`clear:${id}`);
    return Promise.resolve();
  }

  pending(): Promise<JournalEntry[]> {
    return Promise.resolve(this.entries.map((e) => ({ ...e })));
  }
}

/** Fixed clock, so dates in destination files are deterministic. */
export const fixedClock = (iso = "2026-08-11T10:00:00-04:00") => ({
  now: () => new Date(iso),
});
