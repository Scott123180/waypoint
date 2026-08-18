import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CommandTransport } from "../src/main/adapters/command-transport";

/**
 * The first transport: a command-line tool, spawned, request on stdin.
 *
 * Shaped like `WhisperAdapter` because it is the same problem — settle once,
 * kill on abort, end stdin or the child waits forever. The request goes on
 * stdin rather than argv for three reasons: `WhisperAdapter` proved the shape,
 * argument lists have length limits a long dictation plus a project catalogue
 * can approach, and a request on the command line would appear in the process
 * table for every other user on the machine to read (research R13).
 */

const FAKE_CLI = resolve(__dirname, "fixtures/fake-llm-cli.sh");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-llm-"));
  chmodSync(FAKE_CLI, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function transport(env: Record<string, string> = {}, overrides: { command?: string; args?: string[] } = {}) {
  return new CommandTransport({
    command: overrides.command ?? FAKE_CLI,
    args: overrides.args ?? [],
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("carrying the request out and the response back", () => {
  test("returns what the tool printed on stdout", async () => {
    const reply = await transport({ FAKE_LLM_OUTPUT: '{"pieces":[[0]],"nothingToSplit":false}' }).send(
      "a request",
      signal(),
    );
    assert.equal(reply, '{"pieces":[[0]],"nothingToSplit":false}');
  });

  test("the request arrives on the child's stdin, byte for byte", async () => {
    const stdinOut = join(dir, "stdin.txt");
    const request = "line one\nline two\n\nand a unicode café 🎉\n";

    await transport({ FAKE_LLM_OUTPUT: "{}", FAKE_LLM_STDIN_OUT: stdinOut }).send(request, signal());

    assert.equal(readFileSync(stdinOut, "utf8"), request);
  });

  test("arguments are passed in list order", async () => {
    const argvOut = join(dir, "argv.txt");
    await transport(
      { FAKE_LLM_OUTPUT: "{}", FAKE_LLM_ARGV_OUT: argvOut },
      { args: ["-p", "--output-format", "text"] },
    ).send("x", signal());

    const argv = readFileSync(argvOut, "utf8").replace(/\n$/, "").split("\n");
    assert.deepEqual(argv, ["-p", "--output-format", "text"]);
  });

  test("an argument containing a space stays one argument", async () => {
    const argvOut = join(dir, "argv.txt");
    await transport(
      { FAKE_LLM_OUTPUT: "{}", FAKE_LLM_ARGV_OUT: argvOut },
      { args: ["--system-prompt", "be brief and exact"] },
    ).send("x", signal());

    const argv = readFileSync(argvOut, "utf8").replace(/\n$/, "").split("\n");
    assert.deepEqual(argv, ["--system-prompt", "be brief and exact"]);
  });

  test("the request is never placed on the command line", async () => {
    const argvOut = join(dir, "argv.txt");
    await transport({ FAKE_LLM_OUTPUT: "{}", FAKE_LLM_ARGV_OUT: argvOut }).send(
      "something private the user dictated",
      signal(),
    );

    // argv is world-readable in the process table. The request is not for it.
    assert.doesNotMatch(readFileSync(argvOut, "utf8"), /something private/);
  });

  test("empty output comes back as an empty string, for core to call unusable", async () => {
    assert.equal(await transport({ FAKE_LLM_OUTPUT: "" }).send("x", signal()), "");
  });

  test("carries a name, for a failure message and the preview", () => {
    assert.match(transport().name, /command/);
  });
});

describe("failures, as this transport produces them", () => {
  test("a missing binary is unreachable", async () => {
    await assert.rejects(
      () => transport({}, { command: join(dir, "definitely-not-installed") }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "unreachable");
        assert.match((err as Error).message, /definitely-not-installed/, "the message names what could not be run");
        return true;
      },
    );
  });

  test("a non-zero exit is failed, and carries the last stderr line", async () => {
    await assert.rejects(
      () => transport({ FAKE_LLM_EXIT: "3", FAKE_LLM_OUTPUT: "" }).send("x", signal()),
      (err: unknown) => {
        assert.equal((err as { reason: string }).reason, "failed");
        assert.match((err as Error).message, /fake-llm: read stdin, thinking/, "the stderr tail is what a user can act on");
        return true;
      },
    );
  });

  test("stderr on a successful run is not a failure", async () => {
    // The fixture always logs to stderr, as a real tool does. Only the exit
    // code counts — the same judgement `WhisperAdapter` makes.
    assert.equal(await transport({ FAKE_LLM_OUTPUT: "fine" }).send("x", signal()), "fine");
  });

  test("no failure message contains the request that was sent", async () => {
    await assert.rejects(
      () => transport({ FAKE_LLM_EXIT: "1" }).send("a private dictation about a colleague", signal()),
      (err: unknown) => {
        assert.doesNotMatch((err as Error).message, /private dictation/);
        return true;
      },
    );
  });
});

describe("honouring the signal, which is core's", () => {
  test("an aborted signal kills the child and leaves no orphan", async () => {
    const controller = new AbortController();
    const pending = transport({ FAKE_LLM_HANG: "1" }).send("x", controller.signal);

    await new Promise((r) => setTimeout(r, 100));
    controller.abort();

    await assert.rejects(() => pending, (err: unknown) => {
      // The child is gone. If it were not, `node --test` would hang here for
      // five minutes rather than finishing — the fixture `exec`s its sleep so
      // the kill reaches the process actually holding the pipes open.
      assert.equal((err as { reason: string }).reason, "timed-out");
      return true;
    });
  });

  test("a signal already aborted never spawns anything", async () => {
    const controller = new AbortController();
    controller.abort();

    const argvOut = join(dir, "argv.txt");
    await assert.rejects(() =>
      transport({ FAKE_LLM_OUTPUT: "{}", FAKE_LLM_ARGV_OUT: argvOut }).send("x", controller.signal),
    );

    assert.throws(() => readFileSync(argvOut, "utf8"), "the tool ran despite an aborted signal");
  });

  test("this transport has no timeout of its own", () => {
    // The bound is core's, armed once, delivered as a signal. A timeout here
    // would be a second number that could drift from it (FR-066a).
    const source = readFileSync(
      resolve(__dirname, "..", "..", "src", "main", "adapters", "command-transport.ts"),
      "utf8",
    ).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    assert.ok(!source.includes("setTimeout"), "the transport armed a timer of its own");
    assert.ok(!source.includes("timeoutMs"), "the transport accepts a bound of its own");
  });
});
