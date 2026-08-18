import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

import {
  SortService,
  SuggestionService,
  catalogOf,
  createDefaultIntelligence,
  parseIntelligenceConfig,
  type Transport,
  type VaultStore,
} from "@waypoint/core";

import { CertificateTransport } from "../src/main/adapters/certificate-transport";
import { CommandTransport } from "../src/main/adapters/command-transport";
import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { FsSortJournal } from "../src/main/adapters/fs-sort-journal";
import { FsVaultStore } from "../src/main/adapters/fs-vault-store";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault, type TempVault } from "./vault-fixture";

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
 * SC-009a: the data directory stays safe to commit.
 *
 * Not "we were careful" — a property of the format. `intelligence.md` has no
 * field a private key could be written into, and the transports read
 * credentials from their configured paths at call time and never copy them
 * anywhere. So after exercising **both** transports against a real vault, a
 * scan of every byte in it finds nothing secret.
 *
 * This is the test a user would want to run before `git push`, and it is
 * written to be exactly that: walk the whole directory, read every file, and
 * look for anything that looks like material.
 */

const FAKE_CLI = resolve(__dirname, "fixtures/fake-llm-cli.sh");

let certDir: string;
let server: Server | undefined;
let endpoint = "";
let available = true;

const ANSWER = '{"pieces":[[0],[1]],"nothingToSplit":false}';

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), "waypoint-secrets-"));
  const p = (n: string): string => join(certDir, n);

  try {
    const openssl = (...args: string[]): void => {
      execFileSync("openssl", args, { stdio: "pipe" });
    };
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"), "-out", p("ca.pem"),
      "-days", "1", "-subj", "/CN=Secrets CA");
    writeFileSync(p("san.cnf"), "subjectAltName=DNS:localhost\n");
    for (const [name, subject, ext] of [
      ["server", "/CN=localhost", true],
      ["client", "/CN=waypoint-client", false],
    ] as const) {
      openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", p(`${name}.key`), "-out", p(`${name}.csr`),
        "-subj", subject);
      openssl("x509", "-req", "-in", p(`${name}.csr`), "-CA", p("ca.pem"), "-CAkey", p("ca.key"),
        "-CAcreateserial", "-out", p(`${name}.pem`), "-days", "1",
        ...(ext ? ["-extfile", p("san.cnf")] : []));
    }
  } catch {
    if (requireFixtures()) throw new Error("openssl is required here and was not usable");
    available = false;
    return;
  }

  server = createServer(
    {
      cert: readFileSync(p("server.pem")),
      key: readFileSync(p("server.key")),
      ca: readFileSync(p("ca.pem")),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(ANSWER);
      });
    },
  );

  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  endpoint = `https://localhost:${(server?.address() as AddressInfo).port}/v1/messages`;
});

after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  rmSync(certDir, { recursive: true, force: true });
});

/** Anything that looks like material, in any encoding a file could carry. */
const MATERIAL: { name: string; pattern: RegExp }[] = [
  { name: "a PEM header", pattern: /-----BEGIN/ },
  { name: "a PEM footer", pattern: /-----END/ },
  { name: "a private key", pattern: /PRIVATE KEY/ },
  { name: "a certificate body", pattern: /CERTIFICATE-----/ },
  { name: "a base64 DER blob", pattern: /MII[A-Za-z0-9+/]{40,}/ },
  { name: "an API-key-shaped token", pattern: /\b(sk|pk)-[A-Za-z0-9_-]{16,}/ },
];

/** Every file under the vault, recursively, with its bytes. */
function everyFile(root: string, prefix = ""): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...everyFile(full, relative));
    else if (statSync(full).isFile()) out.push({ path: relative, content: readFileSync(full, "utf8") });
  }
  return out;
}

function buildVault(config: string): TempVault {
  const vault = makeTempVault();
  vault.write("inbox.md", "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof.\n");
  vault.write("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n\n## Outcome\n\nSurvives a winter.\n");
  vault.write("areas/home.md", "# Home\n\nstatus: active\n");
  vault.write("intelligence.md", config);
  return vault;
}

function transportFrom(vault: TempVault): Transport {
  const config = parseIntelligenceConfig(vault.read("intelligence.md"));
  switch (config.kind) {
    case "command":
      return new CommandTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, FAKE_LLM_OUTPUT: ANSWER } as NodeJS.ProcessEnv,
      });
    case "certificate":
      return new CertificateTransport({
        endpoint: config.endpoint,
        certificate: config.certificate,
        key: config.key,
        ca: config.ca,
      });
    default:
      throw new Error(`the fixture config did not parse: ${config.kind}`);
  }
}

