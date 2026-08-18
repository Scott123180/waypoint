import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

import {
  SuggestionService,
  catalogOf,
  createDefaultIntelligence,
  parseIntelligenceConfig,
  type Transport,
  type VaultStore,
} from "@waypoint/core";

import { CommandTransport } from "../src/main/adapters/command-transport";
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
 * FR-050 and SC-009: changing machines means changing one setting.
 *
 * One suggestion suite, run twice, against the two transports — with **only
 * the configured value differing**. Identical stubbed responses must produce
 * identical proposals, and the same acceptance path.
 *
 * This is the test the whole two-seam design exists to make possible. If the
 * two runs ever diverge, something about *what a proposal is* has leaked into
 * *how a model is reached*, which is the one thing the seam is for.
 */

const FAKE_CLI = resolve(__dirname, "fixtures/fake-llm-cli.sh");

let dir: string;
let server: Server | undefined;
let endpoint: string;
let available = true;

/** What the HTTPS transport should answer with, set per case. */
let reply = "{}";

const VAULT: Record<string, string> = {
  "projects/vendor-consolidation.md":
    "# Vendor Consolidation\n\nstatus: active\n\n## Outcome\n\nEvery contract renewed by Q4.\n",
  "projects/roof-repair.md": "# Roof repair\n\nstatus: active\n\n## Outcome\n\nSurvives a winter.\n",
  "areas/home.md": "# Home\n\nstatus: active\n",
};

function vaultStore(): Pick<VaultStore, "list" | "read"> {
  return {
    list: (d) =>
      Promise.resolve(
        Object.keys(VAULT)
          .filter((p) => p.startsWith(`${d}/`))
          .map((p) => p.slice(d.length + 1, -3))
          .sort(),
      ),
    read: (p) => Promise.resolve(VAULT[p] ?? null),
  };
}

