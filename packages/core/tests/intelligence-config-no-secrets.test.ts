import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseIntelligenceConfig } from "../src/suggest/intelligence-config";

/**
 * The data directory stays safe to commit — as a property of the format, not
 * as a warning in the documentation (FR-051b, FR-051c).
 *
 * Two claims, and neither is about discipline:
 *
 *   - **There is no field a private key could be written into.** The parsed
 *     shape's keys are enumerated here, so adding a `keyMaterial` field would
 *     fail this test rather than pass review.
 *   - **Parsing performs no filesystem read.** `parseIntelligenceConfig` takes
 *     content, not a path, so a credential path is an opaque string to it. The
 *     transport resolves and reads it at call time, which is what makes a
 *     vault opened on a machine without the credential produce a reported
 *     `credential` failure on the first request rather than a silent one at
 *     startup.
 */

const CERTIFICATE_FILE = [
  "transport: certificate",
  "endpoint: https://llm.corp.example/v1/messages",
  "certificate: /home/me/.certs/waypoint-client.pem",
  "key: /home/me/.certs/waypoint-client.key",
  "ca: /etc/ssl/corp/root.pem",
  "",
].join("\n");

describe("nothing here is secret, and nothing here can become secret", () => {
  test("the certificate config carries exactly the allowed keys, and no others", () => {
    const config = parseIntelligenceConfig(CERTIFICATE_FILE);
    assert.equal(config.kind, "certificate");
    assert.deepEqual(
      Object.keys(config).sort(),
      ["ca", "certificate", "endpoint", "key", "kind"],
      "a new field here is a new place a secret could be written",
    );
  });

  test("the command config carries exactly the allowed keys, and no others", () => {
    const config = parseIntelligenceConfig("transport: command\ncommand: claude\n");
    assert.deepEqual(Object.keys(config).sort(), ["args", "command", "kind"]);
  });

  test("certificate, key, and ca are carried as the paths they were written as", () => {
    const config = parseIntelligenceConfig(CERTIFICATE_FILE);
    if (config.kind !== "certificate") return assert.fail("expected a certificate config");

    // Byte-identical to the file. Not resolved, not normalised, not read — a
    // value that had been read would no longer be the path the user wrote, and
    // a failure message that named it would name material instead (FR-051d).
    assert.equal(config.certificate, "/home/me/.certs/waypoint-client.pem");
    assert.equal(config.key, "/home/me/.certs/waypoint-client.key");
    assert.equal(config.ca, "/etc/ssl/corp/root.pem");
  });

  test("no value in a parsed config looks like key material", () => {
    const config = parseIntelligenceConfig(CERTIFICATE_FILE);
    for (const value of Object.values(config)) {
      assert.doesNotMatch(
        String(value),
        /-----BEGIN|PRIVATE KEY/,
        "a parsed value carried material rather than a reference to it",
      );
    }
  });
});

describe("parsing reads nothing from disk", () => {
  test("a credential path that does not exist still parses, because nothing checked", () => {
    const config = parseIntelligenceConfig(
      CERTIFICATE_FILE.replace(/\/home\/me\/\.certs\//g, "/nonexistent/definitely-not-here/"),
    );
    // Had parsing verified the paths, this would be a `problem`. It is not:
    // an absent credential is the transport's failure to report, at call time.
    assert.equal(config.kind, "certificate");
  });

  test("the compiled module imports no filesystem capability at all", () => {
    const compiled = readFileSync(
      join(__dirname, "..", "..", "dist", "src", "suggest", "intelligence-config.js"),
      "utf8",
    );
    for (const needle of ["node:fs", '"fs"', "node:fs/promises", "readFile", "existsSync"]) {
      assert.ok(!compiled.includes(needle), `intelligence-config references ${needle}`);
    }
  });

  test("the parser takes content, so there is no path for it to read", () => {
    // Arity is the structural form of the claim: a function that took a path
    // would need a store to read it with, and there is nowhere to inject one.
    assert.equal(parseIntelligenceConfig.length, 1);
  });
});
