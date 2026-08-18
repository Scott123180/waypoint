import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";
import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * `SortService.split(ref, pieces)` — this feature's only write.
 *
 * It takes **strings**. It cannot tell whether they came from a proposal, from
 * a user's edit of one, or from a client with no intelligence configured at
 * all, which is what makes "nothing exists only on the assisted path" a fact
 * about the signature rather than a claim (FR-031).
 *
 * **No journal entry.** A split replaces one byte range in one file through an
 * atomic temp-plus-rename, so FR-014's all-or-nothing is the rename's
 * guarantee. The journal exists because a destination commit touches two files
 * and POSIX cannot update both atomically; adding it here would create a crash
 * window that does not otherwise exist, with a recovery path whose triggering
 * state is unreachable and therefore untestable (research R9).
 */

const CAPTURED = "- 2026-08-17T09:14:22-04:00 roof estimate and dentist thursday\n";
const HANDWRITTEN = "a line I typed myself\n";

function serviceOver(content: string) {
  const inbox = new FakeInboxDocument(content);
  const journal = new FakeSortJournal();
  const service = new SortService({ inbox, vault: new FakeVaultStore(), journal, clock: fixedClock() });
  return { service, inbox, journal };
}

async function firstRef(content: string) {
  const { service, inbox, journal } = serviceOver(content);
  const item = await service.next();
  assert.ok(item, "the fixture must hold a routable item");
  return { service, inbox, journal, item };
}

describe("the happy path", () => {
  test("replaces one item with several, in its place", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);

    const outcome = await service.split(item.ref, ["roof estimate", "dentist thursday"]);

    assert.equal(outcome.ok, true);
    assert.equal(
      inbox.content,
      "- 2026-08-17T09:14:22-04:00 roof estimate\n- 2026-08-17T09:14:22-04:00 dentist thursday\n",
    );
  });

  test("every piece carries the original's capture time, not now", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    await service.split(item.ref, ["one", "two", "three"]);

    const items = parseInbox(inbox.content);
    assert.equal(items.length, 3);
    for (const piece of items) {
      assert.equal(
        piece.capturedAt?.toISOString(),
        new Date("2026-08-17T09:14:22-04:00").toISOString(),
        "a piece was stamped with the time of the split rather than of the capture",
      );
    }
  });

  test("a hand-written item yields pieces with no timestamp at all", async () => {
    const { service, inbox, item } = await firstRef(HANDWRITTEN);
    await service.split(item.ref, ["first half", "second half"]);

    // Nothing is fabricated. A line the user typed has no capture time, and
    // inventing one would be the application claiming to know something it
    // does not (FR-016).
    assert.equal(inbox.content, "first half\nsecond half\n");
    for (const piece of parseInbox(inbox.content)) {
      assert.equal(piece.capturedAt, null);
    }
  });

  test("pieces occupy the original's byte range, so file order is capture order", async () => {
    const before = "- 2026-08-01T08:00:00-04:00 earlier item\n";
    const after = "- 2026-08-20T08:00:00-04:00 later item\n";
    const { service, inbox } = serviceOver(before + CAPTURED + after);

    const items = parseInbox(inbox.content);
    const middle = items[1];
    assert.ok(middle);
    await service.split(
      { start: middle.start, end: middle.end, raw: middle.raw },
      ["roof estimate", "dentist thursday"],
    );

    const texts = parseInbox(inbox.content).map((i) => i.text);
    assert.deepEqual(texts, ["earlier item", "roof estimate", "dentist thursday", "later item"]);
  });

  test("a single piece is allowed — it is an edit the user chose to make", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    const outcome = await service.split(item.ref, ["just the roof estimate"]);

    assert.equal(outcome.ok, true);
    assert.equal(inbox.content, "- 2026-08-17T09:14:22-04:00 just the roof estimate\n");
  });
});