/** A full ask-preview-run-accept cycle, so the credentials are genuinely used. */
async function exercise(vault: TempVault): Promise<void> {
  const store = new FsVaultStore(vault.root);
  const sort = new SortService({
    inbox: new FsInboxDocument(vault.inboxPath, new InboxMutex()),
    vault: store,
    journal: new FsSortJournal(vault.path("sort-journal.json")),
  });
  const suggest = new SuggestionService({
    catalog: catalogOf(store as VaultStore),
    intelligence: createDefaultIntelligence(transportFrom(vault)),
  });

  const item = await sort.next();
  assert.ok(item, "the fixture must hold an item");

  const prepared = await suggest.prepareSplit(item);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const outcome = await prepared.prepared.run();
  assert.equal(outcome.ok, true, "the transport must actually work, or this proves nothing");
  if (!outcome.ok) return;

  const written = await sort.split(item.ref, outcome.proposal.pieces.map((p) => p.text.trim()));
  assert.equal(written.ok, true);
}

const CONFIGS = () => [
  {
    name: "the command transport",
    content: `# Intelligence\n\ntransport: command\ncommand: ${FAKE_CLI}\n`,
  },
  {
    name: "the certificate transport",
    content: [
      "# Intelligence",
      "",
      "transport: certificate",
      `endpoint: ${endpoint}`,
      `certificate: ${join(certDir, "client.pem")}`,
      `key: ${join(certDir, "client.key")}`,
      `ca: ${join(certDir, "ca.pem")}`,
      "",
    ].join("\n"),
  },
];

describe("after exercising both transports, the vault holds nothing secret", () => {
  for (const index of [0, 1]) {
    test(`under ${["the command transport", "the certificate transport"][index]}`, async (t) => {
      if (!available) return t.skip("openssl is not available on this machine");

      const config = CONFIGS()[index];
      assert.ok(config);
      const vault = buildVault(config.content);

      try {
        await exercise(vault);

        const files = everyFile(vault.root);
        assert.ok(files.length >= 4, "the fixture must have files to scan");

        for (const file of files) {
          for (const { name, pattern } of MATERIAL) {
            assert.doesNotMatch(file.content, pattern, `${file.path} contains ${name}`);
          }
        }
      } finally {
        vault.cleanup();
      }
    });
  }

  test("the scan would catch material if any were there", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    // Without this, a bug in `everyFile` or in the patterns would make every
    // assertion above a tautology.
    const vault = buildVault(`transport: command\ncommand: ${FAKE_CLI}\n`);
    try {
      vault.write("oops.md", readFileSync(join(certDir, "client.key"), "utf8"));

      const files = everyFile(vault.root);
      const offenders = files.filter((f) => MATERIAL.some((m) => m.pattern.test(f.content)));

      assert.deepEqual(
        offenders.map((f) => f.path),
        ["oops.md"],
        "the scan does not detect key material it is looking straight at",
      );
    } finally {
      vault.cleanup();
    }
  });
});

describe("nothing is required to be secret either", () => {
  test("intelligence.md carries paths, an address, and a command — and nothing more", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    for (const config of CONFIGS()) {
      const vault = buildVault(config.content);
      try {
        await exercise(vault);

        const content = vault.read("intelligence.md");
        // Byte-identical to what was written. Nothing about using a credential
        // rewrites the file that names it.
        assert.equal(content, config.content, `${config.name} rewrote its own configuration`);

        // A vault committed and pushed carries a command, an address, and a
        // path. Nothing secret travels with it (FR-051b).
        for (const { pattern } of MATERIAL) assert.doesNotMatch(content, pattern);
      } finally {
        vault.cleanup();
      }
    }
  });

  test("no credential is copied into the vault by using it", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    const config = CONFIGS()[1];
    assert.ok(config);
    const vault = buildVault(config.content);

    try {
      const before = everyFile(vault.root).map((f) => f.path).sort();
      await exercise(vault);
      const after = everyFile(vault.root).map((f) => f.path).sort();

      // The only new path is the sort journal, which sorting already wrote.
      assert.deepEqual(
        after.filter((p) => !before.includes(p)),
        [],
        "using a credential created a file in the vault",
      );
    } finally {
      vault.cleanup();
    }
  });
});
