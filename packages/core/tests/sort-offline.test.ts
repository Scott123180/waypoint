import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * FR-031 / SC-008: sort works with no network, because it has no network code.
 *
 * Node cannot revoke its own network access mid-process, so this asserts it
 * statically over the compiled output instead. Manual verification stays with
 * quickstart scenario 10.
 */

const FORBIDDEN = ["node:net", "node:tls", "node:http", "node:https", "node:dgram", '"net"', '"tls"', '"http"', '"https"', '"dgram"'];

function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("sort has no network code path", () => {
  const roots = ["sort", "vault", "inbox"].map((d) =>
    join(__dirname, "..", "..", "dist", "src", d),
  );

  test("imports no networking module", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) {
          assert.ok(
            !source.includes(`require(${needle})`) && !source.includes(`from ${needle}`),
            `${file} references ${needle}`,
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
});
