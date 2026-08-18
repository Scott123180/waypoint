import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

import { CertificateTransport } from "../src/main/adapters/certificate-transport";

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
 * The second transport, and the one that proves the seam.
 *
 * It is deliberately unlike the first. Where the command transport fails with
 * an exit code and a stderr tail, this one fails with a TLS handshake, an HTTP
 * status, or a credential that is not where it was said to be. Two transports
 * whose failures arrive as different *kinds* of thing are what show the
 * failure taxonomy is a real abstraction rather than one implementation's
 * error type renamed (research R13, R14).
 *
 * **Key material is generated at run time, in a temp directory.** Nothing is
 * committed: a fixture certificate would expire, would be a private key in a
 * public repository, and would prove only that the transport works with
 * material one machine produced years ago. Generating it here means the suite
 * exercises whatever the running platform's OpenSSL actually emits — which is
 * the thing that differs between Linux and macOS (research R19).
 */

let dir: string;
let server: Server | undefined;
let endpoint: string;
let available = true;

/** What the server saw, so "the request crossed" is assertable. */
let received: string[] = [];
let reply = { status: 200, body: "{}" };

function openssl(...args: string[]): void {
  execFileSync("openssl", args, { stdio: "pipe" });
}

function generateMaterial(): void {
  const ca = (name: string) => join(dir, name);

  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", ca("ca.key"),
    "-out", ca("ca.pem"), "-days", "1", "-subj", "/CN=Waypoint Test CA");

  // A second, unrelated CA, so a client certificate the server does not trust
  // can be produced without touching the first.
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", ca("other-ca.key"),
    "-out", ca("other-ca.pem"), "-days", "1", "-subj", "/CN=Some Other CA");

  writeFileSync(ca("san.cnf"), "subjectAltName=DNS:localhost\n");

  for (const [name, subject, issuerKey, issuerCert, ext] of [
    ["server", "/CN=localhost", "ca.key", "ca.pem", true],
    ["client", "/CN=waypoint-client", "ca.key", "ca.pem", false],
    ["stranger", "/CN=stranger", "other-ca.key", "other-ca.pem", false],
  ] as const) {
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", ca(`${name}.key`),
      "-out", ca(`${name}.csr`), "-subj", subject);
    openssl("x509", "-req", "-in", ca(`${name}.csr`), "-CA", ca(issuerCert),
      "-CAkey", ca(issuerKey), "-CAcreateserial", "-out", ca(`${name}.pem`), "-days", "1",
      ...(ext ? ["-extfile", ca("san.cnf")] : []));
  }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-cert-"));
  try {
    generateMaterial();
  } catch {
    // No OpenSSL on this machine. Reported rather than silently skipped: a
    // suite that quietly stops covering the TLS path is the failure mode this
    // whole file exists to prevent.
    if (requireFixtures()) throw new Error("openssl is required here and was not usable");
    available = false;
    return;
  }

  server = createServer(
    {
      cert: readFileSync(join(dir, "server.pem")),
      key: readFileSync(join(dir, "server.key")),
      ca: readFileSync(join(dir, "ca.pem")),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        received.push(body);
        if (reply.status === 0) {
          // A socket closed mid-response. The headers and a partial body are
          // *flushed to the client* first, then the connection is destroyed —
          // which is what a real endpoint dying mid-answer looks like.
          //
          // The distinction matters: an endpoint that dies before sending
          // anything is indistinguishable from one that rejected our client
          // certificate, because both arrive as a bare `ECONNRESET`. What
          // separates them is whether an answer had begun.
          res.writeHead(200, { "content-type": "application/json" });
          res.flushHeaders();
          res.write('{ "partial":');
          setTimeout(() => res.destroy(), 25);
          return;
        }
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
      });
    },
  );

  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  endpoint = `https://localhost:${(server?.address() as AddressInfo).port}/v1/messages`;
});

after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  rmSync(dir, { recursive: true, force: true });
});

function transport(overrides: Partial<{ certificate: string; key: string; ca: string | null; endpoint: string }> = {}) {
  return new CertificateTransport({
    endpoint: overrides.endpoint ?? endpoint,
    certificate: overrides.certificate ?? join(dir, "client.pem"),
    key: overrides.key ?? join(dir, "client.key"),
    ca: overrides.ca === undefined ? join(dir, "ca.pem") : overrides.ca,
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("carrying the request out and the response back", () => {
  test("the request reaches the endpoint and the response comes back", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    received = [];
    reply = { status: 200, body: '{"pieces":[[0]],"nothingToSplit":false}' };

    const answer = await transport().send("a request the user previewed", signal());

    assert.equal(answer, '{"pieces":[[0]],"nothingToSplit":false}');
    assert.deepEqual(received, ["a request the user previewed"]);
  });

  test("cert, key, and ca are all honoured", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 200, body: "{}" };
    // Without the client certificate the server refuses the handshake, so a
    // success here is proof all three were used.
    assert.equal(await transport().send("x", signal()), "{}");
  });

  test("a unicode request crosses unchanged", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    received = [];
    reply = { status: 200, body: "{}" };

    const request = "café 🎉 日本語\nsecond line\n";
    await transport().send(request, signal());

    assert.deepEqual(received, [request]);
  });

  test("carries a name, for a failure message and the preview", () => {
    assert.match(transport().name, /certificate|https/i);
  });
});