describe("exactly one write, and no journal", () => {
  test("one replaceRange call, and removeRange is never used", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    await service.split(item.ref, ["one", "two"]);

    assert.equal(inbox.replaceCalls, 1, "a split must be one write or it is not atomic");
    assert.equal(inbox.removeCalls, 0, "a remove-then-append would leave a window with nothing in it");
  });

  test("no journal entry is written, and none is left behind", async () => {
    const { service, journal, item } = await firstRef(CAPTURED);
    await service.split(item.ref, ["one", "two"]);

    assert.deepEqual(journal.log, [], "a split needs no write-ahead log; one file changes, atomically");
    assert.deepEqual(await journal.pending(), []);
  });

  test("recovery is untouched by splitting", async () => {
    const { service, item } = await firstRef(CAPTURED);
    await service.split(item.ref, ["one", "two"]);

    assert.deepEqual(await service.recover(), { completed: 0, abandoned: 0 });
  });
});

describe("refusals", () => {
  test("empty-pieces when the list is empty", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    const outcome = await service.split(item.ref, []);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "empty-pieces");
    assert.equal(inbox.content, CAPTURED, "the original stands");
  });

  test("empty-pieces when every entry is blank after trimming", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    const outcome = await service.split(item.ref, ["   ", "\n", ""]);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "empty-pieces");
    assert.equal(inbox.content, CAPTURED);
  });

  test("discarding is one sort to trash away, so refusing here loses nothing", async () => {
    // Why `empty-pieces` is a refusal rather than a delete: deleting an item
    // by proposing nothing would be the one destructive thing this feature
    // could do, and it already has a verb (FR-019).
    const { service, item } = await firstRef(CAPTURED);
    assert.equal((await service.split(item.ref, [])).ok, false);
    assert.equal((await service.sort(item.ref, { to: "trash" })).ok, true);
  });

  test("a blank piece among real ones is dropped, not refused", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    const outcome = await service.split(item.ref, ["roof estimate", "   ", "dentist thursday"]);

    assert.equal(outcome.ok, true);
    assert.equal(parseInbox(inbox.content).length, 2);
  });

  test("item-changed when the bytes moved since the item was shown", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    // A hand-edit in another window between the proposal and the accept.
    inbox.content = "- 2026-08-17T09:14:22-04:00 something else entirely\n";

    const outcome = await service.split(item.ref, ["one", "two"]);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "item-changed");
    assert.match(outcome.message, /changed on disk/, "Feature 2's wording, not a second vocabulary");
    assert.equal(inbox.content, "- 2026-08-17T09:14:22-04:00 something else entirely\n", "nothing was written");
  });

  test("item-changed when the ref's own bytes are not an item at all", async () => {
    const { service, inbox } = serviceOver(CAPTURED);
    const outcome = await service.split({ start: 0, end: 0, raw: "" }, ["one"]);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "item-changed");
    assert.equal(inbox.content, CAPTURED);
  });

  test("a mismatch at the write is refused rather than forced", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    // The document reports a mismatch even though our pre-read matched — the
    // race Feature 2's `removeRange` contract already describes.
    inbox.concurrentAppend = "- 2026-08-18T08:00:00-04:00 landed mid-split\n";
    inbox.forceMismatch = true;

    const outcome = await service.split(item.ref, ["one", "two"]);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "item-changed");
  });

  test("a write failure is reported as write-failed, with nothing written", async () => {
    const { service, inbox, item } = await firstRef(CAPTURED);
    inbox.failNextWrite = true;

    const outcome = await service.split(item.ref, ["one", "two"]);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "write-failed");
    assert.equal(inbox.content, CAPTURED);
  });

  test("no destination refusal can arise, because a split has no destination", async () => {
    const { service, item } = await firstRef(CAPTURED);
    const outcome = await service.split(item.ref, ["one"]);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.doesNotMatch(outcome.destination, /project|area|waiting|calendar|trash/);
  });
});

describe("the signature is the guarantee", () => {
  test("split takes a ref and strings, and knows nothing about a proposal", () => {
    assert.equal(SortService.prototype.split.length, 2);
  });

  test("a piece typed by hand and a piece from a proposal are the same thing", async () => {
    const a = await firstRef(CAPTURED);
    await a.service.split(a.item.ref, ["roof estimate", "dentist thursday"]);

    const b = await firstRef(CAPTURED);
    await b.service.split(b.item.ref, ["roof estimate", "dentist thursday"]);

    // Same input, same bytes. There is no field in which provenance could
    // differ, because there is no argument carrying it (FR-015, FR-032).
    assert.equal(a.inbox.content, b.inbox.content);
  });
});
