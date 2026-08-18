import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseIntelligenceConfig } from "../src/suggest/intelligence-config";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeVaultStore } from "./sort-fakes";

/**
 * FR-052: the transport comes from `intelligence.md`, or the layer is off.
 *
 * Never probed. No `PATH` check, no scan for a listening local model, no
 * environment variable, no editor-host detection.
 *
 * The reason is the roadmap's: auto-detection makes the application behave
 * differently on two machines for reasons the user cannot see, which is
 * exactly what plain-text configuration stored *with the data* exists to
 * prevent. A machine with a CLI tool on `PATH`, an Ollama listening on 11434,
 * and no `intelligence.md` has this **off** — and this is the test that says
 * so.
 */

describe("with everything installed and nothing configured", () => {
  test("an absent file leaves the layer off", () => {
    // The environment for this process genuinely has a shell, a PATH, and
    // whatever the developer has installed. None of it is consulted.
    assert.equal(parseIntelligenceConfig(null).kind, "off");
  });

  test("environment variables that name a tool or an endpoint change nothing", () => {
    const planted = {
      CLAUDE_CLI: "/usr/local/bin/claude",
      OLLAMA_HOST: "http://127.0.0.1:11434",
      OPENAI_API_KEY: "sk-should-never-be-read",
      ANTHROPIC_API_KEY: "sk-should-never-be-read",
      WAYPOINT_TRANSPORT: "command",
      WAYPOINT_LLM_COMMAND: "/usr/local/bin/claude",
      EDITOR: "code",
      TERM_PROGRAM: "vscode",
    };

    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(planted)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }

    try {
      assert.equal(parseIntelligenceConfig(null).kind, "off");
      assert.equal(parseIntelligenceConfig("").kind, "off");
      assert.equal(parseIntelligenceConfig("# Intelligence\n").kind, "off");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("an unconfigured service prepares nothing, whatever is installed", async () => {
    const service = new SuggestionService({ catalog: catalogOf(new FakeVaultStore()) });

    const split = await service.prepareSplit({
      text: "anything",
      capturedAt: null,
      ref: { start: 0, end: 0, raw: "" },
    });
    const destination = await service.prepareDestination("anything");

    assert.equal(split.ok, false);
    assert.equal(destination.ok, false);
    if (split.ok || destination.ok) return;
    assert.equal(split.reason, "not-configured");
    assert.equal(destination.reason, "not-configured");
  });
});

describe("the code cannot probe, because it has nothing to probe with", () => {
  const roots = ["suggest", "intelligence"].map((d) => join(__dirname, "..", "..", "dist", "src", d));

  function jsFilesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...jsFilesUnder(full));
      else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
  }

  /**
   * Comments are carried into the compiled output, and they legitimately use
   * words like "which" and name constants like `INTELLIGENCE_PATH`. Only the
   * code is evidence, so it is the code that gets read.
   */
  function code(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  test("nothing in the layer reads process.env", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = code(file);
        assert.ok(!source.includes("process.env"), `${file} reads the environment`);
        assert.ok(!source.includes("process.platform"), `${file} branches on the platform`);
      }
    }
  });

  test("nothing in the layer looks at PATH, or asks what is executable", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = code(file);
        for (const needle of [/\bPATH\b(?!_)/, /\bwhich\s*\(/, /lookpath/i, /accessSync/, /existsSync/, /\bstatSync\b/]) {
          assert.doesNotMatch(source, needle, `${file} matches ${needle}`);
        }
      }
    }
  });

  test("nothing in the layer opens a socket or names a port", () => {
    for (const root of roots) {
      for (const file of jsFilesUnder(root)) {
        const source = code(file);
        assert.doesNotMatch(source, /11434|localhost|127\.0\.0\.1/, `${file} names a local model`);
        assert.ok(!source.includes("node:net"), `${file} could listen or connect`);
      }
    }
  });

  test("the config module names no transport but the two that ship", () => {
    const config = readFileSync(
      join(__dirname, "..", "..", "src", "suggest", "intelligence-config.ts"),
      "utf8",
    ).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const name of ["ollama", "openai", "anthropic", "copilot", "vscode", "cursor", "zed"]) {
      assert.ok(!config.toLowerCase().includes(name), `the config knows about ${name}`);
    }
  });
});

describe("selection is a switch over what the file says", () => {
  test("each transport is chosen only by its own literal value", () => {
    assert.equal(parseIntelligenceConfig("transport: command\ncommand: x\n").kind, "command");
    assert.equal(
      parseIntelligenceConfig(
        "transport: certificate\nendpoint: https://x.example/v1\ncertificate: /a\nkey: /b\n",
      ).kind,
      "certificate",
    );
  });

  test("a near-miss is a problem, never a guess at what was meant", () => {
    for (const near of ["comand", "cli", "subprocess", "cert", "certificates", "mtls", "https"]) {
      const config = parseIntelligenceConfig(`transport: ${near}\n`);
      assert.equal(config.kind, "problem", `"${near}" was resolved to a transport`);
    }
  });

  test("there is no fallback: a broken certificate config does not become a command one", () => {
    const config = parseIntelligenceConfig("transport: certificate\ncommand: claude\n");

    // The `command:` line is right there and usable. Falling back to it would
    // be the environment-probing this whole file exists to rule out — and on a
    // work machine, the fallback is the transport that is blocked.
    assert.equal(config.kind, "problem");
    assert.equal("command" in config, false);
  });
});