function openssl(...args: string[]): void {
  execFileSync("openssl", args, { stdio: "pipe" });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-parity-"));
  chmodSync(FAKE_CLI, 0o755);

  try {
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "ca.key"),
      "-out", join(dir, "ca.pem"), "-days", "1", "-subj", "/CN=Parity CA");
    writeFileSync(join(dir, "san.cnf"), "subjectAltName=DNS:localhost\n");
    for (const [name, subject, ext] of [
      ["server", "/CN=localhost", true],
      ["client", "/CN=waypoint-client", false],
    ] as const) {
      openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${name}.key`),
        "-out", join(dir, `${name}.csr`), "-subj", subject);
      openssl("x509", "-req", "-in", join(dir, `${name}.csr`), "-CA", join(dir, "ca.pem"),
        "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, `${name}.pem`),
        "-days", "1", ...(ext ? ["-extfile", join(dir, "san.cnf")] : []));
    }
  } catch {
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
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(reply);
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

/**
 * The two `intelligence.md` files, and nothing else that differs.
 *
 * Built through the real parser and the real `switch`, so this exercises the
 * selection path rather than constructing transports directly — the point is
 * that *one setting* is what changes.
 */
function transportFor(kind: "command" | "certificate"): Transport {
  const content =
    kind === "command"
      ? `transport: command\ncommand: ${FAKE_CLI}\n`
      : [
          "transport: certificate",
          `endpoint: ${endpoint}`,
          `certificate: ${join(dir, "client.pem")}`,
          `key: ${join(dir, "client.key")}`,
          `ca: ${join(dir, "ca.pem")}`,
          "",
        ].join("\n");

  const config = parseIntelligenceConfig(content);
  assert.equal(config.kind, kind, "the fixture config must parse as the transport it names");

  switch (config.kind) {
    case "command":
      return new CommandTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, FAKE_LLM_OUTPUT: reply } as NodeJS.ProcessEnv,
      });
    case "certificate":
      return new CertificateTransport({
        endpoint: config.endpoint,
        certificate: config.certificate,
        key: config.key,
        ca: config.ca,
      });
    default:
      throw new Error("unreachable");
  }
}

function serviceFor(kind: "command" | "certificate"): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vaultStore()),
    intelligence: createDefaultIntelligence(transportFor(kind)),
  });
}

const ITEM = {
  text: "chase Priya about the vendor contract. also the roof estimate. and the dentist.",
  capturedAt: new Date("2026-08-17T09:14:22-04:00"),
  ref: { start: 0, end: 0, raw: "" },
};

/** Every case in the suite, run identically against both transports. */
const CASES: { name: string; response: string; kind: "split" | "destination" }[] = [
  { name: "a three-way split", kind: "split", response: '{"pieces":[[0],[1],[2]],"nothingToSplit":false}' },
  { name: "a grouped split", kind: "split", response: '{"pieces":[[0,1],[2]],"nothingToSplit":false}' },
  { name: "nothing to split", kind: "split", response: '{"pieces":[],"nothingToSplit":true}' },
  { name: "a dropped segment", kind: "split", response: '{"pieces":[[0]],"nothingToSplit":false}' },
  { name: "an unusable split", kind: "split", response: "not json" },
  { name: "an out-of-range split", kind: "split", response: '{"pieces":[[9]],"nothingToSplit":false}' },
  {
    name: "an existing project",
    kind: "destination",
    response: '{"destination":"project","slug":"vendor-consolidation","reason":"the vendor work"}',
  },
  {
    name: "a new project",
    kind: "destination",
    response: '{"destination":"project","createTitle":"Board Pack Q4","reason":"new work"}',
  },
  { name: "waiting for someone", kind: "destination", response: '{"destination":"waiting","owner":"Priya","reason":"she owes it"}' },
  { name: "the calendar", kind: "destination", response: '{"destination":"calendar","reason":"a time"}' },
  { name: "the trash", kind: "destination", response: '{"destination":"trash","reason":"nothing to keep"}' },
  {
    name: "an invented project",
    kind: "destination",
    response: '{"destination":"project","slug":"invented","reason":"nope"}',
  },
  { name: "an unusable destination", kind: "destination", response: '{"destination":"nowhere","reason":"x"}' },
  { name: "a fenced answer", kind: "destination", response: '```json\n{"destination":"trash","reason":"fenced"}\n```' },
];

async function runOne(kind: "command" | "certificate", c: (typeof CASES)[number]): Promise<unknown> {
  reply = c.response;
  const service = serviceFor(kind);

  const prepared =
    c.kind === "split" ? await service.prepareSplit(ITEM) : await service.prepareDestination(ITEM.text);

  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");

  const outcome = await prepared.prepared.run();
  // The payload is part of what must match: the same request content goes out
  // over both, or the seam is carrying more than bytes.
  return { payload: prepared.prepared.payload, outcome };
}

describe("one suite, two transports, one setting different", () => {
  for (const c of CASES) {
    test(`${c.name}: identical proposals from identical responses`, async (t) => {
      if (!available) return t.skip("openssl is not available on this machine");

      const overCommand = await runOne("command", c);
      const overCertificate = await runOne("certificate", c);

      assert.deepEqual(
        overCertificate,
        overCommand,
        "the two transports produced different results from the same response",
      );
    });
  }

  test("the suite actually covered both proposal kinds and both outcomes", () => {
    assert.ok(CASES.some((c) => c.kind === "split"));
    assert.ok(CASES.some((c) => c.kind === "destination"));
    assert.ok(CASES.some((c) => c.response.includes("not json")), "a failure case must be included");
    assert.ok(CASES.length >= 12);
  });
});

describe("what differs, and what does not", () => {
  test("only the transport's name differs between the two configurations", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    const command = transportFor("command");
    const certificate = transportFor("certificate");

    // The name is display-only — it appears in a failure message. Everything
    // that decides what a proposal *is* is above the seam and shared.
    assert.notEqual(command.name, certificate.name);
    assert.equal(command.send.length, certificate.send.length, "both take content and a signal");
  });

  test("neither transport's configuration reaches a payload", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    for (const kind of ["command", "certificate"] as const) {
      reply = '{"destination":"trash","reason":"x"}';
      const prepared = await serviceFor(kind).prepareDestination(ITEM.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      const payload = prepared.prepared.payload;
      assert.doesNotMatch(payload, /fake-llm-cli|\.pem|\.key|https:\/\//, `${kind} config leaked into the payload`);
    }
  });

  test("the same acceptance path is reached from both", async (t) => {
    if (!available) return t.skip("openssl is not available on this machine");

    for (const kind of ["command", "certificate"] as const) {
      reply = '{"destination":"project","slug":"roof-repair","reason":"the roof"}';
      const prepared = await serviceFor(kind).prepareDestination(ITEM.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      const outcome = await prepared.prepared.run();
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;

      // A `SortDecision`, which is the only thing `sort()` accepts. There is
      // no per-transport variant of it, because there is no field for one.
      assert.deepEqual(outcome.proposal.decision, { to: "project", slug: "roof-repair" });
    }
  });
});
