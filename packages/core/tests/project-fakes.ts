import type { Clock } from "../src/ports/index";
import { FakeVaultStore } from "./sort-fakes";

/**
 * Test doubles for project work.
 *
 * `FakeVaultStore` is reused from the sort tests rather than duplicated: this
 * feature adds no port, so a second fake would be a second definition of the
 * same contract, free to drift from it.
 */

export { FakeVaultStore } from "./sort-fakes";

/** Fixed clock, so completion dates are deterministic. */
export class FixedClock implements Clock {
  constructor(private iso = "2026-08-12T10:00:00-04:00") {}

  now(): Date {
    return new Date(this.iso);
  }

  /** Move the clock, for tests that complete things on different days. */
  set(iso: string): void {
    this.iso = iso;
  }
}

/** A vault preloaded with files. Keys are vault-relative paths. */
export function seedVault(files: Record<string, string>): FakeVaultStore {
  const vault = new FakeVaultStore();
  for (const [path, content] of Object.entries(files)) {
    vault.files.set(path, content);
  }
  // Seeding is setup, not a write under test.
  vault.writeLog.length = 0;
  vault.readLog.length = 0;
  return vault;
}

/** Convenience: one project at `projects/<slug>.md`. */
export function seedProject(slug: string, content: string): FakeVaultStore {
  return seedVault({ [`projects/${slug}.md`]: content });
}

/** Convenience: one area at `areas/<slug>.md`. */
export function seedArea(slug: string, content: string): FakeVaultStore {
  return seedVault({ [`areas/${slug}.md`]: content });
}
