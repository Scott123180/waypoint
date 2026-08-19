import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import * as core from "../src/index";
import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * A calendar flag is information, and there is nothing in core that could act on
 * one (FR-042).
 *
 * Not "no client offers a button" — **no verb exists to put behind one**. There
 * is no `CalendarRef`, `StaleCalendar` carries no identity a verb could take, and
 * no exported function anywhere in core accepts a `CalendarItem`. A contributor
 * who wanted to add scheduling here would have to write the verb first, which is
 * a visible change rather than a quiet one.
 *
 * The channel and bridge half is `shutdown-ipc-contract.test.ts`'s, because core
 * imports nothing from Electron and cannot see a channel.
 */

const SRC = join(__dirname, "..", "..", "src");

describe("the calendar module exports no writer", () => {
  test("only the path and the parser leave it", () => {
    assert.deepEqual(
      Object.keys(core).filter((n) => /calendar/i.test(n)).sort(),
      ["CALENDAR_PATH", "readCalendar"],
    );
  });

  test("`readCalendar` returns items and unreadable lines, and nothing callable", () => {
    const { items, unreadable } = core.readCalendar("- 2026-07-30 — Quarterly planning day\n");

    assert.deepEqual(Object.keys(items[0] ?? {}).sort(), [
      "capturedAt",
      "flaggedOn",
      "index",
      "raw",
      "text",
    ]);
    assert.deepEqual(unreadable, []);
    for (const value of Object.values(items[0] ?? {})) {
      assert.notEqual(typeof value, "function", "an item must carry no verb of its own");
    }
  });
});

describe("no core verb accepts a calendar item", () => {
  const FILES = walk(SRC).filter((p) => p.endsWith(".ts") && !p.includes(`${join("src", "calendar")}`));

  test("`CalendarItem` appears in exactly one place outside its own module", () => {
    const naming = FILES.filter((p) => readFileSync(p, "utf8").includes("CalendarItem"));

    assert.deepEqual(
      naming.map((p) => p.slice(SRC.length + 1)).sort(),
      [join("index.ts"), join("shutdown", "types.ts")],
      "a third file naming it would be somewhere a verb could take one",
    );
  });

  test("and `shutdown/types.ts` only holds it, never takes it", () => {
    const source = readFileSync(join(SRC, "shutdown", "types.ts"), "utf8");

    // A type declaration, never a function parameter.
    assert.match(source, /item: CalendarItem;/);
    assert.doesNotMatch(source, /\((?:[^)]*)CalendarItem/, "no signature takes one");
  });

  test("there is no `CalendarRef` anywhere in core", () => {
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
      assert.ok(!source.includes("CalendarRef"), `${file} declares a ref implying a write`);
    }
  });

  test("`StaleCalendar` carries no ref, index-plus-raw pair, or action", () => {
    const source = readFileSync(join(SRC, "shutdown", "types.ts"), "utf8");
    const declaration = /export interface StaleCalendar \{([\s\S]*?)\n\}/.exec(source);
    assert.ok(declaration);

    const fields = [...(declaration[1] ?? "").matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    assert.deepEqual(fields.sort(), ["item", "reason", "unscheduledDays"]);
  });
});

describe("nothing this feature does writes to calendar.md", () => {
  test("a full reading leaves the file byte-identical", async () => {
    const before = populatedVault();
    const { shutdown, vault } = actingVault({ ...before });

    await shutdown.read();

    assert.equal(snapshot(vault)["calendar.md"], before["calendar.md"]);
  });

  test("and so does taking every action the screen offers", async () => {
    const before = populatedVault();
    const { shutdown, projects, topThree, waiting, vault } = actingVault({ ...before });

    const view = await shutdown.read();
    const week = view.topThree.week;
    const outcome = week?.outcomes.find((o) => !o.done);
    const milestone = view.projects.items[0]?.openMilestones[0];
    const stale = view.waiting.items[0];
    assert.ok(week && outcome && milestone && stale);

    await topThree.completeOutcome({ week: week.id, index: outcome.index, raw: outcome.raw });
    await projects.completeMilestone("alpha", { index: milestone.index, raw: milestone.raw });
    await waiting.recordFollowUp({ index: stale.item.index, raw: stale.item.raw });

    assert.equal(snapshot(vault)["calendar.md"], before["calendar.md"]);
    assert.deepEqual(vault.writeLog.filter((p) => p === "calendar.md"), []);
  });

  test("the shutdown service never names the line writer that could", () => {
    const source = readFileSync(join(SRC, "shutdown", "shutdown-service.ts"), "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    assert.ok(!source.includes("calendarLine"), "rendering a flag line here would make this a writer");
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
