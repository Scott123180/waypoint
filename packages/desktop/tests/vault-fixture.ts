import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * An isolated vault on the real filesystem, for adapter tests.
 *
 * Adapter tests are the ones that must touch a real disk — that is the whole
 * point of them — so they get a throwaway directory rather than a fake.
 */
export interface TempVault {
  root: string;
  inboxPath: string;
  /** Absolute path for a vault-relative path. */
  path(relPath: string): string;
  /** Contents of a vault-relative file, or "" when absent. */
  read(relPath: string): string;
  /** Writes a vault-relative file, creating parent directories. */
  write(relPath: string, content: string): void;
  exists(relPath: string): boolean;
  cleanup(): void;
}

export function makeTempVault(): TempVault {
  const root = mkdtempSync(join(tmpdir(), "waypoint-vault-"));

  const path = (relPath: string): string => join(root, relPath);

  return {
    root,
    inboxPath: join(root, "inbox.md"),
    path,
    read(relPath) {
      const p = path(relPath);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    },
    write(relPath, content) {
      const p = path(relPath);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
    },
    exists(relPath) {
      return existsSync(path(relPath));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Runs `fn` against a fresh vault and always cleans up, even on failure. */
export async function withTempVault(fn: (vault: TempVault) => Promise<void> | void): Promise<void> {
  const vault = makeTempVault();
  try {
    await fn(vault);
  } finally {
    vault.cleanup();
  }
}
