/**
 * Ports the core depends on, implemented by the client/adapter layer and
 * injected in. The core owns the rules; adapters own the I/O.
 *
 * See specs/001-quick-capture/contracts/core-api.md
 */

/** Appends bytes to the inbox and reports where they landed. */
export interface InboxStore {
  /**
   * Atomically appends `block`. Resolves with the file length BEFORE this
   * append, which undo uses as its truncation target. Creates the file and any
   * missing parent directories. Never rewrites existing content.
   */
  append(block: string): Promise<{ offsetBefore: number }>;

  /** Current byte length, for undo tail verification. */
  size(): Promise<number>;

  /** The trailing `byteCount` bytes, for undo tail verification. */
  readTail(byteCount: number): Promise<string>;

  /** Truncates to `length`. Only ever called by a verified undo. */
  truncate(length: number): Promise<void>;
}

/** Turns spoken audio into text. */
export interface TranscriptionPort {
  /**
   * @param wav 16 kHz mono 16-bit PCM in a WAV container, in memory only.
   * @throws TranscriptionFailedError when the underlying engine fails.
   */
  transcribe(wav: Uint8Array): Promise<string>;
}

/** Injected so tests control time and items get deterministic timestamps. */
export interface Clock {
  now(): Date;
}

/**
 * Read/modify access to the inbox, for sorting.
 *
 * Distinct from `InboxStore`, which is append-only and belongs to capture.
 * See specs/002-inbox-view-sort/contracts/sort-api.md
 */
export interface InboxDocument {
  /** Full current contents. Empty string when the file does not exist. */
  read(): Promise<string>;

  /**
   * Removes bytes [start, end) — but only if what is currently there exactly
   * equals `expected`. Returns 'mismatch' without writing anything otherwise.
   *
   * Implementations MUST be atomic (a reader sees before or after, never
   * mid-write) and MUST NOT discard a concurrent append. An implementation
   * that rebuilds the file has to serialize against every other writer in its
   * process and detect out-of-process growth before committing — a capture
   * landing mid-removal has to survive it (FR-020e, research R4a).
   */
  removeRange(start: number, end: number, expected: string): Promise<"removed" | "mismatch">;
}

/**
 * Raw file access within the vault.
 *
 * Deliberately has no concept of a destination: an adapter can write bytes to
 * a path, but only the core decides which path and which bytes (Principle II).
 */
export interface VaultStore {
  /** Slugs of the markdown files in a vault subdirectory. Empty when absent. */
  list(dir: "projects" | "areas"): Promise<string[]>;

  /** File contents, or null when absent. Path is vault-relative. */
  read(relPath: string): Promise<string | null>;

  /** Writes atomically, creating parent directories. Path is vault-relative. */
  write(relPath: string, content: string): Promise<void>;

  /** Appends a line, creating the file if absent and guaranteeing a preceding newline. */
  appendLine(relPath: string, line: string): Promise<void>;
}

/** One in-flight sort decision, recorded before anything is written. */
export interface JournalEntry {
  id: string;
  ref: { start: number; end: number; raw: string };
  decision: unknown;
  destinationWritten: boolean;
  startedAt: string;
}

/**
 * Write-ahead log making the two-file commit effectively-once.
 *
 * See specs/002-inbox-view-sort/research.md R2.
 */
export interface SortJournal {
  begin(entry: JournalEntry): Promise<void>;
  markDestinationWritten(id: string): Promise<void>;
  clear(id: string): Promise<void>;
  pending(): Promise<JournalEntry[]>;
}