describe("failures, as this transport produces them", () => {
  test("a credential that is not there names the path, and never material", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    const missing = join(dir, "not-installed-on-this-machine.pem");

    await assert.rejects(
      () => transport({ certificate: missing }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "credential");
        assert.match((err as Error).message, /not-installed-on-this-machine\.pem/);
        assert.doesNotMatch((err as Error).message, /BEGIN|PRIVATE KEY/, "material reached a message");
        return true;
      },
    );
  });

  test("a missing key is the same kind of failure", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    await assert.rejects(
      () => transport({ key: join(dir, "absent.key") }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "credential");
        assert.match((err as Error).message, /absent\.key/);
        return true;
      },
    );
  });

  test("a handshake the server rejects is a credential failure", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    // A real certificate, correctly formed, signed by a CA this server does
    // not trust. Nothing about the file is wrong; the relationship is.
    await assert.rejects(
      () => transport({ certificate: join(dir, "stranger.pem"), key: join(dir, "stranger.key") }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "credential");
        return true;
      },
    );
  });

  test("a server certificate we cannot verify is a credential failure", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    // No `ca`, and the server's certificate is privately issued.
    await assert.rejects(
      () => transport({ ca: null }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "credential");
        return true;
      },
    );
  });

  test("a non-2xx status is failed, and names the status", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 503, body: "upstream is down" };

    await assert.rejects(
      () => transport().send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "failed");
        assert.match((err as Error).message, /503/);
        return true;
      },
    );
  });

  test("a socket closed mid-response is failed", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 0, body: "" };

    await assert.rejects(
      () => transport().send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "failed");
        return true;
      },
    );
  });

  test("an endpoint nothing is listening on is unreachable", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    await assert.rejects(
      () => transport({ endpoint: "https://localhost:1/v1/messages" }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "unreachable");
        return true;
      },
    );
  });

  test("no failure message contains the request that was sent", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 500, body: "" };

    await assert.rejects(
      () => transport().send("a private dictation about a colleague", signal()),
      (err: unknown) => {
        assert.doesNotMatch((err as Error).message, /private dictation/);
        return true;
      },
    );
  });
});

describe("honouring the signal, which is core's", () => {
  test("an aborted signal destroys the request", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 200, body: "{}" };

    const controller = new AbortController();
    const pending = transport().send("x", controller.signal);
    controller.abort();

    await assert.rejects(() => pending, (err: unknown) => {
      assert.equal((err as { reason: string }).reason, "timed-out");
      return true;
    });
  });

  test("a signal already aborted never opens a connection", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    received = [];
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(() => transport().send("x", controller.signal));
    assert.deepEqual(received, [], "the request was sent despite an aborted signal");
  });

  test("this transport has no timeout of its own", () => {
    const source = readFileSync(
      resolve(__dirname, "..", "..", "src", "main", "adapters", "certificate-transport.ts"),
      "utf8",
    ).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    assert.ok(!source.includes("setTimeout"), "the transport armed a timer of its own");
    assert.ok(!source.includes("timeoutMs"), "the transport accepts a bound of its own");
  });
});

describe("credentials are read at call time, from their paths", () => {
  test("constructing with a path that does not exist is not itself an error", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    // A vault opened on a machine where the credential is not installed must
    // start normally and fail on the *first request*, reported — not fail at
    // startup, and not silently (FR-051c).
    const t2 = transport({ certificate: join(dir, "nope.pem") });
    assert.ok(t2, "constructing must not throw");
    await assert.rejects(() => t2.send("x", signal()));
  });

  test("a credential replaced between requests is picked up", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");
    reply = { status: 200, body: "{}" };
    const swappable = join(dir, "swappable.pem");
    const swappableKey = join(dir, "swappable.key");

    writeFileSync(swappable, readFileSync(join(dir, "stranger.pem")));
    writeFileSync(swappableKey, readFileSync(join(dir, "stranger.key")));
    const t2 = transport({ certificate: swappable, key: swappableKey });
    await assert.rejects(() => t2.send("x", signal()), "the stranger's certificate must be refused");

    // The user installs the right one. No restart.
    writeFileSync(swappable, readFileSync(join(dir, "client.pem")));
    writeFileSync(swappableKey, readFileSync(join(dir, "client.key")));
    assert.equal(await t2.send("x", signal()), "{}");
  });
});
