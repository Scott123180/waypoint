import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { VaultStore } from "@waypoint/core";

/**
 * Raw file access within the vault.
 *
 * Deliberately has no concept of a destination: this can write bytes to a
 * path, but only the core decides which path and which bytes. That is what
 * keeps Principle II structural rather than a convention.
 *
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */
export class FsVaultStore implements VaultStore {
  constructor(
    private readonly vaultRoot: string,
    /**
     * Raised after a write lands, so an open view can re-read.
     *
     * Hung here rather than off the IPC handlers the projects view calls, which
     * is where it used to live: sort files an item into a project without ever
     * touching those handlers, so an open projects window sat on stale rows
     * until it was closed and reopened. Every writer reaches a project or area
     * file through this class, so this is the one place that sees them all —
     * and the local API and LLM layer inherit the signal for free.
     */
    private readonly onChanged?: () => void,
  ) {}

  async list(dir: "projects" | "areas"): Promise<string[]> {
    try {
      const entries = await readdir(join(this.vaultRoot, dir), { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.slice(0, -".md".length))
        .sort();
    } catch (err) {
      // A vault with no projects yet is the normal first-run case.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async read(relPath: string): Promise<string | null> {
    try {
      return await readFile(join(this.vaultRoot, relPath), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Atomic whole-file write.
   *
   * Used for project and area files, which are read-modify-written to insert
   * under `## Unprocessed`. Temp-plus-rename so a crash cannot leave a project
   * file half-written.
   */
  async write(relPath: string, content: string): Promise<void> {
    const target = join(this.vaultRoot, relPath);
    await mkdir(dirname(target), { recursive: true });

    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(tmp, "wx");
    try {
      await handle.write(content, null, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
    // Only on success, and only once the rename has landed — a throw propagates
    // past this and no listener is sent back to re-read a write that did not
    // happen.
    this.onChanged?.();
  }

  /**
   * Appends one line to a running list, creating it if absent.
   *
   * `O_APPEND` so a concurrent editor save cannot land inside our line, and a
   * missing trailing newline in a hand-edited file is repaired first so the
   * append cannot graft onto the user's last line.
   */
  async appendLine(relPath: string, line: string): Promise<void> {
    const target = join(this.vaultRoot, relPath);
    await mkdir(dirname(target), { recursive: true });

    let needsNewline = false;
    try {
      const existing = await readFile(target);
      needsNewline = existing.byteLength > 0 && existing[existing.byteLength - 1] !== 0x0a;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await writeFile(target, "", { flag: "a" });
    }

    const handle = await open(target, "a");
    try {
      await handle.write(`${needsNewline ? "\n" : ""}${line}\n`, null, "utf8");
    } finally {
      await handle.close();
    }
    this.onChanged?.();
  }
}
