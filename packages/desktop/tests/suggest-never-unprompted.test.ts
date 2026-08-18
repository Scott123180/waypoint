import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CaptureService,
  SortService,
  SuggestionService,
  catalogOf,
  createDefaultIntelligence,
  type Transport,
  type VaultStore,
} from "@waypoint/core";

import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { FsVaultStore } from "../src/main/adapters/fs-vault-store";
import { FsSortJournal } from "../src/main/adapters/fs-sort-journal";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault } from "./vault-fixture";

/**
 * FR-002 and FR-004: suggestions never happen on their own.
 *
 * The important word in this file is **configured**. Every other absence test
 * proves that nothing happens when there is no transport, which is the easy
 * case — nothing *could* happen. This one arms a real, working transport and
 * then does everything a user does *except ask*: captures an item, opens the
 * inbox, walks through several items, leaves the window idle past the
 * 120-second bound, and changes the vault from outside.
 *
 * The transport must record **zero** calls. Nothing subscribes, nothing polls,
 * nothing fires on capture, on open, on advance, or on a timer. The only thing
 * that produces a request is an explicit, per-item ask.
 */

class CountingTransport implements Transport {
  readonly name = "counting";
  calls = 0;
  readonly received: string[] = [];

  send(request: string): Promise<string> {
    this.calls += 1;
    this.received.push(request);
    return Promise.resolve('{"pieces":[[0]],"nothingToSplit":false}');
  }
}

const SEED =
  "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof.\n" +
  "- 2026-08-17T09:20:00-04:00 book the dentist\n" +
  "- 2026-08-17T09:30:00-04:00 a third thing entirely\n";

function build() {
  const vault = makeTempVault();
  vault.write("inbox.md", SEED);
  vault.write("projects/roof-repair.md", "# Roof repair\n\nstatus: active\n\n## Outcome\n\nSurvives a winter.\n");
  // A configured transport, exactly as a user would set one up.
  vault.write("intelligence.md", "transport: command\ncommand: /bin/true\n");

  const mutex = new InboxMutex();
  const store = new FsVaultStore(vault.root);
  const transport = new CountingTransport();

  const sort = new SortService({
    inbox: new FsInboxDocument(vault.inboxPath, mutex),
    vault: store,
    journal: new FsSortJournal(vault.path("sort-journal.json")),
  });

  const capture = new CaptureService({
    inbox: new FsInboxStore(vault.inboxPath, mutex),
    transcription: { transcribe: () => Promise.resolve("a dictated thought") },
  });

  const suggest = new SuggestionService({
    catalog: catalogOf(store as VaultStore),
    intelligence: createDefaultIntelligence(transport),
    // Short, so "idle past the bound" is testable in under a second. A timer
    // that fired on its own would fire here, loudly.
    timeoutMs: 50,
  });

  return { vault, sort, capture, suggest, transport };
}

describe("with a transport configured, and nobody asking", () => {
  test("capturing sends nothing", async () => {
    const h = build();
    try {
      await h.capture.submit("a brand new thought with several parts. and another.", "typed");
      await h.capture.flush();

      assert.equal(h.transport.calls, 0, "capture triggered a request");
    } finally {
      h.vault.cleanup();
    }
  });

  test("opening the inbox sends nothing", async () => {
    const h = build();
    try {
      await h.sort.count();
      await h.sort.next();
      await h.sort.destinations();
      await h.sort.isEmpty();

      assert.equal(h.transport.calls, 0, "opening the inbox triggered a request");
    } finally {
      h.vault.cleanup();
    }
  });

  test("advancing through several items sends nothing", async () => {
    const h = build();
    try {
      for (let i = 0; i < 3; i++) {
        const item = await h.sort.next();
        assert.ok(item);
        assert.equal((await h.sort.sort(item.ref, { to: "trash" })).ok, true);
      }

      assert.equal(h.transport.calls, 0, "advancing triggered a request");
    } finally {
      h.vault.cleanup();
    }
  });

  test("sitting idle past the bound sends nothing", async () => {
    const h = build();
    try {
      await h.sort.next();

      // Well past the 50ms bound this service was built with. A timer armed at
      // construction, or a retry loop, or a warm-up call would land in here.
      await new Promise((r) => setTimeout(r, 300));

      assert.equal(h.transport.calls, 0, "something fired on a timer");
    } finally {
      h.vault.cleanup();
    }
  });

  test("a vault change sends nothing", async () => {
    const h = build();
    try {
      await h.sort.next();
      h.vault.write("projects/new-one.md", "# New one\n\nstatus: active\n");
      h.vault.write("inbox.md", `${SEED}- 2026-08-17T10:00:00-04:00 edited in vim\n`);
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(h.transport.calls, 0, "a vault change triggered a request");
    } finally {
      h.vault.cleanup();
    }
  });

  test("all of it together still sends nothing", async () => {
    const h = build();
    try {
      await h.capture.submit("something new", "typed");
      await h.capture.flush();
      await h.sort.count();
      await h.sort.destinations();

      const first = await h.sort.next();
      assert.ok(first);
      await h.sort.sort(first.ref, { to: "trash" });

      h.vault.write("projects/another.md", "# Another\n\nstatus: active\n");
      await new Promise((r) => setTimeout(r, 300));

      const second = await h.sort.next();
      assert.ok(second);
      await h.sort.sort(second.ref, { to: "trash" });

      assert.equal(h.transport.calls, 0, "the transport was contacted without anyone asking");
      assert.deepEqual(h.transport.received, []);
    } finally {
      h.vault.cleanup();
    }
  });
});

