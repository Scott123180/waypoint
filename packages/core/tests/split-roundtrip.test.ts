import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";
import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * Principle IV, for the one new way this feature writes `inbox.md`.
 *
 * A dictated item can contain blank lines, and Feature 1's serializer indents
 * continuation lines. A piece that spans a blank line must round-trip through
 * `parseInbox` as **one** item — if it did not, accepting a split would turn
 * one thought into two, the second losing its timestamp, and the user would
 * have no way to tell that had happened by reading the file (research R10).
 *
 * The property: whatever strings go in come back out, exactly, in order.
 */

const CAPTURED = "- 2026-08-17T09:14:22-04:00 the original item\n";
const HANDWRITTEN = "an item I typed myself\n";

async function roundTrip(original: string, pieces: string[]): Promise<string[]> {
  const inbox = new FakeInboxDocument(original);
  const service = new SortService({
    inbox,
    vault: new FakeVaultStore(),
    journal: new FakeSortJournal(),
    clock: fixedClock(),
  });

  const item = await service.next();
  assert.ok(item);
  const outcome = await service.split(item.ref, pieces);
  assert.equal(outcome.ok, true, "the fixture must produce a writable split");

  return parseInbox(inbox.content).map((i) => i.text);
}

const CASES: { name: string; pieces: string[] }[] = [
  { name: "plain single-line pieces", pieces: ["roof estimate", "dentist thursday"] },
  { name: "one piece", pieces: ["only this"] },
  { name: "many pieces", pieces: ["a", "b", "c", "d", "e", "f"] },
  { name: "a multi-line piece", pieces: ["first line\nsecond line", "another item"] },
  { name: "a piece containing a blank line", pieces: ["before the gap\n\nafter the gap", "a second item"] },
  { name: "two pieces each containing a blank line", pieces: ["one\n\ntwo", "three\n\nfour"] },
  { name: "a piece with several consecutive blank lines", pieces: ["top\n\n\n\nbottom", "next"] },
  { name: "a piece with leading whitespace on a line", pieces: ["heading\n    indented detail", "next"] },
  { name: "a piece that looks like a list", pieces: ["- not a new item\n- also not", "a real second item"] },
  { name: "non-ASCII", pieces: ["café renovation", "日本語のメモ", "emoji 🎉 here"] },
  { name: "a piece with trailing spaces", pieces: ["trailing spaces here   ", "and another"] },
  { name: "a piece with a lone hash", pieces: ["# not a heading of the file", "second"] },
  { name: "long text", pieces: ["x".repeat(500), "y".repeat(500)] },
];

describe("pieces round-trip through parseInbox exactly", () => {
  for (const { name, pieces } of CASES) {
    test(`${name}, from a captured item`, async () => {
      assert.deepEqual(await roundTrip(CAPTURED, pieces), pieces);
    });

    test(`${name}, from a hand-written item`, async () => {
      assert.deepEqual(await roundTrip(HANDWRITTEN, pieces), pieces);
    });
  }
});

/**
 * One case where the round-trip is not exact, stated rather than hidden.
 *
 * A piece whose own text begins with something shaped like `- <ISO 8601> `
 * cannot survive as a *hand-written* item, because that is precisely how
 * Feature 1's format spells a captured one. This is a property of the plain
 * text, not of splitting: a user typing the same line into `inbox.md` by hand
 * gets the same reading, and has since Feature 1.
 *
 * A captured item's pieces are unaffected — they get their own timestamp
 * prefix, so the lookalike is carried as ordinary text.
 */
describe("the one case the format cannot round-trip", () => {
  test("a captured item's piece may contain a timestamp-shaped line", async () => {
    const back = await roundTrip(CAPTURED, ["- 2020-01-01T00:00:00-05:00 looks captured", "plain"]);
    assert.deepEqual(back, ["- 2020-01-01T00:00:00-05:00 looks captured", "plain"]);
  });

  test("a hand-written item's piece cannot, and reads as a captured item instead", async () => {
    const back = await roundTrip(HANDWRITTEN, ["- 2020-01-01T00:00:00-05:00 looks captured", "plain"]);

    // Not a defect introduced here: `parseInbox` has read this shape as a
    // captured item since Feature 2, and the text is still present verbatim
    // in the file. Nothing is lost; it is read as timestamped.
    assert.deepEqual(back, ["looks captured", "plain"]);
  });
});

describe("the count is what was asked for", () => {
  test("a piece spanning a blank line is one item, not two", async () => {
    const back = await roundTrip(CAPTURED, ["before the gap\n\nafter the gap"]);
    assert.equal(back.length, 1, "the blank line split one thought into two items");
  });

  test("n pieces in, n items out, for every case", async () => {
    for (const { pieces } of CASES) {
      assert.equal((await roundTrip(CAPTURED, pieces)).length, pieces.length);
    }
  });
});

describe("the file is indistinguishable from one typed by hand", () => {
  test("splitting into pieces produces what capturing those pieces would have", async () => {
    const inbox = new FakeInboxDocument(CAPTURED);
    const service = new SortService({
      inbox,
      vault: new FakeVaultStore(),
      journal: new FakeSortJournal(),
      clock: fixedClock(),
    });
    const item = await service.next();
    assert.ok(item);
    await service.split(item.ref, ["roof estimate", "dentist thursday"]);

    // Byte-identical to two ordinary captured items at the same instant.
    assert.equal(
      inbox.content,
      "- 2026-08-17T09:14:22-04:00 roof estimate\n- 2026-08-17T09:14:22-04:00 dentist thursday\n",
    );
  });

  test("a split file can be split again, so nothing about it is special", async () => {
    const inbox = new FakeInboxDocument(CAPTURED);
    const service = new SortService({
      inbox,
      vault: new FakeVaultStore(),
      journal: new FakeSortJournal(),
      clock: fixedClock(),
    });

    const first = await service.next();
    assert.ok(first);
    await service.split(first.ref, ["roof estimate and gutters", "dentist thursday"]);

    const second = await service.next();
    assert.ok(second);
    await service.split(second.ref, ["roof estimate", "gutters"]);

    assert.deepEqual(parseInbox(inbox.content).map((i) => i.text), [
      "roof estimate",
      "gutters",
      "dentist thursday",
    ]);
  });
});
