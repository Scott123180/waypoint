import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

import { launch, type Harness } from "./harness";

/**
 * Quickstart scenario 7: move between home and work by changing one line.
 *
 * The same vault, the same item, the same stubbed answer — and two completely
 * different ways of reaching a model. Everything about asking, previewing,
 * editing, and accepting must be identical; only the way the request travels
 * changed.
 *
 * The certificate half runs against a real local HTTPS server with key
 * material generated at run time, so this exercises the platform's TLS rather
 * than a double. That is the point of shipping two transports whose failures
 * are unalike: a seam proven against one real environment is a seam that has
 * not been proven.
 */

const FAKE_CLI = resolve(__dirname, "../../dist/tests/fixtures/fake-llm-cli.sh");

const SPLIT_ANSWER = '{"pieces":[[0],[1]],"nothingToSplit":false}';
const ITEM = "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof estimate.\n";

let certDir: string;
let server: Server | undefined;
let endpoint = "";
let haveOpenssl = true;

test.beforeAll(async () => {
  certDir = mkdtempSync(join(tmpdir(), "waypoint-e2e-tls-"));
  const p = (n: string): string => join(certDir, n);

  try {
    const openssl = (...args: string[]): void => execFileSync("openssl", args, { stdio: "pipe" });
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"), "-out", p("ca.pem"),
      "-days", "1", "-subj", "/CN=Switch CA");
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
    haveOpenssl = false;
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
        res.end(SPLIT_ANSWER);
      });
    },
  );

  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  endpoint = `https://localhost:${(server?.address() as AddressInfo).port}/v1/messages`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  rmSync(certDir, { recursive: true, force: true });
});

function commandConfig(): string {
  return ["# Intelligence", "", "transport: command", `command: ${FAKE_CLI}`, ""].join("\n");
}

function certificateConfig(): string {
  return [
    "# Intelligence",
    "",
    "transport: certificate",
    `endpoint: ${endpoint}`,
    `certificate: ${join(certDir, "client.pem")}`,
    `key: ${join(certDir, "client.key")}`,
    `ca: ${join(certDir, "ca.pem")}`,
    "",
  ].join("\n");
}

async function open(config: string): Promise<Harness> {
  const h = await launch({
    seedVault: { "intelligence.md": config },
    env: { FAKE_LLM_OUTPUT: SPLIT_ANSWER },
  });
  h.writeInbox(ITEM);
  await h.openSort();
  return h;
}

/** The whole user-visible surface of one ask, as text. */
async function askAndDescribe(h: Harness): Promise<{ pieces: string[]; inbox: string }> {
  const view = await h.sortView();

  await view.click("#to-split");
  await expect(view.locator("#preview")).toBeVisible();
  await view.click("#send");
  await view.waitForSelector(".piece");

  const pieces = await view
    .locator(".piece textarea")
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLTextAreaElement).value));

  await view.click("#accept-split");
  await expect.poll(() => h.inbox().split("\n").filter((l) => l.trim().length > 0).length).toBe(2);

  return { pieces, inbox: h.inbox() };
}

test("the command transport produces a proposal and an accept", async () => {
  const h = await open(commandConfig());
  try {
    const result = await askAndDescribe(h);
    expect(result.pieces).toHaveLength(2);
    expect(result.inbox).toContain("chase the vendor contract");
  } finally {
    await h.close();
  }
});

test("the certificate transport produces the identical proposal and accept", async () => {
  test.skip(!haveOpenssl, "openssl is not available on this machine");

  const overCommand = await open(commandConfig());
  let commandResult: { pieces: string[]; inbox: string };
  try {
    commandResult = await askAndDescribe(overCommand);
  } finally {
    await overCommand.close();
  }

  const overCertificate = await open(certificateConfig());
  try {
    const certificateResult = await askAndDescribe(overCertificate);

    // SC-009: identical proposals from identical stubbed responses, with only
    // the configured value differing between the two runs.
    expect(certificateResult.pieces).toEqual(commandResult.pieces);
    expect(certificateResult.inbox).toEqual(commandResult.inbox);
  } finally {
    await overCertificate.close();
  }
});

test("the controls are the same under either transport", async () => {
  test.skip(!haveOpenssl, "openssl is not available on this machine");

  const surfaces: string[][] = [];

  for (const config of [commandConfig(), certificateConfig()]) {
    const h = await open(config);
    try {
      const view = await h.sortView();
      await view.click("#to-split");
      surfaces.push(
        (await view.locator("#assist button").allInnerTexts()).concat(
          await view.locator("#choices button").allInnerTexts(),
        ),
      );
    } finally {
      await h.close();
    }
  }

  expect(surfaces[1]).toEqual(surfaces[0]);
});

test("switching transports changes no other file in the vault", async () => {
  test.skip(!haveOpenssl, "openssl is not available on this machine");

  const h = await open(commandConfig());
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");
    await view.click("#accept-split");
    await expect.poll(() => h.inbox()).toContain("also the roof estimate");

    // Only `intelligence.md` differs between a home machine and a work one.
    expect(h.vaultDir("projects")).toEqual([]);
    expect(h.vaultDir("areas")).toEqual([]);
    expect(h.vaultFile("waiting.md")).toBe("");
    expect(h.vaultFile("trash.md")).toBe("");
  } finally {
    await h.close();
  }
});

test("no key material is anywhere in the vault, under either transport", async () => {
  test.skip(!haveOpenssl, "openssl is not available on this machine");

  const h = await open(certificateConfig());
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");
    await view.click("#accept-split");
    await expect.poll(() => h.inbox()).toContain("also the roof estimate");

    // FR-051b: the format has no field a key could be written into, so this is
    // a property of the file rather than a warning in the documentation.
    const config = h.vaultFile("intelligence.md");
    expect(config).toContain(".pem");
    expect(config).not.toMatch(/BEGIN|PRIVATE KEY/);
    expect(h.inbox()).not.toMatch(/BEGIN|PRIVATE KEY/);
  } finally {
    await h.close();
  }
});
