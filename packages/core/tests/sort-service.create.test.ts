import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { parseInbox } from "../src/inbox/parse";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

const INBOX = "- 2026-08-09T14:23:05-04:00 Book flights for the offsite\nsecond\n";
const ref = () => {
  const item = parseInbox(INBOX)[0]!;
  return { start: item.start, end: item.end, raw: item.raw };
};

const make = (files: Record<string, string> = {}) => {
  const doc = new FakeInboxDocument(INBOX);
  const vault = new FakeVaultStore();
  for (const [p, c] of Object.entries(files)) vault.files.set(p, c);
  const journal = new FakeSortJournal();
  const service = new SortService({ inbox: doc, vault, journal, clock: fixedClock() });
  return { doc, vault, journal, service };
};

describe("creating a destination during sort", () => {
  test("creates the stub and files the item in one action", async () => {
    const { doc, vault, service } = make();

    const outcome = await service.sort(ref(), { to: "project", createTitle: "March offsite" });

    assert.deepEqual(outcome, { ok: true, destination: "projects/march-offsite.md" });
    const file = vault.files.get("projects/march-offsite.md") ?? "";
    assert.match(file, /^# March offsite$/m);
    assert.match(file, /^status: active$/m);
    assert.match(file, /## Unprocessed\n\n- 2026-08-09T14:23:05-04:00 Book flights/);
    assert.ok(!doc.content.includes("Book flights"));
  });

  test("asks for nothing beyond the title", async () => {
    const { vault, service } = make();
    await service.sort(ref(), { to: "area", createTitle: "Health" });

    const file = vault.files.get("areas/health.md") ?? "";
    for (const field of ["outcome", "milestone", "next action", "DRI"]) {
      assert.doesNotMatch(file, new RegExp(field, "i"));
    }
  });

  test("a matching title routes to the existing destination, not a duplicate", async () => {
    // FR-012: case and spacing differences are the same project.
    const { vault, service } = make({
      "projects/march-offsite.md": "# March offsite\n\nstatus: active\n\n## Unprocessed\n",
    });

    const outcome = await service.sort(ref(), {
      to: "project",
      createTitle: "  march   OFFSITE  ",
    });

    assert.deepEqual(outcome, { ok: true, destination: "projects/march-offsite.md" });
    assert.equal(
      [...vault.files.keys()].filter((k) => k.startsWith("projects/")).length,
      1,
      "no second file may be created",
    );
  });

  test("a genuinely different title colliding on slug gets a suffix", async () => {
    const { vault, service } = make({ "projects/roof.md": "# Roof\n" });

    // "Roof!" slugs to "roof", which is taken by a different title... but slug
    // equality is the identity test, so this correctly reuses it.
    const outcome = await service.sort(ref(), { to: "project", createTitle: "Roof!" });

    assert.deepEqual(outcome, { ok: true, destination: "projects/roof.md" });
    assert.equal([...vault.files.keys()].filter((k) => k.startsWith("projects/")).length, 1);
  });

  test("an empty title creates nothing and leaves the item unsorted", async () => {
    const { doc, vault, service } = make();

    const outcome = await service.sort(ref(), { to: "project", createTitle: "   " });

    assert.equal(!outcome.ok && outcome.reason, "empty-title");
    assert.equal(vault.files.size, 0);
    assert.equal(doc.content, INBOX);
  });

  test("a title of only punctuation is treated as empty", async () => {
    const { vault, service } = make();

    const outcome = await service.sort(ref(), { to: "area", createTitle: "???" });

    assert.equal(!outcome.ok && outcome.reason, "empty-title");
    assert.equal(vault.files.size, 0);
  });

  test("the new destination appears for later items", async () => {
    const { service } = make();
    await service.sort(ref(), { to: "project", createTitle: "March offsite" });

    const { projects } = await service.destinations();
    assert.deepEqual(projects.map((p) => p.title), ["March offsite"]);
  });

  test("a stub is never left behind when the item does not move", async () => {
    // The create and the file are one operation (FR-010): if the inbox no
    // longer matches, the whole decision is refused.
    const { doc, vault, service } = make();
    doc.content = "totally different content\n";

    const outcome = await service.sort(ref(), { to: "project", createTitle: "Orphan risk" });

    assert.equal(!outcome.ok && outcome.reason, "item-changed");
    assert.equal(
      vault.files.has("projects/orphan-risk.md"),
      false,
      "a stub with no item is an orphan the user never asked for",
    );
  });
});
