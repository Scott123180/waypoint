import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

import type { Transport } from "@waypoint/core";

import { TransportError } from "./transport-error";

/**
 * Carries a request out over HTTPS, authenticated by a client certificate.
 *
 * `node:https.request` rather than `fetch`: client-certificate authentication
 * needs `cert`, `key`, and optionally `ca` on the request options, and Node's
 * `fetch` does not expose them without constructing a custom dispatcher —
 * more code, and a heavier commitment to a shape that may change. `node:https`
 * is the platform capability and adds nothing to either platform's build
 * (research R13).
 *
 * Chosen to be **unlike** the command transport. Its failures arrive as TLS
 * handshakes and HTTP statuses rather than exit codes and stderr tails, which
 * is what proves core's failure taxonomy is a real abstraction rather than one
 * implementation's error type renamed.
 *
 * **Credentials are read here, at call time, from their configured paths** —
 * never at parse time, and never copied into the vault. Three consequences,
 * all intended: a vault stays safe to commit, a machine without the credential
 * installed reports a `credential` failure on the first request rather than
 * failing at startup, and a message about a credential names the **path** and
 * the problem, never the material (FR-051c, FR-051d).
 *
 * **No timeout of its own.** The 120-second bound is core's (FR-066a).
 */
export interface CertificateTransportOptions {
  /** An `https://` URL. The parser has already refused anything else. */
  endpoint: string;
  /** Path to the client certificate. */
  certificate: string;
  /** Path to the private key. */
  key: string;
  /** Path to a trust anchor, for a privately-issued server certificate. */
  ca: string | null;
}

export class CertificateTransport implements Transport {
  readonly name: string;

  constructor(private readonly options: CertificateTransportOptions) {
    this.name = `certificate (${options.endpoint})`;
  }

  async send(request: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw aborted();

    // Read per request, so a credential installed or replaced between two
    // requests is picked up with no restart.
    const cert = readCredential(this.options.certificate, "client certificate");
    const key = readCredential(this.options.key, "private key");
    const ca = this.options.ca === null ? undefined : readCredential(this.options.ca, "trust anchor");

    const body = Buffer.from(request, "utf8");

    return await new Promise<string>((resolve, reject) => {
      /**
       * Whether the endpoint ever answered.
       *
       * This is what separates `credential` from `failed`, and it has to be:
       * a server rejecting our client certificate and a server closing the
       * socket mid-answer *both* surface as `ECONNRESET`, "socket hang up".
       * The error code cannot tell them apart. What can is whether a response
       * ever began — a rejected certificate never produces one, because the
       * rejection happens before any request is answered.
       */
      let answered = false;
      let settled = false;

      const req = httpsRequest(
        this.options.endpoint,
        {
          method: "POST",
          cert,
          key,
          ...(ca === undefined ? {} : { ca }),
          headers: {
            "content-type": "application/json",
            "content-length": String(body.byteLength),
          },
        },
        (res) => {
          answered = true;
          const status = res.statusCode ?? 0;
          let answer = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (answer += chunk));

          res.on("end", () => {
            if (status < 200 || status >= 300) {
              return finish(() =>
                reject(
                  new TransportError(
                    "failed",
                    `The endpoint answered ${status}. Nothing was changed.`,
                  ),
                ),
              );
            }
            finish(() => resolve(answer));
          });

          // Closed after the headers but before the body finished.
          res.on("aborted", () =>
            finish(() =>
              reject(
                new TransportError(
                  "failed",
                  "The connection closed before the answer finished. Nothing was changed.",
                ),
              ),
            ),
          );
        },
      );

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
      };

      function onAbort(): void {
        req.destroy();
        finish(() => reject(aborted()));
      }

      signal.addEventListener("abort", onAbort, { once: true });

      req.on("error", (err) => {
        finish(() => reject(classify(err, answered, this.options.endpoint)));
      });

      req.end(body);
    });
  }
}

/**
 * Reads one credential, or reports the **path** that could not be read.
 *
 * The message names where the file was expected and what went wrong with it.
 * It never contains a byte of the file: a message that quoted the material
 * would put a private key into a notice, a log, and a screenshot.
 */
function readCredential(path: string, what: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT" ? "is not there" : code === "EACCES" ? "could not be read" : "could not be used";
    throw new TransportError(
      "credential",
      `The ${what} at ${path} ${detail}. Suggestions are unavailable; sorting is unaffected.`,
    );
  }
}

function aborted(): TransportError {
  return new TransportError("timed-out", "The request was stopped. Nothing was changed.");
}

/** Connection-level codes: nothing was listening, or the name did not resolve. */
const UNREACHABLE = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
];

function classify(err: NodeJS.ErrnoException, answered: boolean, endpoint: string): TransportError {
  if (err.name === "AbortError") return aborted();

  // The endpoint had begun answering, so whatever went wrong went wrong after
  // the certificate was accepted. Sending the user to check their certificate
  // here would send them to the wrong file.
  if (answered) {
    return new TransportError(
      "failed",
      `The connection to ${endpoint} closed before the answer finished (${err.code ?? err.message}). ` +
        `Nothing was changed.`,
    );
  }

  if (UNREACHABLE.includes(err.code ?? "")) {
    return new TransportError(
      "unreachable",
      `Could not reach ${endpoint}: ${err.code}. Sort by hand; nothing was changed.`,
    );
  }

  // Reached, never answered. Either we would not trust the server's
  // certificate — which arrives as a named `*_CERT_*` code — or the server
  // would not accept ours, which arrives as a bare socket reset. Both are the
  // certificate relationship, and both send the user to the same two lines of
  // `intelligence.md`.
  return new TransportError(
    "credential",
    `${endpoint} closed the connection without answering (${err.code ?? err.message}). ` +
      `Check the certificate and key named in intelligence.md; nothing was changed.`,
  );
}
