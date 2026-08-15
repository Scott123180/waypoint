/**
 * The weekly top three view.
 *
 * Rendering and input only. Everything this file appears to "know" arrives from
 * the core: which week is current, whether a week may be edited, the cap and
 * the message when it is reached, and what an outcome now reads after a
 * cancelled write. If a rule ever looks like it belongs here, it belongs in
 * `TopThreeService` (Principle II).
 *
 * See specs/004-top-three-wip-limit/contracts/top-three-api.md
 */

/**
 * Types are declared locally and every top-level name is prefixed `t3` — the
 * four renderer files are scripts, not modules, so they share one global
 * scope, and `projects.ts` already owns `$`, `wp`, `current` and friends.
 *
 * Importing from the preload would pull it into the *renderer* TypeScript
 * program, compile it as ESM, and overwrite the CommonJS build Electron needs
 * — the app then starts with no `window.waypoint` at all. See the same note in
 * projects.ts; `preload-is-commonjs.test.ts` fails if anyone reintroduces it.
 */
interface T3Outcome {
  index: number;
  text: string;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

interface T3Week {
  id: string;
  outcomes: T3Outcome[];
  current: boolean;
  /** Whether the core will accept writes to this week. Decided there, not here. */
  writable: boolean;
}

interface T3Ref {
  week: string;
  index: number;
  raw: string;
}

type T3Response = { ok: true; week: T3Week } | { ok: false; reason: string; message: string };

interface T3Api {
  current(): Promise<T3Week>;
  history(): Promise<T3Week[]>;
  writableWeeks(): Promise<{ current: T3Week; ahead: T3Week }>;
  add(text: string, week?: string): Promise<T3Response>;
  edit(ref: T3Ref, text: string): Promise<T3Response>;
  remove(ref: T3Ref): Promise<T3Response>;
  complete(ref: T3Ref): Promise<T3Response>;
  reopen(ref: T3Ref): Promise<T3Response>;
  dismiss(): void;
  onRefresh(handler: () => void): void;
  onVaultChanged(handler: () => void): void;
}

const t3wp = (window as unknown as { waypoint: { topThree: T3Api } }).waypoint.topThree;

function t3$(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el;
}

function t3Error(message: string): void {
  t3$("error").textContent = message;
}

/** Every write goes through here, so a refusal is never silently dropped. */
async function t3Apply(action: () => Promise<T3Response>): Promise<void> {
  const result = await action();
  if (!result.ok) {
    // The message is the core's, verbatim. The view does not know why a write
    // was refused and must not invent a reason.
    t3Error(result.message);
    await t3Paint();
    return;
  }
  t3Error("");
  await t3Paint();
}

function t3OutcomeRow(week: T3Week, outcome: T3Outcome, editable: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = outcome.done ? "outcome done" : "outcome";

  const ref: T3Ref = { week: week.id, index: outcome.index, raw: outcome.raw };

  if (editable) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = outcome.done;
    toggle.addEventListener("change", () => {
      void t3Apply(() => (toggle.checked ? t3wp.complete(ref) : t3wp.reopen(ref)));
    });
    li.appendChild(toggle);
  }

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = outcome.text;
  li.appendChild(text);

  if (outcome.completedOn) {
    const date = document.createElement("span");
    date.className = "date";
    // The date the core recorded, shown as recorded. Never reformatted.
    date.textContent = outcome.completedOn;
    li.appendChild(date);
  }

  if (editable) {
    const edit = document.createElement("button");
    edit.className = "link";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => t3StartEdit(li, ref, outcome.text));
    li.appendChild(edit);

    const remove = document.createElement("button");
    remove.className = "link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void t3Apply(() => t3wp.remove(ref)));
    li.appendChild(remove);
  }

  return li;
}

