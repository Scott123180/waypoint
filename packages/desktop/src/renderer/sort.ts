/**
 * The sort view.
 *
 * Input handling and rendering only. This file has no idea what a project
 * *is*, where anything is stored, or what makes a decision valid — it renders
 * what the core returns and sends back which choice the user made
 * (Principle II).
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */

/**
 * Types are declared locally rather than imported from the preload.
 *
 * Importing across that boundary pulls preload.ts into the *renderer*
 * TypeScript program, which compiles it as ESM and overwrites the CommonJS
 * build Electron needs for a preload script — the app then starts with no
 * `window.waypoint` at all. capture.ts avoids it the same way.
 */
interface ItemRef {
  start: number;
  end: number;
  raw: string;
}

type SortDecision =
  | { to: "project"; slug: string }
  | { to: "project"; createTitle: string }
  | { to: "area"; slug: string }
  | { to: "area"; createTitle: string }
  | { to: "waiting"; owner: string }
  | { to: "calendar" }
  | { to: "trash" };

interface SortApi {
  next(): Promise<
    { item: { text: string; capturedAt: string | null; ref: ItemRef } } | { item: null }
  >;
  destinations(): Promise<{
    projects: { slug: string; title: string }[];
    areas: { slug: string; title: string }[];
  }>;
  count(): Promise<number>;
  decide(
    ref: ItemRef,
    decision: SortDecision,
  ): Promise<{ ok: true; destination: string } | { ok: false; reason: string; message: string }>;
  dismiss(): void;
  onRefresh(callback: () => void): void;
  onRecovered(callback: (report: { completed: number; abandoned: number }) => void): void;
  onNotice(callback: (notice: { level: "info" | "error"; message: string }) => void): void;
}

const api = (window as unknown as { waypoint: { sort: SortApi } }).waypoint.sort;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sorting = el("sorting");
const emptyState = el("empty");
const remaining = el("remaining");
const capturedAt = el("captured-at");
const textEl = el("text");
const stage = el("stage");
const choices = el("choices");
const panel = el("panel");
const notice = el("notice");
const hint = el("hint");
const progressBar = document.querySelector("#progress i") as HTMLElement;

let currentRef: ItemRef | null = null;
/** Guards against a second decision while one is in flight (FR-019). */
let deciding = false;
/**
 * How many items this sitting started with, so the bar measures progress
 * through the pile rather than restating the count beside it. Captures landing
 * mid-sort raise it instead of overflowing the bar.
 */
let sessionTotal = 0;

function updateProgress(left: number): void {
  if (left > sessionTotal) sessionTotal = left;
  const done = sessionTotal - left;
  const fraction = sessionTotal === 0 ? 1 : done / sessionTotal;
  progressBar.style.width = `${Math.round(fraction * 100)}%`;
}

/** The footer says what the keyboard does *now*, which changes with the panel. */
function syncHint(): void {
  hint.textContent = panel.firstChild
    ? "Enter to confirm · ↑↓ to choose · Esc to go back"
    : "Press a letter to file · Esc to close";
}

function closePanel(): void {
  panel.replaceChildren();
  syncHint();
}

function say(message: string, level: "info" | "error" = "info"): void {
  notice.textContent = message;
  notice.className = level === "error" ? "error" : "";
}

function clearNotice(): void {
  notice.textContent = "";
  notice.className = "";
}

function setBusy(busy: boolean): void {
  deciding = busy;
  choices.querySelectorAll("button").forEach((button) => {
    (button as HTMLButtonElement).disabled = busy;
  });
}

/** Renders the next item, or the empty state when nothing is left. */
async function showNext(): Promise<void> {
  closePanel();
  const response = await api.next();

  if (response.item === null) {
    currentRef = null;
    sorting.hidden = true;
    emptyState.hidden = false;
    remaining.textContent = "";
    updateProgress(0);
    return;
  }

  const { text, capturedAt: at, ref } = response.item;
  currentRef = ref;

  // A hand-written item has no capture time and never gets a fabricated one
  // (FR-027a) — the line is simply left empty.
  capturedAt.textContent = at ? new Date(at).toLocaleString() : "";
  textEl.textContent = text;

  sorting.hidden = false;
  emptyState.hidden = true;
  setBusy(false);

  // Restart the entrance rather than letting it play once: at keyboard speed
  // the arrival of a new item is the only feedback that the last one landed.
  stage.classList.remove("enter");
  void stage.offsetWidth;
  stage.classList.add("enter");

  const count = await api.count();
  remaining.textContent = count === 1 ? "1 item left" : `${count} items left`;
  updateProgress(count);
}

/**
 * Sends a decision and moves on.
 *
 * Deliberately awaits the result before requesting the next item — the
 * opposite of capture's submit. Showing item N+1 while N's write is still in
 * flight is exactly the state the journal exists to avoid (FR-019).
 */
async function decide(decision: SortDecision): Promise<void> {
  if (!currentRef || deciding) return;
  setBusy(true);
  clearNotice();

  const outcome = await api.decide(currentRef, decision);

  if (outcome.ok) {
    await showNext();
    return;
  }

  // Every refusal leaves the item in the inbox, so the user can retry or
  // choose differently. None of these are modal.
  switch (outcome.reason) {
    case "item-changed":
      say(outcome.message, "error");
      await showNext();
      return;
    case "destination-missing":
      say(outcome.message, "error");
      setBusy(false);
      await openDestinationPicker(decision.to === "area" ? "area" : "project");
      return;
    default:
      say(outcome.message, "error");
      setBusy(false);
      return;
  }
}

