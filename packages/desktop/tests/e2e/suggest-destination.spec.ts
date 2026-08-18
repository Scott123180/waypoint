import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { launch, type Harness } from "./harness";

/**
 * Quickstart scenario 6 — asking where something belongs — plus the sequence
 * this feature exists for: split a rambling capture, then place each piece on
 * its own (T045a, FR-026).
 *
 * Written before the destination panel existed, so its Red was "no destination
 * proposal appeared".
 */

const FAKE_CLI = resolve(__dirname, "../../dist/tests/fixtures/fake-llm-cli.sh");

const PROJECT = [
  "# Vendor Consolidation",
  "",
  "status: active",
  "",
  "## Outcome",
  "",
  "Every vendor contract renewed or ended by Q4, with one owner named for each.",
  "",
].join("\n");

const ITEM =
  "- 2026-08-17T10:00:00-04:00 chase Priya about the vendor contract before the board pack goes out\n";

async function open(reply: string, extra: Record<string, string> = {}): Promise<Harness> {
  const h = await launch({
    seedVault: {
      "intelligence.md": ["transport: command", `command: ${FAKE_CLI}`, ""].join("\n"),
      "projects/vendor-consolidation.md": PROJECT,
      "areas/home.md": "# Home\n\nstatus: active\n",
      ...extra,
    },
    env: { FAKE_LLM_OUTPUT: reply },
  });
  h.writeInbox(ITEM);
  await h.openSort();
  return h;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const TO_PROJECT = JSON.stringify({
  destination: "project",
  slug: "vendor-consolidation",
  reason: "it is the vendor contract this project is about",
});

test("the preview carries each project's title and outcome, and no more of the file", async () => {
  const h = await open(TO_PROJECT);
  try {
    const view = await h.sortView();
    await view.click("#to-where");

    const preview = view.locator("#preview");
    await expect(preview).toContainText("Vendor Consolidation");
    await expect(preview).toContainText("Every vendor contract renewed");
    await expect(preview).toContainText("Home");
    // FR-043: a title and a stated outcome, nothing else from the project file.
    await expect(preview).not.toContainText("status:");
    await expect(preview).not.toContainText("Unprocessed");
  } finally {
    await h.close();
  }
});

test("one destination is proposed, with a brief reason", async () => {
  const h = await open(TO_PROJECT);
  try {
    const view = await h.sortView();
    await view.click("#to-where");
    await view.click("#send");

    await expect(view.locator("#destination")).toContainText("vendor-consolidation");
    await expect(view.locator("#reason")).toContainText("vendor contract");
    await expect(view.locator("#is-new")).toHaveCount(0);
  } finally {
    await h.close();
  }
});

test("accepting produces exactly what sorting by hand produces", async () => {
  const h = await open(TO_PROJECT);
  try {
    const view = await h.sortView();
    await view.click("#to-where");
    await view.click("#send");
    await view.click("#accept-destination");

    await expect.poll(() => h.inbox()).toBe("");

    const project = h.vaultFile("projects/vendor-consolidation.md");
    expect(project).toContain("## Unprocessed");
    expect(project).toContain("chase Priya about the vendor contract");
    // FR-032: nothing anywhere records that a machine proposed it.
    expect(project).not.toMatch(/suggest|proposal|reason|model/i);
  } finally {
    await h.close();
  }
});

test("rejecting writes nothing, and the ordinary five still work", async () => {
  const h = await open(TO_PROJECT);
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-where");
    await view.click("#send");
    await view.click("#reject-destination");

    await expect(view.locator("#proposal")).toHaveCount(0);
    expect(sha(h.inbox())).toBe(before);

    await view.click("#to-trash");
    await expect.poll(() => h.inbox()).toBe("");
  } finally {
    await h.close();
  }
});