describe("and one explicit ask sends exactly one", () => {
  test("so the zero above is a fact about triggering, not a broken fixture", async () => {
    const h = build();
    try {
      const item = await h.sort.next();
      assert.ok(item);

      const prepared = await h.suggest.prepareSplit(item);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      // Preparing still sends nothing: the send is the user's separate act.
      assert.equal(h.transport.calls, 0, "preparing sent something");

      await prepared.prepared.run();
      assert.equal(h.transport.calls, 1, "the ask must actually work, or this proves nothing");
    } finally {
      h.vault.cleanup();
    }
  });
});

describe("nothing in the wiring could fire on its own", () => {
  function code(...parts: string[]): string {
    return readFileSync(join(__dirname, "..", "..", "src", ...parts), "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  test("no suggestion channel is driven by a signal, a timer, or a subscription", () => {
    const ipc = code("main", "ipc.ts");
    const main = code("main", "main.ts");

    for (const source of [ipc, main]) {
      assert.doesNotMatch(source, /subscribe\([^)]*suggest/i, "a suggestion is wired to a signal");
      assert.doesNotMatch(source, /setInterval/, "something polls");
      assert.doesNotMatch(source, /suggest[\w.]*\([^)]*\)[\s\S]{0,60}setTimeout/i, "something is scheduled");
    }
  });

  test("the renderer asks only from a click handler", () => {
    const renderer = code("renderer", "sort.ts");

    // Every call site of `askFor` is inside an event listener. A call at
    // module scope, or inside `showNext`, would be an automatic request on
    // every item the user looked at.
    const calls = [...renderer.matchAll(/askFor\(/g)];
    assert.ok(calls.length >= 2, "both kinds must be askable");

    for (const match of calls) {
      const before = renderer.slice(Math.max(0, match.index - 160), match.index);
      // Either this occurrence *is* the declaration, or it is a call reached
      // from a click. Anything else — a call at module scope, or inside
      // `showNext` — would be an automatic request.
      const isDeclaration = /\basync function\s*$/.test(before);
      assert.ok(
        isDeclaration || before.includes('addEventListener("click"'),
        "askFor is reachable from something that is not a click",
      );
    }
    assert.ok(
      calls.some((m) => /\basync function\s*$/.test(renderer.slice(Math.max(0, m.index - 160), m.index))),
      "the declaration must be among the matches, or this regex is matching nothing real",
    );
  });

  test("showNext never asks for anything", () => {
    const renderer = code("renderer", "sort.ts");
    const showNext = /async function showNext\(\): Promise<void> \{([\s\S]*?)\n\}/.exec(renderer);
    assert.ok(showNext, "showNext must exist");

    // It clears the assist area, and that is all it may do with it. Preparing
    // here would mean every item the user advanced past sent a request.
    assert.ok(!(showNext[1] ?? "").includes("askFor"), "advancing an item triggers a request");
    assert.ok(!(showNext[1] ?? "").includes("prepareSplit"));
    assert.ok(!(showNext[1] ?? "").includes("prepareDestination"));
  });
});
