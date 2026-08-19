import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The client half of this feature's boundaries (FR-042, research R2,
 * contracts/shutdown-api.md §3, §4).
 *
 * Four properties, each of which fails **silently** if it is lost — which is why
 * they are asserted here rather than trusted:
 *
 *   1. **The waiting verbs go to `WaitingService`, not `ReviewService`.** The
 *      review's channels write a line into `log/YYYY-Www.md` — its record of its
 *      own ritual — and reaching them from here would write a record of the
 *      shutdown while every test about `waiting.md` still passed (FR-050).
 *
 *   2. **No channel named for this screen performs a write.** `shutdown:read`
 *      reads and `shutdown:dismiss` hides; every action goes to the channel the
 *      ordinary surface already uses, so the two can never diverge.
 *
 *   3. **Nothing writes to `calendar.md`, clears a flag, or schedules
 *      anything.** This is the client half of `shutdown-calendar-read-only`,
 *      asserted here because core imports nothing from Electron and cannot see a
 *      channel.
 *
 *   4. **`shutdown:dismiss` is a window-hide**, matching the six shipped windows
 *      that already have one.
 *
 * Source-level, in the style `review-ipc.test.ts` sets out: wiring Electron's
 * IPC into a unit test would test the harness. What can go wrong here is someone
 * writing the wrong channel name, and that is visible in the file.
 */

const SRC = join(__dirname, "..", "..", "src");

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

const IPC = read("main", "ipc.ts");
const PRELOAD = read("preload", "preload.ts");

/** The body of `registerShutdownIpc`, which is what this feature added. */
const REGISTRATION = (() => {
  const match = /export function registerShutdownIpc\([\s\S]*?\n\}\n/.exec(IPC);
  assert.ok(match, "registerShutdownIpc must be declared in ipc.ts");
  return match[0];
})();

/** The `shutdownApi` object literal in the preload. */
const BRIDGE = (() => {
  const match = /const shutdownApi = \{([\s\S]*?)\n\};/.exec(PRELOAD);
  assert.ok(match, "shutdownApi must be declared in preload.ts");
  return match[1] ?? "";
})();

/** Every channel string the bridge reaches for. */
const BRIDGE_CHANNELS = [...BRIDGE.matchAll(/ipcRenderer\.(?:invoke|send|on)\("([^"]+)"/g)].map(
  (m) => m[1] as string,
);

