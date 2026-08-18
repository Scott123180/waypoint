import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { INTELLIGENCE_PATH, parseIntelligenceConfig } from "../src/suggest/intelligence-config";

/**
 * `intelligence.md` — the one setting a user changes when they move machines.
 *
 * Two things this file must get right and nothing else may relax:
 *
 *   - **Absent means off, silently.** No file, or a file naming no transport,
 *     is the shipped state and the state of every vault that exists today. No
 *     problem is reported, because a user who has never heard of this feature
 *     must not learn of it by being asked to configure it (FR-054, FR-060).
 *   - **A problem blocks nothing.** An unusable file reports one message that
 *     names the line to fix, leaves the layer off, and leaves sorting,
 *     capture, projects, the review, and the retrospective untouched (FR-055).
 *
 * See specs/008-llm-assisted-inbox-organization/contracts/intelligence-config.md
 */

const COMMAND_FILE = [
  "# Intelligence",
  "",
  "transport: command",
  "command: claude",
  "",
  "## Arguments",
  "",
  "- -p",
  "- --output-format",
  "- text",
  "",
].join("\n");

const CERTIFICATE_FILE = [
  "# Intelligence",
  "",
  "transport: certificate",
  "endpoint: https://llm.corp.example/v1/messages",
  "certificate: /home/me/.certs/waypoint-client.pem",
  "key: /home/me/.certs/waypoint-client.key",
  "",
].join("\n");

describe("intelligence.md lives beside policy.md and identity.md", () => {
  test("at a vault-relative path, never an absolute one", () => {
    assert.equal(INTELLIGENCE_PATH, "intelligence.md");
  });
});

describe("absent means off, silently", () => {
  test("no file at all is the shipped state", () => {
    const config = parseIntelligenceConfig(null);
    assert.equal(config.kind, "off");
  });

  test("a file naming no transport is also off, and is not a problem", () => {
    const config = parseIntelligenceConfig("# Intelligence\n\nsome notes I wrote to myself\n");
    assert.equal(config.kind, "off");
  });

  test("an empty file is off", () => {
    assert.equal(parseIntelligenceConfig("").kind, "off");
  });

  test("off carries no message, so a client has nothing to render", () => {
    const config = parseIntelligenceConfig(null);
    assert.equal("message" in config, false, "off must not carry a message to show");
  });
});

describe("the command transport", () => {
  test("parses its command and its arguments in list order", () => {
    const config = parseIntelligenceConfig(COMMAND_FILE);
    assert.equal(config.kind, "command");
    assert.equal(config.kind === "command" && config.command, "claude");
    assert.deepEqual(config.kind === "command" && config.args, ["-p", "--output-format", "text"]);
  });

  test("an absent Arguments section means no arguments, not a problem", () => {
    const config = parseIntelligenceConfig("transport: command\ncommand: claude\n");
    assert.equal(config.kind, "command");
    assert.deepEqual(config.kind === "command" && config.args, []);
  });

  test("an argument containing a space survives, which is why it is a list", () => {
    const config = parseIntelligenceConfig(
      ["transport: command", "command: claude", "", "## Arguments", "", "- --system-prompt", "- be brief and exact", ""].join("\n"),
    );
    assert.deepEqual(config.kind === "command" && config.args, ["--system-prompt", "be brief and exact"]);
  });

  test("a missing command names the key and the transport that needs it", () => {
    const config = parseIntelligenceConfig("transport: command\n");
    assert.equal(config.kind, "problem");
    const message = config.kind === "problem" ? config.message : "";
    assert.match(message, /command/);
    assert.match(message, /intelligence\.md/);
  });
});

describe("the certificate transport", () => {
  test("parses its endpoint and its credential paths", () => {
    const config = parseIntelligenceConfig(CERTIFICATE_FILE);
    assert.equal(config.kind, "certificate");
    if (config.kind !== "certificate") return;
    assert.equal(config.endpoint, "https://llm.corp.example/v1/messages");
    assert.equal(config.certificate, "/home/me/.certs/waypoint-client.pem");
    assert.equal(config.key, "/home/me/.certs/waypoint-client.key");
  });

  test("ca is optional, because it is needed only for a private CA", () => {
    const without = parseIntelligenceConfig(CERTIFICATE_FILE);
    assert.equal(without.kind === "certificate" && without.ca, null);

    const with_ = parseIntelligenceConfig(`${CERTIFICATE_FILE}ca: /etc/ssl/corp/root.pem\n`);
    assert.equal(with_.kind === "certificate" && with_.ca, "/etc/ssl/corp/root.pem");
  });

  test("each missing required parameter names the key and the transport", () => {
    for (const omitted of ["endpoint", "certificate", "key"]) {
      const content = CERTIFICATE_FILE.split("\n")
        .filter((line) => !line.startsWith(`${omitted}:`))
        .join("\n");
      const config = parseIntelligenceConfig(content);
      assert.equal(config.kind, "problem", `omitting ${omitted} must be a problem`);
      const message = config.kind === "problem" ? config.message : "";
      assert.match(message, new RegExp(omitted), `the message must name ${omitted}`);
      assert.match(message, /certificate/, "the message must name the transport that needs it");
    }
  });

  test("an http:// endpoint is refused, and the message says HTTPS is required", () => {
    const config = parseIntelligenceConfig(
      CERTIFICATE_FILE.replace("https://", "http://"),
    );
    assert.equal(config.kind, "problem");
    assert.match(config.kind === "problem" ? config.message : "", /HTTPS/i);
  });

  test("a value that is not a URL at all is refused rather than passed to the transport", () => {
    const config = parseIntelligenceConfig(CERTIFICATE_FILE.replace("https://llm.corp.example/v1/messages", "not a url"));
    assert.equal(config.kind, "problem");
  });
});

describe("an unrecognised transport", () => {
  test("names the value read and both values that work", () => {
    const config = parseIntelligenceConfig("transport: copilot\n");
    assert.equal(config.kind, "problem");
    const message = config.kind === "problem" ? config.message : "";
    assert.match(message, /copilot/, "the message must name what was read");
    assert.match(message, /command/, "the message must name the values that work");
    assert.match(message, /certificate/);
  });

  test("reports exactly one problem, never a list", () => {
    const config = parseIntelligenceConfig("transport: copilot\nendpoint: http://nope\n");
    assert.equal(config.kind, "problem");
    // One string, not an array: the file is rejected per-file, not per-value,
    // because a transport missing its endpoint cannot be half-used and falling
    // back to another would be the probing FR-052 forbids.
    assert.equal(typeof (config.kind === "problem" ? config.message : null), "string");
  });
});

describe("hand-editing tolerance, the same the vault's other config files allow", () => {
  test("keys are case-insensitive and spacing is forgiving", () => {
    const config = parseIntelligenceConfig("Transport:command\nCommand:   claude\n");
    assert.equal(config.kind, "command");
    assert.equal(config.kind === "command" && config.command, "claude");
  });

  test("a leading heading and blank lines are ignored, as in identity.md", () => {
    const config = parseIntelligenceConfig("# Intelligence\n\n\ntransport: command\n\ncommand: claude\n");
    assert.equal(config.kind, "command");
  });
});
