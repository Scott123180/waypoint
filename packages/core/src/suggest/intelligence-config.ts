/**
 * `intelligence.md` — which transport carries a request, and nothing else.
 *
 * Lives in the git-tracked data directory beside `policy.md` and
 * `identity.md`, read with the same preamble helpers, so it reads with the
 * mental model the user already has (research R16).
 *
 * Three properties are load-bearing:
 *
 *   - **Absent means off, silently.** No file, or a file naming no transport,
 *     is the shipped state. Nothing is reported and no affordance is rendered.
 *   - **A problem blocks nothing.** One message naming the line to fix; the
 *     layer goes off and every other capability is untouched.
 *   - **Nothing here is secret, and nothing here can become secret.**
 *     `certificate`, `key`, and `ca` are *paths*. There is no field whose
 *     value is key material, which is what makes "the data directory stays
 *     safe to commit" a property of the format rather than a warning
 *     (FR-051b). The paths are resolved and read by the transport at call
 *     time, never here — this module performs no I/O at all (FR-051c).
 *
 * See specs/008-llm-assisted-inbox-organization/contracts/intelligence-config.md
 */

import { readField, readListSection } from "../vault/preamble";

/** Vault-relative, like `IDENTITY_PATH` and `TOP_THREE_PATH`. */
export const INTELLIGENCE_PATH = "intelligence.md";

/**
 * The two transports that ship, as a value so the set is assertable and so
 * selection is a `switch` over a closed union rather than a lookup.
 *
 * There is deliberately no third, no fallback, and no discovery: falling back
 * is a choice the user did not make, and on a work machine the fallback is the
 * one that is blocked (FR-057, FR-058).
 */
export const TRANSPORTS = ["command", "certificate"] as const;

export type TransportName = (typeof TRANSPORTS)[number];

/**
 * A closed result. `off` and `problem` are different states on purpose: one is
 * the shipped default and says nothing, the other is a file the user wrote
 * that cannot be used and names the line to fix.
 */
export type IntelligenceConfig =
  | { kind: "off" }
  | { kind: "problem"; message: string }
  | { kind: "command"; command: string; args: string[] }
  | {
      kind: "certificate";
      endpoint: string;
      /** A path. Never material. */
      certificate: string;
      /** A path. Never material. */
      key: string;
      /** A path, or null. Needed only for a privately-issued server certificate. */
      ca: string | null;
    };

/**
 * @param content the file's bytes, or null when it does not exist.
 *
 * Takes content rather than a path, so this module cannot read a file — the
 * credential paths it carries are opaque strings to it (FR-051c).
 */
export function parseIntelligenceConfig(content: string | null): IntelligenceConfig {
  if (content === null || content.trim().length === 0) return { kind: "off" };

  const named = readField(content, "transport");
  // No transport line is the shipped state, not a mistake worth reporting.
  if (named === null) return { kind: "off" };

  const transport = named.toLowerCase();
  if (!isTransportName(transport)) {
    return problem(
      `names \`transport: ${named}\`, which is not a transport Waypoint has. ` +
        `The transports that work are \`command\` and \`certificate\`.`,
    );
  }

  return transport === "command" ? parseCommand(content) : parseCertificate(content);
}

function isTransportName(value: string): value is TransportName {
  return (TRANSPORTS as readonly string[]).includes(value);
}

function parseCommand(content: string): IntelligenceConfig {
  const command = readField(content, "command");
  if (command === null) return missing("command", "command");

  // A list rather than a space-separated field: splitting on spaces is lossy
  // for an argument that contains one, and `identity.md`'s `## Aliases`
  // already teaches that a list of things is a list section.
  return { kind: "command", command, args: readListSection(content, "Arguments") };
}

function parseCertificate(content: string): IntelligenceConfig {
  const endpoint = readField(content, "endpoint");
  if (endpoint === null) return missing("endpoint", "certificate");

  const url = parseUrl(endpoint);
  if (url === null) {
    return problem(`has \`endpoint: ${endpoint}\`, which is not a URL.`);
  }
  if (url.protocol !== "https:") {
    return problem(
      `has \`endpoint: ${endpoint}\`. The \`certificate\` transport requires HTTPS, ` +
        `because client-certificate authentication is part of the TLS handshake.`,
    );
  }

  const certificate = readField(content, "certificate");
  if (certificate === null) return missing("certificate", "certificate");

  const key = readField(content, "key");
  if (key === null) return missing("key", "certificate");

  return { kind: "certificate", endpoint, certificate, key, ca: readField(content, "ca") };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function missing(key: string, transport: TransportName): IntelligenceConfig {
  return problem(
    `sets \`transport: ${transport}\` but has no \`${key}:\` line. ` +
      `The \`${transport}\` transport needs one.`,
  );
}

/**
 * One problem, per file rather than per value.
 *
 * `policy.md` falls back per value, because a typo in one rule must not
 * silently restore a different default for another. Here the opposite is
 * right: a transport missing its endpoint cannot be half-used, and falling
 * back to some other transport would be the environment-probing FR-052
 * forbids. The layer goes off, and the user is told which line to fix.
 */
function problem(detail: string): IntelligenceConfig {
  return {
    kind: "problem",
    message: `${INTELLIGENCE_PATH} ${detail} Suggestions are off; sorting is unaffected.`,
  };
}