describe("the waiting verbs", () => {
  test("are registered on channels named for the verb, not for this screen", () => {
    assert.match(REGISTRATION, /ipcMain\.handle\("waiting:record-follow-up"/);
    assert.match(REGISTRATION, /ipcMain\.handle\("waiting:record-received"/);
  });

  test("call `WaitingService` directly", () => {
    assert.match(REGISTRATION, /waiting\.recordFollowUp\(ref\)/);
    assert.match(REGISTRATION, /waiting\.recordReceived\(ref\)/);
  });

  test("and never `ReviewService`", () => {
    assert.ok(
      !/review\./i.test(REGISTRATION),
      "ReviewService writes a review log line; reaching it from here writes a record of the shutdown",
    );
    assert.ok(!REGISTRATION.includes("ReviewService"));
    assert.ok(!BRIDGE.includes("review:"), "and the bridge must not route around this either");
  });

  test("the review keeps its own channels, unchanged", () => {
    // The tripwire must not have been satisfied by taking the review's channels
    // away, which would break Feature 5 rather than protect Feature 9.
    assert.match(IPC, /ipcMain\.handle\("review:record-follow-up"/);
    assert.match(IPC, /review\.recordFollowUp\(ref\)/);
  });
});

describe("no channel named for this screen writes", () => {
  test("`registerShutdownIpc` registers exactly four channels", () => {
    const channels = [...REGISTRATION.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1]);

    assert.deepEqual(channels.sort(), [
      "shutdown:dismiss",
      "shutdown:read",
      "waiting:record-follow-up",
      "waiting:record-received",
    ]);
  });

  test("the two `shutdown:*` ones read and hide, and nothing else", () => {
    assert.match(REGISTRATION, /ipcMain\.handle\("shutdown:read", async \(\) => shutdown\.read\(\)\)/);
    assert.match(REGISTRATION, /ipcMain\.on\("shutdown:dismiss", \(\) => hideShutdown\(\)\)/);
  });

  test("`shutdown:dismiss` is an `ipcMain.on`, like the six windows before it", () => {
    for (const channel of [
      "capture:dismiss",
      "sort:dismiss",
      "projects:dismiss",
      "top-three:dismiss",
      "review:dismiss",
      "retrospective:dismiss",
    ]) {
      assert.match(IPC, new RegExp(`ipcMain\\.on\\("${channel.replace(":", ":")}"`), `${channel} changed shape`);
    }
    assert.doesNotMatch(REGISTRATION, /ipcMain\.handle\("shutdown:dismiss"/);
  });
});

describe("the five actions go to the ordinary surfaces' channels", () => {
  const EXPECTED: Record<string, string> = {
    completeOutcome: "top-three:complete",
    completeMilestone: "projects:complete-milestone",
    setNextAction: "projects:set-field",
    recordFollowUp: "waiting:record-follow-up",
    recordReceived: "waiting:record-received",
  };

  for (const [method, channel] of Object.entries(EXPECTED)) {
    test(`${method} forwards to \`${channel}\``, () => {
      const body = new RegExp(`\\n  ${method}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(BRIDGE);
      assert.ok(body, `${method} must be on the shutdown bridge`);
      assert.match(body[1] ?? "", new RegExp(`ipcRenderer\\.invoke\\("${channel}"`));
    });
  }

  test("the next action uses the projects window's own field channel", () => {
    const body = /\n  setNextAction\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(BRIDGE);
    assert.match(body?.[1] ?? "", /"projects:set-field", slug, "next-action"/);
  });

  test("the bridge introduces no channel of its own for any of them", () => {
    const invented = BRIDGE_CHANNELS.filter(
      (c) => c.startsWith("shutdown:") && !["shutdown:read", "shutdown:dismiss", "shutdown:opened"].includes(c),
    );
    assert.deepEqual(invented, []);
  });
});

describe("nothing writes to calendar.md, clears a flag, or schedules anything", () => {
  test("no channel anywhere names the calendar", () => {
    for (const [name, source] of Object.entries({ "ipc.ts": IPC, "preload.ts": PRELOAD })) {
      const channels = [...source.matchAll(/(?:ipcMain\.(?:handle|on)|ipcRenderer\.(?:invoke|send|on))\("([^"]+)"/g)]
        .map((m) => m[1] as string);

      for (const channel of channels) {
        assert.doesNotMatch(channel, /calendar|schedule|unflag/i, `${name} declares ${channel}`);
      }
    }
  });

  test("the shutdown bridge offers no verb that could act on a flag", () => {
    for (const forbidden of ["schedule", "clearFlag", "unflag", "snooze", "calendar"]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(BRIDGE),
        `${forbidden} on the bridge would be an action a calendar flag must not have`,
      );
    }
  });

  test("`registerShutdownIpc` never names CALENDAR_PATH or a write verb on the vault", () => {
    for (const forbidden of ["CALENDAR_PATH", "vault.write", "appendLine"]) {
      assert.ok(!REGISTRATION.includes(forbidden), `${forbidden} would make this a writer`);
    }
  });
});

describe("the bridge decides nothing", () => {
  test("it holds no threshold, filter, or ordering", () => {
    for (const forbidden of ["stalenessDays", "staleness", "filter(", "sort(", "slice(", "days >"]) {
      assert.ok(!BRIDGE.includes(forbidden), `${forbidden} is a rule the core already answered`);
    }
  });

  test("and composes no sentence about the user's data", () => {
    // Any string literal that is not a channel name would be the client
    // speaking for the core.
    // Two literals are not channel names and are allowed by name: `next-action`
    // names which field `projects:set-field` is setting, and `typed` is the
    // capture source the box sends for the same keystrokes. Both are arguments
    // the ordinary surfaces already send; neither is a sentence.
    const allowed = new Set(["next-action", "typed"]);
    const literals = [...BRIDGE.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

    for (const literal of literals) {
      assert.ok(
        /^[a-z-]+:[a-z-]+$/.test(literal) || allowed.has(literal),
        `"${literal}" is not a channel name — a bridge must not hold words for the user`,
      );
    }
  });
});
