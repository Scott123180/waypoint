import type { SuggestionFailure } from "@waypoint/core";

/**
 * A transport failure, already mapped onto core's taxonomy.
 *
 * The mapping happens here, at the edge, because only the transport knows what
 * an `ENOENT` from `spawn` or a `CERT_HAS_EXPIRED` from TLS actually means.
 * Core reads the `reason` and believes it — a transport cannot invent a value
 * outside the union, because the union is core's type (research R14).
 *
 * The message is written for display and **never contains the request or any
 * credential material** — only a path, a status, or a stderr tail (FR-051d).
 */
export class TransportError extends Error {
  constructor(
    readonly reason: SuggestionFailure,
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}