test("a proposal to create something is marked as not existing yet", async () => {
  const h = await open(
    JSON.stringify({ destination: "project", createTitle: "Board Pack Q4", reason: "new work with an end" }),
  );
  try {
    const view = await h.sortView();
    await view.click("#to-where");
    await view.click("#send");

    // FR-023: a clearly-marked new thing that the user confirms.
    await expect(view.locator("#is-new")).toBeVisible();
    await expect(view.locator("#destination")).toContainText("Board Pack Q4");
    await expect(view.locator("#accept-destination")).toContainText(/create/i);

    // Nothing exists until the confirmation.
    expect(h.vaultDir("projects")).toEqual(["vendor-consolidation.md"]);

    await view.click("#accept-destination");
    await expect.poll(() => h.vaultDir("projects")).toEqual(["board-pack-q4.md", "vendor-consolidation.md"]);
  } finally {
    await h.close();
  }
});

test("a waiting-for proposal carries an editable owner", async () => {
  const h = await open(
    JSON.stringify({ destination: "waiting", owner: "Priya", reason: "she owes the contract" }),
  );
  try {
    const view = await h.sortView();
    await view.click("#to-where");
    await view.click("#send");

    await expect(view.locator("#proposed-owner")).toHaveValue("Priya");

    await view.fill("#proposed-owner", "Priya Raghunathan");
    await view.click("#accept-destination");

    // The recorded owner is what the user typed, not what was proposed.
    await expect.poll(() => h.vaultFile("waiting.md")).toMatch(/@Priya Raghunathan —/);
  } finally {
    await h.close();
  }
});

test("an owner the item never named is left empty, and the sort refuses until it is filled", async () => {
  const h = await open(JSON.stringify({ destination: "waiting", owner: "", reason: "somebody has it" }));
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-where");
    await view.click("#send");
    await expect(view.locator("#proposed-owner")).toHaveValue("");

    await view.click("#accept-destination");

    // Feature 2's own refusal, unchanged (FR-033).
    await expect(view.locator("#notice")).toContainText(/Waiting-for needs a name/);
    expect(sha(h.inbox())).toBe(before);
  } finally {
    await h.close();
  }
});

test("a project that does not exist is never presented as existing", async () => {
  const h = await open(
    JSON.stringify({ destination: "project", slug: "not-a-real-project", reason: "invented" }),
  );
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-where");
    await view.click("#send");

    await expect(view.locator("#notice")).toContainText(/could not be understood/i);
    await expect(view.locator("#destination")).toHaveCount(0);
    expect(sha(h.inbox())).toBe(before);
  } finally {
    await h.close();
  }
});

test("choosing somewhere else returns to the five, with nothing written", async () => {
  const h = await open(TO_PROJECT);
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-where");
    await view.click("#send");
    await view.click("#choose-other");

    await expect(view.locator("#proposal")).toHaveCount(0);
    await expect(view.locator("#to-project")).toBeVisible();
    expect(sha(h.inbox())).toBe(before);
  } finally {
    await h.close();
  }
});

/**
 * The sequence the feature exists for: one dictation, three thoughts, each
 * placed on its own (T045a, FR-026).
 */
test("after a split, each piece can be asked about individually", async () => {
  const h = await launch({
    seedVault: {
      "intelligence.md": ["transport: command", `command: ${FAKE_CLI}`, ""].join("\n"),
      "projects/vendor-consolidation.md": PROJECT,
    },
    // One canned answer for the split; the destination answers come after the
    // env is re-read per spawn, so a single reply that satisfies both shapes
    // is not possible — the split runs first, then this is replaced below.
    env: { FAKE_LLM_OUTPUT: JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }) },
  });

  try {
    h.writeInbox("- 2026-08-17T10:00:00-04:00 chase Priya about the contract. book the dentist.\n");
    await h.openSort();
    const view = await h.sortView();

    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");
    await view.click("#accept-split");

    // Two ordinary inbox items, each askable on its own.
    await expect.poll(() => h.inbox().split("\n").filter((l) => l.startsWith("- ")).length).toBe(2);

    await view.click("#to-where");
    const first = await view.locator("#preview").innerText();
    expect(first).toContain("chase Priya about the contract");
    // FR-026: this piece's text alone — its sibling is a separate request.
    expect(first).not.toContain("book the dentist");
  } finally {
    await h.close();
  }
});
