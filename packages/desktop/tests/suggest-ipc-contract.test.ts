import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The suggestion channels, guarded by reading the source — the same technique
 * and for the same reason as `review-ipc.test.ts`: wiring Electron's IPC into
 * a unit test would test the harness, and what can go wrong here is someone
 * writing the wrong line.
 *
 * Four properties, each of which fails **silently** if lost:
 *
 *   1. **`suggest:run` takes an opaque id, never payload text.** If the
 *      renderer sent the payload back, the content reaching the transport
 *      would be whatever crossed the bridge twice, and a mismatch with what
 *      was previewed would become possible — exactly what FR-045 forbids. The
 *      main process holds the one `PreparedRequest` against its id and calls
 *      `run()`, which is closed over the payload it already returned.
 *
 *   2. **`sort:split` is registered unconditionally.** It is a `SortService`
 *      verb, and its availability has nothing to do with whether a model can
 *      be reached.
 *
 *   3. **The `suggest` bridge object is attached only when a transport is
 *      configured.** Not disabled, not hidden — absent, which is the only form
 *      of "no control in any state" that a stylesheet cannot undo.
 *
 *   4. **Ids are per-window and short-lived.** Nothing about a prepared
 *      request is persisted (FR-046).
 */

const SOURCE = join(__dirname, "..", "..", "src");

function read(...parts: string[]): string {
  return readFileSync(join(SOURCE, ...parts), "utf8");
}

