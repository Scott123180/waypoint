import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Principle III, for the two new core directories.
 *
 * The suggestion layer is where network code would most plausibly drift into
 * core — a transport is, after all, the thing that talks to something. It must
 * not: the HTTPS transport is a *desktop adapter*, and core declares only the
 * interface it satisfies. Core never opens a socket, in any configuration.
 *
 * A **new file** rather than an addition to `sort-offline.test.ts`, so that
 * file stays untouched and keeps meaning exactly what it meant when Feature 2
 * wrote it.
 */

const FORBIDDEN = [
  "node:net",
  "node:tls",
  "node:http",
  "node:https",
  "node:dgram",
  "node:child_process",
  '"net"',
  '"tls"',
  '"http"',
  '"https"',
  '"dgram"',
  '"child_process"',
];

function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("the suggestion layer has no network code path", () => {
  const roots = ["suggest", "intelligence"].map((d) =>
    join(__dirname, "..", "..", "dist", "src", d),
  );

  test("imports no networking module, and no subprocess module either", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) {
          assert.ok(
            !source.includes(`require(${needle})`) && !source.includes(`from ${needle}`),
            `${file} references ${needle} — a transport belongs in packages/desktop`,
          );
        }
      }
    }
  });

  test("never reaches for fetch", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = readFileSync(file, "utf8");
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} calls fetch`);
        assert.doesNotMatch(source, /XMLHttpRequest|WebSocket/, `${file} uses a network API`);
      }
    }
  });

  test("reads no file, so a credential path stays a string here", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = readFileSync(file, "utf8");
        assert.ok(
          !source.includes("node:fs") && !source.includes('require("fs")'),
          `${file} reads the filesystem — credentials are read by the transport, at call time`,
        );
      }
    }
  });
});
