import { spawn, type ChildProcess } from "node:child_process";

import type { Transport } from "@waypoint/core";

import { TransportError } from "./transport-error";

/**
 * Carries a request out by spawning a command-line tool.
 *
 * The request goes on **stdin** and the response is read from **stdout**, the
 * shape `WhisperAdapter` proved. Not on argv: argument lists have length
 * limits that a long dictation plus a project catalogue can approach, and a
 * request on the command line appears in the process table for anyone on the
 * machine to read (research R13).
 *
 * It knows nothing about what it is carrying. There is no mention of a
 * project, an item, or a destination anywhere below — a transport that knew
 * what it carried would be an intelligence module wearing the wrong interface.
 *
 * **No timeout of its own.** The 120-second bound is core's, armed once and
 * delivered as an `AbortSignal`. Two transports each with a timer would be two
 * numbers that could drift (FR-066a, research R15).
 */
export interface CommandTransportOptions {
  /** Absolute path, or a bare name for the platform to resolve. */
  command: string;
  /** Passed in list order. */
  args: string[];
  /** Test seam, matching `WhisperAdapterOptions`. */
  env?: NodeJS.ProcessEnv;
}

export class CommandTransport implements Transport {
  readonly name: string;

  constructor(private readonly options: CommandTransportOptions) {
    this.name = `command (${options.command})`;
  }

  async send(request: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw aborted();

    return await new Promise<string>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(this.options.command, this.options.args, {
          stdio: ["pipe", "pipe", "pipe"],
          ...(this.options.env ? { env: this.options.env } : {}),
        });
      } catch (err) {
        // Some spawn failures are synchronous rather than an "error" event.
        return reject(unreachable(this.options.command, err));
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
      };

      function onAbort(): void {
        // SIGKILL rather than SIGTERM: a wedged tool that ignores a polite
        // signal would keep the stdio pipes open, and the user has already
        // said they are done waiting.
        child.kill("SIGKILL");
        finish(() => reject(aborted()));
      }

      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

      child.on("error", (err) => {
        finish(() => reject(unreachable(this.options.command, err)));
      });

      child.on("close", (code, sig) => {
        if (code === 0) {
          // A real tool logs progress to stderr on success, so only the exit
          // code counts — the judgement `WhisperAdapter` already makes.
          finish(() => resolve(stdout));
          return;
        }
        const detail = lastLine(stderr) || `exit code ${code ?? sig}`;
        finish(() =>
          reject(
            new TransportError(
              "failed",
              `The tool exited without answering: ${detail}. Nothing was changed.`,
            ),
          ),
        );
      });

      child.stdin?.on("error", () => {
        // The child may exit before we finish writing; `close` reports it.
      });

      // Required: the tool reads until EOF, and without this it waits forever.
      child.stdin?.end(request, "utf8");
    });
  }
}

function aborted(): TransportError {
  return new TransportError("timed-out", "The request was stopped. Nothing was changed.");
}

function unreachable(command: string, err: unknown): TransportError {
  const detail = (err as NodeJS.ErrnoException).code === "ENOENT" ? "not found" : String((err as Error).message);
  return new TransportError(
    "unreachable",
    `Could not run \`${command}\`: ${detail}. Sort by hand; nothing was changed.`,
  );
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
}