/** Comments describe the boundary; only the code is evidence of it. */
function code(source: string): string {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("suggest:run carries an id, not content", () => {
  test("its handler takes an id and nothing that could be a payload", () => {
    const ipc = code(read("main", "ipc.ts"));

    const handler = /ipcMain\.handle\(\s*"suggest:run",\s*async \(([^)]*)\)/.exec(ipc);
    assert.ok(handler, "suggest:run must be registered");

    const params = handler[1] ?? "";
    assert.match(params, /\bid: string\b/, "the handler must take an id");
    assert.doesNotMatch(params, /payload|request|text|content/i, "content must not cross back");
  });

  test("the preload exposes run(id) and nothing wider", () => {
    const preload = code(read("preload", "preload.ts"));
    assert.match(preload, /run:\s*\(id: string\)/, "run takes an id");
    assert.doesNotMatch(preload, /run:\s*\([^)]*payload/i, "run must not accept a payload");
  });

  test("nothing re-renders a request in the main process", () => {
    // The payload was built once, in core, at prepare time. A second
    // construction anywhere is the discrepancy FR-045 rules out.
    const ipc = code(read("main", "ipc.ts"));
    assert.doesNotMatch(ipc, /renderSplitRequest|renderDestinationRequest/, "the payload was rebuilt");
  });
});

describe("sort:split is a SortService verb", () => {
  test("registered with the other sort channels, unconditionally", () => {
    const ipc = code(read("main", "ipc.ts"));
    const sortBlock = /function registerSortIpc\(([\s\S]*?)\n\}/.exec(ipc);
    assert.ok(sortBlock, "registerSortIpc must exist");
    assert.match(sortBlock[1] ?? "", /"sort:split"/, "sort:split belongs with sorting, not with suggesting");
  });

  test("it carries a ref and strings, and knows nothing about a proposal", () => {
    const ipc = code(read("main", "ipc.ts"));
    const handler = /ipcMain\.handle\(\s*"sort:split",\s*async \(([^)]*)\)/.exec(ipc);
    assert.ok(handler, "sort:split must be registered");

    const params = handler[1] ?? "";
    assert.match(params, /ref: ItemRef/);
    assert.match(params, /pieces: string\[\]/);
    assert.doesNotMatch(params, /proposal|suggestion/i, "the write path must not learn where pieces came from");
  });

  test("the preload exposes sort.split always, alongside sort.decide", () => {
    const preload = code(read("preload", "preload.ts"));
    assert.match(preload, /split:\s*\(ref: ItemRef, pieces: string\[\]\)/);
  });
});

describe("there is no accept channel", () => {
  test("accepting a destination is sort:decide, the channel a manual choice uses", () => {
    const ipc = code(read("main", "ipc.ts"));
    assert.doesNotMatch(ipc, /"suggest:accept"/, "a second path to a destination is a second behaviour");
    assert.doesNotMatch(ipc, /"suggest:decide"/);
    assert.match(ipc, /"sort:decide"/, "the one path must still be there");
  });

  test("no channel takes more than one item", () => {
    const ipc = code(read("main", "ipc.ts"));
    assert.doesNotMatch(ipc, /"suggest:[a-z-]*all"/i);
    assert.doesNotMatch(ipc, /refs: ItemRef\[\]/, "a batch verb would break one-at-a-time (FR-004)");
  });

  test("no channel produces a suggestion without being asked", () => {
    const ipc = code(read("main", "ipc.ts"));
    // Nothing subscribes, nothing polls, nothing fires on sort:next.
    assert.doesNotMatch(ipc, /setInterval[\s\S]{0,120}suggest/i);
    assert.doesNotMatch(ipc, /suggest[\s\S]{0,80}setTimeout/i);
  });
});

describe("the bridge exists only when the layer does", () => {
  test("the suggest object is attached conditionally", () => {
    const preload = code(read("preload", "preload.ts"));
    assert.match(
      preload,
      /suggestAvailable|\.\.\.\(suggest/,
      "the suggest API must be spread in conditionally, not always present",
    );
  });

  test("the handlers are registered conditionally too", () => {
    const ipc = code(read("main", "ipc.ts"));
    // A preload that hid an always-registered channel would still leave the
    // channel reachable from any renderer. Both halves must be absent.
    assert.match(
      ipc,
      /function registerSuggestIpc/,
      "the suggest channels must live in their own function, called only when configured",
    );
    const main = code(read("main", "main.ts"));
    assert.match(main, /registerSuggestIpc/, "main decides whether to call it");
    assert.match(main, /kind === "command"|kind === "certificate"|switch \(/, "selection is a switch over a closed union");
  });
});

describe("prepared requests are held in memory, per window, and dropped", () => {
  test("nothing about a prepared request is written anywhere", () => {
    const ipc = code(read("main", "ipc.ts"));
    const suggestBlock = /function registerSuggestIpc\(([\s\S]*?)\n\}/.exec(ipc);
    assert.ok(suggestBlock, "registerSuggestIpc must exist");

    const body = suggestBlock[1] ?? "";
    for (const needle of ["writeFile", "appendFile", "vault.write", "localStorage"]) {
      assert.ok(!body.includes(needle), `${needle} persists something about a proposal (FR-046)`);
    }
  });

  test("preparing again for the same item replaces the held request", () => {
    const ipc = code(read("main", "ipc.ts"));
    const suggestBlock = /function registerSuggestIpc\(([\s\S]*?)\n\}/.exec(ipc);
    assert.ok(suggestBlock);
    // A Map keyed by id, cleared on abandon and on run. An array that only
    // grew would be a per-session history of everything ever asked.
    assert.match(suggestBlock[1] ?? "", /new Map[<(]/, "requests are held by id");
    assert.match(suggestBlock[1] ?? "", /\.delete\(/, "and dropped once used");
  });
});

/**
 * T079 (convergence, 2026-08-18): the seam grows nothing it does not use.
 *
 * `contracts/ipc-suggest.md` gave the bridge a fifth verb, `available()`, over
 * a `suggest:available` channel, to be "read once when the sort window opens".
 * Research R17 then settled availability differently and better: the main
 * process decides it before the window exists and passes `--waypoint-suggest`
 * as a window argument, so the bridge object is either attached or absent and
 * the renderer has nothing to ask. The channel survived the change with no
 * caller — reachable only when the layer is already on, in which case it could
 * only ever answer `true`.
 *
 * An unused channel is not inert. It is surface: a later contributor finds a
 * verb, believes it is how availability is determined, and writes a renderer
 * that asks — reintroducing the disabled-control state FR-060 exists to make
 * unreachable. This asserts the bridge is exactly the verbs the feature uses.
 */
describe("the suggest bridge is exactly the verbs the feature uses", () => {
  const VERBS = ["prepareSplit", "prepareDestination", "run", "abandon"];

  test("the preload exposes those four and nothing else", () => {
    const preload = code(read("preload", "preload.ts"));
    const api = /const suggestApi = \{([\s\S]*?)\n\};/.exec(preload);
    assert.ok(api, "suggestApi must exist");

    // Every top-level member of the object literal, however it is written:
    // `name(args)`, `name: (args) =>`, or `name: function`.
    const members = [...(api[1] ?? "").matchAll(/^ {2}(\w+)[(:]/gm)].map((m) => m[1]);
    assert.deepEqual(
      members.sort(),
      [...VERBS].sort(),
      "the bridge grew or lost a verb — if that is deliberate, the contract is what to change first",
    );
  });

  test("no `suggest:available` channel is registered or invoked", () => {
    const ipc = code(read("main", "ipc.ts"));
    const preload = code(read("preload", "preload.ts"));

    assert.ok(!ipc.includes("suggest:available"), "a channel nothing calls is surface, not capability");
    assert.ok(!preload.includes("suggest:available"), "the bridge must not offer a verb nothing uses");
  });

  test("availability is still decided by the window argument, not by a round trip", () => {
    const preload = code(read("preload", "preload.ts"));
    // The replacement for the channel, asserted here so removing one without
    // the other cannot pass: this is *how* the renderer knows (research R17).
    assert.match(preload, /process\.argv\.includes\("--waypoint-suggest"\)/);
  });
});