/**
 * One field does both jobs: it narrows the existing destinations as you type,
 * and whatever is in it is the title if you decide to create instead. That is
 * the same keystrokes either way, which is the point — you rarely know which
 * of the two you wanted until you have seen what already exists.
 */
async function openDestinationPicker(kind: "project" | "area"): Promise<void> {
  const all = await api.destinations();
  const options = kind === "project" ? all.projects : all.areas;

  const filter = document.createElement("input");
  filter.type = "text";
  filter.id = "create-title";
  filter.autocomplete = "off";
  filter.placeholder = `Filter, or name a new ${kind}`;

  const list = document.createElement("div");
  list.className = "list";

  const none = document.createElement("p");
  none.className = "none";

  const row = document.createElement("div");
  row.className = "row create";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.id = "create-submit";
  row.append(submit);

  const create = (): void => {
    void decide({ to: kind, createTitle: filter.value } as SortDecision);
  };

  const render = (): void => {
    const query = filter.value.trim().toLowerCase();

    // Narrowed by what the user typed and nothing else: the core's order is
    // preserved and no destination is pre-selected, promoted, or ranked by
    // likelihood (FR-030).
    const matches = query
      ? options.filter((option) => option.title.toLowerCase().includes(query))
      : options;

    list.replaceChildren(
      ...matches.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = option.title;
        button.dataset["slug"] = option.slug;
        button.addEventListener("click", () => {
          void decide({ to: kind, slug: option.slug } as SortDecision);
        });
        return button;
      }),
    );

    if (matches.length === 0) {
      none.textContent =
        options.length === 0 ? `No ${kind}s yet.` : `Nothing here matches that.`;
      panel.insertBefore(none, row);
    } else {
      none.remove();
    }

    const title = filter.value.trim();
    submit.textContent = title ? `Create “${title}”` : `Create a new ${kind}`;
  };

  submit.addEventListener("click", create);
  filter.addEventListener("input", render);

  filter.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      // Enter always creates. Filing into an existing destination is a
      // deliberate pick, because "Health" typed while "Health insurance"
      // exists must not silently file into the wrong one.
      event.preventDefault();
      create();
      return;
    }
    if (event.key === "ArrowDown") {
      const first = list.querySelector("button");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  list.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== "BUTTON") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      (target.nextElementSibling as HTMLElement | null)?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = target.previousElementSibling as HTMLElement | null;
      (previous ?? filter).focus();
    }
  });

  panel.replaceChildren(filter, list, row);
  render();
  syncHint();
  filter.focus();
}

function openWaitingPanel(): void {
  const input = document.createElement("input");
  input.type = "text";
  input.id = "waiting-owner";
  input.autocomplete = "off";
  input.placeholder = "Who is it waiting on?";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Save";
  submit.id = "waiting-submit";

  const send = (): void => {
    void decide({ to: "waiting", owner: input.value });
  };

  submit.addEventListener("click", send);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send();
  });

  const row = document.createElement("div");
  row.className = "row";
  row.append(input, submit);

  panel.replaceChildren(row);
  syncHint();
  input.focus();
}

el("to-project").addEventListener("click", () => void openDestinationPicker("project"));
el("to-area").addEventListener("click", () => void openDestinationPicker("area"));
el("to-waiting").addEventListener("click", openWaitingPanel);
el("to-calendar").addEventListener("click", () => void decide({ to: "calendar" }));
el("to-trash").addEventListener("click", () => void decide({ to: "trash" }));

/**
 * Sorting is a repetitive loop, so the whole of it is reachable from the home
 * row. The letters match the labels rather than being positional, so the pill
 * you read is the key you press.
 */
const SHORTCUTS: Record<string, () => void> = {
  p: () => void openDestinationPicker("project"),
  a: () => void openDestinationPicker("area"),
  w: openWaitingPanel,
  c: () => void decide({ to: "calendar" }),
  t: () => void decide({ to: "trash" }),
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    // Esc unwinds one step at a time. Backing out of a picker you opened by
    // mistake should not also throw away the window.
    if (panel.firstChild) {
      (document.activeElement as HTMLElement | null)?.blur();
      closePanel();
    } else {
      api.dismiss();
    }
    return;
  }

  // With a panel open the keyboard belongs to it: a "t" typed into a project
  // name must never reach the trash shortcut.
  if (panel.firstChild || deciding || sorting.hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const action = SHORTCUTS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
});

api.onRefresh(() => void showNext());

api.onRecovered((report) => {
  if (report.abandoned > 0) {
    say(
      `Finished ${report.completed} interrupted decision(s). ${report.abandoned} could not be ` +
        "matched to the inbox — an item may appear both here and in its destination.",
      "error",
    );
  } else if (report.completed > 0) {
    say(`Finished ${report.completed} interrupted decision(s) from last time.`);
  }
});

api.onNotice((n) => say(n.message, n.level));

void showNext();
