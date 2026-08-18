import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { launch, type Harness } from "./harness";

/**
 * Quickstart scenarios 4 and 5: untangling a rambling capture, and being told
 * what a split would drop.
 *
 * Written before the proposal panel existed, so its Red was "no proposal panel
 * appeared" rather than a wrong assertion about one.
 *
 * The transport is the fake CLI fixture, configured through `intelligence.md`
 * exactly as a user would configure a real tool — so this exercises the whole
 * path: config read at startup, bridge attached, payload prepared, request
 * spawned, response parsed, pieces sliced from the original, accept written
 * through `SortService.split`.
 */

const FAKE_CLI = resolve(__dirname, "../../dist/tests/fixtures/fake-llm-cli.sh");

const DICTATION =
  "ok so the hiring req, no wait, the req for the backend role, I need to get that written up. " +
  "Also dentist, Thursday I think. And the deploy pipeline keeps timing out on the migration step.";

const ITEM = `- 2026-08-17T09:14:22-04:00 ${DICTATION}\n`;

/** Three thoughts: the two hiring false starts together, then two more. */
const THREE_PIECES = JSON.stringify({ pieces: [[0], [1], [2]], nothingToSplit: false });

async function open(reply: string): Promise<Harness> {
  const h = await launch({
    seedVault: {
      "intelligence.md": ["# Intelligence", "", "transport: command", `command: ${FAKE_CLI}`, ""].join("\n"),
    },
    env: { FAKE_LLM_OUTPUT: reply },
  });
  h.writeInbox(ITEM);
  await h.openSort();
  return h;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

test("the split control is offered when a transport is configured", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await expect(view.locator("#to-split")).toBeVisible();
  } finally {
    await h.close();
  }
});

test("asking shows what would be sent, and sends nothing yet", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");

    // FR-041: the exact request content, before anything leaves the machine.
    await expect(view.locator("#preview")).toBeVisible();
    await expect(view.locator("#preview")).toContainText("the hiring req");
    await expect(view.locator("#proposal")).toHaveCount(0);
  } finally {
    await h.close();
  }
});

test("running produces three pieces, each in the user's own words", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");

    await view.waitForSelector(".piece");
    // `inputValue`, not `innerText`: a textarea's content is its value, and
    // reading the wrong one silently compares against an empty string.
    const areas = view.locator(".piece textarea");
    const pieces = await areas.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLTextAreaElement).value),
    );
    expect(pieces).toHaveLength(3);

    // Verbatim, stutters and all: every piece is a span of the original.
    for (const piece of pieces) {
      expect(DICTATION).toContain(piece.trim());
    }
    expect(pieces[0]).toContain("no wait");
  } finally {
    await h.close();
  }
});

test("accepting replaces the one item with three, in its place and at its capture time", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");
    await view.click("#accept-split");

    await expect
      .poll(() => h.inbox().split("\n").filter((l) => l.startsWith("- ")).length)
      .toBe(3);

    const lines = h.inbox().split("\n").filter(Boolean);
    for (const line of lines) {
      // The original's capture time, not the time of the split (FR-016).
      expect(line).toMatch(/^- 2026-08-17T09:14:22-04:00 /);
    }
    // Indistinguishable from three items typed by hand.
    expect(h.inbox()).not.toMatch(/suggest|proposal|machine/i);
  } finally {
    await h.close();
  }
});

test("rejecting leaves the file byte-for-byte as it was", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");
    await view.click("#reject-split");

    await expect(view.locator("#proposal")).toHaveCount(0);
    expect(sha(h.inbox())).toBe(before);
  } finally {
    await h.close();
  }
});

test("a piece can be edited before accepting", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");

    await view.fill(".piece:nth-child(1) textarea", "write the backend hiring req");
    await view.click("#accept-split");

    await expect.poll(() => h.inbox()).toContain("write the backend hiring req");
    expect(h.inbox()).not.toContain("no wait");
  } finally {
    await h.close();
  }
});

/** Quickstart scenario 5: nothing dictated is dropped silently. */
test("deleting a piece surfaces the text no piece carries", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");

    await view.click(".piece:nth-child(2) .drop");

    // FR-013: shown before the accept completes, marked as not carried.
    await expect(view.locator("#uncovered")).toBeVisible();
    await expect(view.locator("#uncovered")).toContainText("dentist");
  } finally {
    await h.close();
  }
});

test("a dropped piece can be put back", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");

    await view.click(".piece:nth-child(2) .drop");
    await expect(view.locator("#uncovered")).toBeVisible();

    await view.click(".piece:nth-child(2) .drop");
    await expect(view.locator("#uncovered")).toBeHidden();
  } finally {
    await h.close();
  }
});

test("deleting every piece and accepting is refused, and the original stands", async () => {
  const h = await open(THREE_PIECES);
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-split");
    await view.click("#send");
    await view.waitForSelector(".piece");

    for (const index of [1, 2, 3]) await view.click(`.piece:nth-child(${index}) .drop`);
    await view.click("#accept-split");

    await expect(view.locator("#notice")).toContainText(/at least one piece/i);
    expect(sha(h.inbox())).toBe(before);
  } finally {
    await h.close();
  }
});

test("an item holding one thought is said to hold one thought", async () => {
  const h = await open(JSON.stringify({ pieces: [], nothingToSplit: true }));
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");

    await expect(view.locator("#proposal")).toContainText(/one thought|nothing to split/i);
    await expect(view.locator(".piece")).toHaveCount(0);
    await expect(view.locator("#accept-split")).toHaveCount(0);
  } finally {
    await h.close();
  }
});

test("an answer that cannot be understood shows one message and no partial proposal", async () => {
  const h = await open("not json at all");
  try {
    const view = await h.sortView();
    const before = sha(h.inbox());

    await view.click("#to-split");
    await view.click("#send");

    await expect(view.locator("#notice")).toContainText(/could not be understood/i);
    await expect(view.locator(".piece")).toHaveCount(0);
    expect(sha(h.inbox())).toBe(before);

    // And the ordinary sort path works immediately.
    await view.click("#to-trash");
    await expect.poll(() => h.inbox()).toBe("");
  } finally {
    await h.close();
  }
});
