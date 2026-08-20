import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The capture box re-joins every Space on every open, not just at creation.
 *
 * Membership is the window's connection to the macOS window server, and it is
 * not ours alone to keep — a process transform can drop it, and one stale
 * membership strands the box on the startup desktop for the rest of the
 * session. Claiming it once at creation is therefore not enough; the claim is
 * re-stated on the path that is already showing a window.
 *
 * What this can and cannot see: Spaces are a macOS concept, so the *effect* is
 * unobservable on the Linux dev machine. The *call* is not. This asserts that
 * showing the box re-states the claim, with the options that make doing so
 * free, which is exactly the regression — the previous code called it once,
 * inside `create()`, and never again.
 *
 * The ordering half — that the dock is hidden before any window exists — is
 * `tests/capture-spaces-ordering.test.ts`, asserted statically because
 * `app.dock` is `undefined` here.
 */
let h: Harness;

interface SpaceCall {
  visible: boolean;
  visibleOnFullScreen?: boolean;
  skipTransformProcessType?: boolean;
}

/**
 * Records every `setVisibleOnAllWorkspaces` from here on, and returns them.
 *
 * Patches the prototype rather than one window because the capture window is
 * built at startup, long before a test can reach it — so calls are counted
 * from the first `show()` onward, which is the part under test anyway.
 */
async function watchSpaceClaims(harness: Harness): Promise<void> {
  await harness.app.evaluate(({ BrowserWindow }) => {
    const store = globalThis as unknown as Record<string, unknown>;
    if (store["__spacePatched"]) {
      store["__spaceCalls"] = [];
      return;
    }
    store["__spaceCalls"] = [];
    const proto = BrowserWindow.prototype as unknown as Record<string, unknown>;
    const original = proto["setVisibleOnAllWorkspaces"] as (...a: unknown[]) => unknown;
    proto["setVisibleOnAllWorkspaces"] = function (this: unknown, visible: boolean, opts?: object) {
      (store["__spaceCalls"] as object[]).push({ visible, ...(opts ?? {}) });
      return original.call(this, visible, opts);
    };
    store["__spacePatched"] = true;
  });
}

async function claims(harness: Harness): Promise<SpaceCall[]> {
  return await harness.app.evaluate(() => {
    const store = globalThis as unknown as Record<string, unknown>;
    return (store["__spaceCalls"] ?? []) as SpaceCall[];
  });
}

test.beforeEach(async () => {
  h = await launch();
  await watchSpaceClaims(h);
});

test.afterEach(async () => {
  await h.close();
});

test("opening the box re-states its Spaces membership", async () => {
  expect(await claims(h)).toHaveLength(0);

  await h.trigger();
  expect(await h.isBoxVisible()).toBe(true);

  const calls = await claims(h);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0]).toMatchObject({
    visible: true,
    visibleOnFullScreen: true,
    // Without this the claim would transform the process on every open,
    // flashing the dock at the user each time they capture a thought.
    skipTransformProcessType: true,
  });
});

test("every subsequent open re-states it again", async () => {
  // The defect this guards: one claim at creation, never renewed. A membership
  // dropped later is then never recovered, and the box answers on the desktop
  // the app started on for the rest of the session.
  await h.trigger();
  const afterFirst = (await claims(h)).length;
  expect(afterFirst).toBeGreaterThan(0);

  await h.app.evaluate(() => {
    (globalThis as unknown as Record<string, { hideCapture(): void }>)["__waypoint"].hideCapture();
  });
  await h.trigger();

  expect((await claims(h)).length).toBeGreaterThan(afterFirst);
});

test("being brought forward while already visible re-states it too", async () => {
  // Showing an already-visible box takes the focus-only path. That path still
  // shows a window, so it still has to make the claim.
  await h.trigger();
  const afterFirst = (await claims(h)).length;

  await h.trigger();

  expect((await claims(h)).length).toBeGreaterThan(afterFirst);
});