/** Swaps the row for an input, in place. */
function t3StartEdit(li: HTMLLIElement, ref: T3Ref, currentText: string): void {
  li.replaceChildren();

  const input = document.createElement("input");
  input.type = "text";
  input.value = currentText;
  input.className = "text";

  const save = (): void => {
    void t3Apply(() => t3wp.edit(ref, input.value));
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") void t3Paint();
  });

  const button = document.createElement("button");
  button.textContent = "Save";
  button.addEventListener("click", save);

  li.appendChild(input);
  li.appendChild(button);
  input.focus();
  input.select();
}

/**
 * Past weeks are a record.
 *
 * Rendered with no checkbox and no edit affordance — not because the renderer
 * decides that, but because `week.current` says so and the core refuses the
 * write anyway. The file stays hand-editable; the app simply declines to be
 * the one rewriting history.
 */
function t3PastWeek(week: T3Week): HTMLElement {
  const section = document.createElement("section");

  const heading = document.createElement("h2");
  heading.textContent = week.id;
  section.appendChild(heading);

  const list = document.createElement("ul");
  for (const outcome of week.outcomes) list.appendChild(t3OutcomeRow(week, outcome, false));
  section.appendChild(list);

  return section;
}

async function t3Paint(): Promise<void> {
  const weeks = await t3wp.history();
  const { current, ahead } = await t3wp.writableWeeks();

  t3$("week-id").textContent = current.id;

  const list = t3$("current");
  list.replaceChildren(...current.outcomes.map((o) => t3OutcomeRow(current, o, true)));
  t3$("empty").hidden = current.outcomes.length > 0;

  // The week ahead, editable on the same terms. `writable` is the core's
  // answer; this file does not work out which week is next, and does not know
  // how far ahead the window reaches.
  t3AheadId = ahead.id;
  t3$("ahead-section").hidden = !ahead.writable;
  t3$("ahead-id").textContent = `${ahead.id} — next week`;
  t3$("ahead").replaceChildren(...ahead.outcomes.map((o) => t3OutcomeRow(ahead, o, true)));

  // Everything that is not one of the two writable weeks is a record.
  const past = weeks.filter((w) => !w.writable);
  t3$("past-section").hidden = past.length === 0;
  t3$("past").replaceChildren(...past.map(t3PastWeek));
}

/** The id the add-below-here box targets. Set by the paint that drew it. */
let t3AheadId = "";

// ---------------------------------------------------------------------------

t3$("add").addEventListener("click", () => {
  const input = t3$("add-text") as HTMLInputElement;
  const text = input.value;
  if (text.trim().length === 0) return;

  // Cleared *now*, not when the write returns. Clearing asynchronously races
  // the user: start typing the next outcome while the previous one is still in
  // flight and the late clear wipes what they just typed. A refused add puts
  // the text back, so nothing is lost either way.
  input.value = "";

  void t3wp.add(text).then(async (result) => {
    if (!result.ok) {
      t3Error(result.message);
      // Restore only if they have not already started typing something else.
      if (input.value === "") input.value = text;
    } else {
      t3Error("");
    }
    await t3Paint();
  });
});

t3$("add-text").addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key === "Enter") t3$("add").click();
});

t3$("ahead-add").addEventListener("click", () => {
  const input = t3$("ahead-text") as HTMLInputElement;
  const text = input.value;
  if (text.trim().length === 0) return;

  // Cleared now rather than on return, for the reason the current week's box
  // gives: a late clear races the user's next keystroke.
  input.value = "";

  void t3wp.add(text, t3AheadId).then(async (result) => {
    if (!result.ok) {
      t3Error(result.message);
      if (input.value === "") input.value = text;
    } else {
      t3Error("");
    }
    await t3Paint();
  });
});

t3$("ahead-text").addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key === "Enter") t3$("ahead-add").click();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") t3wp.dismiss();
});

// Redraw on open, and again whenever anything writes to the vault — including
// a hand-edit, or a write from another window. The view re-reads rather than
// trusting what it last drew (research R9).
t3wp.onRefresh(() => void t3Paint());
t3wp.onVaultChanged(() => void t3Paint());

void t3Paint();
