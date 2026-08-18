import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseIntelligenceConfig } from "@waypoint/core";

import { CertificateTransport } from "../src/main/adapters/certificate-transport";
import { CommandTransport } from "../src/main/adapters/command-transport";

/**
 * A missing or unusable `openssl` makes the TLS fixtures unbuildable, and the
 * cases that need them skip. That is right on a developer's machine and wrong
 * in CI: a silent skip on the platform a job exists to check makes the job
 * worthless while still showing green. `WAYPOINT_REQUIRE_TLS_FIXTURES` turns
 * the skip into a failure (008 research R19).
 */
function requireFixtures(): boolean {
  return process.env["WAYPOINT_REQUIRE_TLS_FIXTURES"] === "1";
}

/**
 * FR-051d: a message about a credential names the **path** and the problem,
 * and never the material.
 *
 * The failure this rules out is quiet and expensive. A message that quoted the
 * file it could not use would put a private key into a notice, then into a
 * screenshot, then into a bug report — and the user would have no idea it had
 * happened, because the message would look helpful.
 *
 * A path is what the user can act on. It is also all they need: the fix is
 * always "install the credential there, or point at where it actually is".
 */

let dir: string;
let available = true;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-cred-"));
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "real.key"),
        "-out", join(dir, "real.pem"), "-days", "1", "-subj", "/CN=Real"],
      { stdio: "pipe" },
    );
  } catch (err) {
    if (requireFixtures()) throw err;
    available = false;
  }
});

after(() => rmSync(dir, { recursive: true, force: true }));

function tmpdir(): string {
  return require("node:os").tmpdir() as string;
}

const signal = (): AbortSignal => new AbortController().signal;

/** Everything that looks like key material, in any encoding a message could carry. */
const MATERIAL = [
  /-----BEGIN/,
  /-----END/,
  /PRIVATE KEY/,
  /CERTIFICATE-----/,
  /MII[A-Za-z0-9+/]{20,}/, // a DER blob, base64-encoded
];

function assertNoMaterial(message: string, context: string): void {
  for (const pattern of MATERIAL) {
    assert.doesNotMatch(message, pattern, `${context} carried key material`);
  }
}

describe("a credential that cannot be read", () => {
  test("names the path, and says what is wrong with it", async () => {
    const missing = join(dir, "not-installed-here.pem");
    const transport = new CertificateTransport({
      endpoint: "https://llm.corp.example/v1/messages",
      certificate: missing,
      key: join(dir, "real.key"),
      ca: null,
    });

    await assert.rejects(
      () => transport.send("x", signal()),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.equal((err as { reason: string }).reason, "credential");
        assert.ok(message.includes(missing), "the message must name the path the user configured");
        assert.match(message, /is not there|could not be read/, "and what is wrong with it");
        assertNoMaterial(message, "a missing-certificate message");
        return true;
      },
    );
  });

  test("names the key's path when the key is the problem", async () => {
    const missing = join(dir, "absent.key");
    const transport = new CertificateTransport({
      endpoint: "https://llm.corp.example/v1/messages",
      certificate: join(dir, "real.pem"),
      key: missing,
      ca: null,
    });

    await assert.rejects(
      () => transport.send("x", signal()),
      (err: unknown) => {
        assert.ok((err as Error).message.includes(missing));
        assertNoMaterial((err as Error).message, "a missing-key message");
        return true;
      },
    );
  });

  test("a credential that exists but is unreadable is still named by path alone", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    const unreadable = join(dir, "unreadable.pem");
    writeFileSync(unreadable, readFileSync(join(dir, "real.pem")));
    try {
      require("node:fs").chmodSync(unreadable, 0o000);
    } catch {
      return t.skip("cannot make a file unreadable here");
    }

    // Running as root defeats the permission bit; the assertion below would
    // then be vacuous, so it is skipped rather than silently passing.
    let readable = true;
    try {
      readFileSync(unreadable);
    } catch {
      readable = false;
    }
    if (readable) return t.skip("running as root, so the permission bit means nothing");

    const transport = new CertificateTransport({
      endpoint: "https://llm.corp.example/v1/messages",
      certificate: unreadable,
      key: join(dir, "real.key"),
      ca: null,
    });

    await assert.rejects(
      () => transport.send("x", signal()),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.equal((err as { reason: string }).reason, "credential");
        assert.ok(message.includes(unreadable));
        assertNoMaterial(message, "an unreadable-certificate message");
        return true;
      },
    );
  });

  test("a real certificate's contents never appear, even when it is used", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    // Nothing is listening, so this fails — and the failure must not contain
    // the certificate that was successfully read a moment earlier.
    const transport = new CertificateTransport({
      endpoint: "https://localhost:1/v1/messages",
      certificate: join(dir, "real.pem"),
      key: join(dir, "real.key"),
      ca: null,
    });

    await assert.rejects(
      () => transport.send("x", signal()),
      (err: unknown) => {
        assertNoMaterial((err as Error).message, "an unreachable message");
        return true;
      },
    );
  });
});

describe("no message anywhere carries material", () => {
  test("not from the command transport either", async () => {
    const transport = new CommandTransport({
      command: join(dir, "definitely-not-installed"),
      args: [],
    });

    await assert.rejects(
      () => transport.send("x", signal()),
      (err: unknown) => {
        assertNoMaterial((err as Error).message, "an unreachable command message");
        return true;
      },
    );
  });

  test("and no configuration parse ever holds it", () => {
    const config = parseIntelligenceConfig(
      [
        "transport: certificate",
        "endpoint: https://llm.corp.example/v1",
        `certificate: ${join(dir, "real.pem")}`,
        `key: ${join(dir, "real.key")}`,
        "",
      ].join("\n"),
    );

    assert.equal(config.kind, "certificate");
    for (const value of Object.values(config)) assertNoMaterial(String(value), "a parsed config value");
  });
});

describe("the source itself cannot compose such a message", () => {
  /**
   * The transports read credentials into a `Buffer` and hand it straight to
   * `https.request`. Nothing may interpolate that value into a string — which
   * is what a template literal or a `toString()` on it would do.
   */
  test("neither transport interpolates a credential into a message", () => {
    for (const name of ["certificate-transport.ts", "command-transport.ts"]) {
      const source = readFileSync(resolve(__dirname, "..", "..", "src", "main", "adapters", name), "utf8")
        .replace(/\/\*\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      for (const forbidden of ["${cert}", "${key}", "${ca}", "cert.toString", "key.toString"]) {
        assert.ok(!source.includes(forbidden), `${name} interpolates ${forbidden} into a string`);
      }
    }
  });

  test("the adapters directory holds no committed key material", () => {
    const adapters = resolve(__dirname, "..", "..", "src", "main", "adapters");
    for (const entry of readdirSync(adapters)) {
      const content = readFileSync(join(adapters, entry), "utf8");
      assertNoMaterial(content, `${entry}`);
    }
  });
});
