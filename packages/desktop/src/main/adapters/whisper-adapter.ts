import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

import { TranscriptionFailedError, type TranscriptionPort } from "@waypoint/core";

export interface WhisperAdapterOptions {
  binaryPath: string;
  modelPath: string;
  timeoutMs?: number;
  threads?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Runs the bundled whisper.cpp binary as a subprocess, offline.
 *
 * The WAV goes in on stdin (`-f -`), verified present in whisper.cpp v1.7.4,
 * so dictated audio never touches disk.
 */
export class WhisperAdapter implements TranscriptionPort {
  private child: ChildProcess | undefined;

  constructor(private readonly options: WhisperAdapterOptions) {}

  async transcribe(wav: Uint8Array): Promise<string> {
    if (!existsSync(this.options.binaryPath)) {
      throw new TranscriptionFailedError(
        `Speech-to-text is unavailable: whisper binary not found at ${this.options.binaryPath}. ` +
          `Typing still works.`,
      );
    }
    if (!existsSync(this.options.modelPath)) {
      throw new TranscriptionFailedError(
        `Speech-to-text is unavailable: model not found at ${this.options.modelPath}. ` +
          `Typing still works.`,
      );
    }

    const args = [
      "-m", this.options.modelPath,
      "-f", "-",
      "--no-timestamps",
      "--language", "en",
      "--threads", String(this.options.threads ?? Math.max(1, cpuCount() - 1)),
    ];

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(this.options.binaryPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(this.options.env ? { env: this.options.env } : {}),
      });
      this.child = child;

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = undefined;
        fn();
      };

      const timer = setTimeout(() => {
        // A wedged subprocess would otherwise pin a core indefinitely.
        child.kill("SIGKILL");
        finish(() => reject(new TranscriptionFailedError("Transcription timed out.")));
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

      child.on("error", (err) => {
        finish(() => reject(new TranscriptionFailedError(`Could not run whisper: ${err.message}`)));
      });

      child.on("close", (code, signal) => {
        if (code === 0) {
          // stderr carries progress logs on success, so only the exit code counts.
          finish(() => resolve(stdout.trim()));
          return;
        }
        const detail = lastLine(stderr) || `exit code ${code ?? signal}`;
        finish(() =>
          reject(new TranscriptionFailedError(`Transcription failed: ${detail}`)),
        );
      });

      child.stdin?.on("error", () => {
        // The child may exit before we finish writing; the close handler reports it.
      });

      // whisper reads stdin until EOF, so this end() is required — without it
      // the process hangs forever.
      child.stdin?.end(Buffer.from(wav));
    });
  }

  /** Kills an in-flight transcription, e.g. the user cancelled or the app is quitting. */
  cancel(): void {
    this.child?.kill("SIGKILL");
    this.child = undefined;
  }
}

function cpuCount(): number {
  // Imported lazily so the module stays trivially testable.
  return require("node:os").cpus().length as number;
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
}
