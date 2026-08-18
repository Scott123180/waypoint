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
  split(
    ref: ItemRef,
    pieces: string[],
  ): Promise<{ ok: true; destination: string } | { ok: false; reason: string; message: string }>;
  dismiss(): void;
  onRefresh(callback: () => void): void;
  onInboxChanged(callback: () => void): void;
  onRecovered(callback: (report: { completed: number; abandoned: number }) => void): void;
  onNotice(callback: (notice: { level: "info" | "error"; message: string }) => void): void;
}

/**
 * 008: the suggestion API, **optional**.
 *
 * Absent from `window.waypoint` entirely when no transport is configured, so
 * the check below is the only thing standing between a configured machine and
 * an unconfigured one. There is no disabled state to render and no capability
 * flag to consult — the verb is either there or it is not (FR-060).
 */
interface PrepareResult {
  ok: boolean;
  id?: string;
  payload?: string;
  reason?: string;
  message?: string;
}

interface ProposedPiece {
  text: string;
  segments: number[];
}

interface SplitProposal {
  pieces: ProposedPiece[];
  uncovered: string[];
  nothingToSplit: boolean;
}

interface DestinationProposal {
  decision: SortDecision;
  reason: string;
  isNew: boolean;
}

type Proposal = SplitProposal | DestinationProposal;

/** Which kind came back. The two are told apart by shape, not by a flag. */
function isSplit(proposal: Proposal): proposal is SplitProposal {
  return "pieces" in proposal;
}

interface SuggestApi {
  available(): Promise<boolean>;
  prepareSplit(item: {
    text: string;
    capturedAt: string | null;
    ref: ItemRef;
  }): Promise<PrepareResult>;
  prepareDestination(text: string): Promise<PrepareResult>;
  run(
    id: string,
  ): Promise<
    | { ok: true; proposal: Proposal }
    | { ok: false; reason: string; message: string }
  >;
  abandon(id: string): void;
}

const bridge = (window as unknown as { waypoint: { sort: SortApi; suggest?: SuggestApi } }).waypoint;
const api = bridge.sort;
const suggest = bridge.suggest;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sorting = el("sorting");
const emptyState = el("empty");
const remaining = el("remaining");
const capturedAt = el("captured-at");
const textEl = el("text");
const stage = el("stage");
const choices = el("choices");
const panel = el("panel");
const assist = el("assist");
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

/**
 * The counter and the bar, which track the *file* rather than the card on
 * screen. Split out of `showNext` so an item arriving mid-session can move
 * them without redrawing anything the user is looking at.
 */
async function refreshTally(): Promise<void> {
  const count = await api.count();
  remaining.textContent = count === 1 ? "1 item left" : `${count} items left`;
  updateProgress(count);
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
    currentItem = null;
    clearAssist();
    sorting.hidden = true;
    emptyState.hidden = false;
    remaining.textContent = "";
    updateProgress(0);
    return;
  }

  const { text, capturedAt: at, ref } = response.item;
  currentRef = ref;
  currentItem = response.item;
  // A proposal belongs to the item it was made about. Moving on drops it —
  // nothing about a request survives the item it was for (008 FR-046).
  clearAssist();

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

  await refreshTally();
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

// ---------------------------------------------------------------------------
// 008: asking for help, and deciding what to do with the answer
// ---------------------------------------------------------------------------

/** The item currently on screen, as the suggestion service needs it. */
let currentItem: { text: string; capturedAt: string | null; ref: ItemRef } | null = null;
/** The prepared-but-unsent request, if the preview is showing. */
let prepared: { id: string; payload: string } | null = null;

/**
 * The ask row. Rendered **only** when the bridge exposed the verbs.
 *
 * Not hidden when unavailable — never created. A user who has configured
 * nothing sees the sort view Feature 2 shipped, with no sign this exists.
 */
function renderAsk(): void {
  if (!suggest || !currentItem) {
    assist.replaceChildren();
    return;
  }

  const row = document.createElement("div");
  row.className = "ask";

  const split = document.createElement("button");
  split.type = "button";
  split.id = "to-split";
  split.textContent = "Split this up";
  split.addEventListener("click", () => void askFor("split"));

  const where = document.createElement("button");
  where.type = "button";
  where.id = "to-where";
  where.textContent = "Where does this go?";
  where.addEventListener("click", () => void askFor("destination"));

  row.append(split, where);
  assist.replaceChildren(row);
}

function clearAssist(): void {
  if (prepared) {
    // Leaving a request in flight would let an answer arrive against an item
    // that is no longer on screen.
    suggest?.abandon(prepared.id);
    prepared = null;
  }
  renderAsk();
}

/**
 * Step one: prepare, and show exactly what would be sent.
 *
 * Nothing has left the machine at the end of this function. The send is the
 * user's separate, explicit act, taken with the content readable (FR-041).
 */
async function askFor(kind: "split" | "destination"): Promise<void> {
  if (!suggest || !currentItem) return;
  clearNotice();

  const result =
    kind === "split"
      ? await suggest.prepareSplit(currentItem)
      : await suggest.prepareDestination(currentItem.text);

  if (!result.ok || result.id === undefined || result.payload === undefined) {
    // `not-configured` carries no message and cannot arrive here anyway: the
    // control that produced this call does not exist in that state.
    if (result.message) say(result.message, "error");
    return;
  }

  prepared = { id: result.id, payload: result.payload };
  renderPreview(result.payload);
}

function renderPreview(payload: string): void {
  const label = document.createElement("p");
  label.id = "preview-label";
  label.textContent = "This is exactly what would be sent:";

  const pre = document.createElement("pre");
  pre.id = "preview";
  // `textContent`, so the payload is shown as text and nothing in it can
  // render as markup.
  pre.textContent = payload;

  const row = document.createElement("div");
  row.className = "ask";

  const send = document.createElement("button");
  send.type = "button";
  send.id = "send";
  send.textContent = "Send it";
  send.addEventListener("click", () => void runPrepared());

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "cancel-send";
  cancel.textContent = "Never mind";
  cancel.addEventListener("click", clearAssist);

  row.append(send, cancel);
  assist.replaceChildren(label, pre, row);
}

/** Step two: the send, and whatever comes back. */
async function runPrepared(): Promise<void> {
  if (!suggest || !prepared) return;
  const { id } = prepared;

  const waiting = document.createElement("div");
  waiting.className = "ask";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.id = "abandon";
  stop.textContent = "Waiting… stop";
  // Abandoning is available for the whole of the request, not only at the
  // bound. One mechanism, two triggers (FR-066).
  stop.addEventListener("click", () => {
    suggest.abandon(id);
    prepared = null;
    renderAsk();
  });
  waiting.append(stop);
  assist.replaceChildren(waiting);

  const outcome = await suggest.run(id);
  prepared = null;

  if (!outcome.ok) {
    // One message. No retry — asking again is the user's to do (FR-065).
    say(outcome.message, "error");
    renderAsk();
    return;
  }

  if (isSplit(outcome.proposal)) renderSplitProposal(outcome.proposal);
  else renderDestinationProposal(outcome.proposal);
}

/** How a decision reads to a person, in Feature 2's own five words. */
function describe(decision: SortDecision, isNew: boolean): string {
  switch (decision.to) {
    case "project":
      return "slug" in decision ? `Project: ${decision.slug}` : `New project: “${decision.createTitle}”`;
    case "area":
      return "slug" in decision ? `Area: ${decision.slug}` : `New area: “${decision.createTitle}”`;
    case "waiting":
      return "Waiting for";
    case "calendar":
      return "Calendar";
    case "trash":
      return "Trash";
    default:
      void isNew;
      return "";
  }
}

/**
 * One destination, with its reason.
 *
 * Accepting calls `sort.decide` — the channel a manual choice already uses,
 * with the decision the proposal carried. There is no assisted path to a
 * destination because there is no second channel to one (FR-030, FR-031).
 */
function renderDestinationProposal(proposal: DestinationProposal): void {
  const box = document.createElement("div");
  box.id = "proposal";

  const where = document.createElement("p");
  where.id = "destination";
  where.textContent = describe(proposal.decision, proposal.isNew);

  if (proposal.isNew) {
    // Marked distinctly, because confirming the creation of something is a
    // different act from filing into something that already exists (FR-023).
    const badge = document.createElement("span");
    badge.id = "is-new";
    badge.textContent = " — this does not exist yet";
    where.append(badge);
  }

  const reason = document.createElement("p");
  reason.className = "reason";
  reason.id = "reason";
  // Core's words, shown and never written (FR-032).
  reason.textContent = proposal.reason;

  box.append(where, reason);

  /**
   * A waiting-for owner is editable before acceptance, and may well be empty:
   * the model is not allowed to invent a name the item never said, and `sort()`
   * refuses an empty owner — so this is where the user supplies it (FR-025).
   */
  let ownerField: HTMLInputElement | null = null;
  if (proposal.decision.to === "waiting") {
    ownerField = document.createElement("input");
    ownerField.type = "text";
    ownerField.id = "proposed-owner";
    ownerField.autocomplete = "off";
    ownerField.placeholder = "Who is it waiting on?";
    ownerField.value = proposal.decision.owner;

    const row = document.createElement("div");
    row.className = "row";
    row.append(ownerField);
    box.append(row);
  }

  const row = document.createElement("div");
  row.className = "ask";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.id = "accept-destination";
  accept.textContent = proposal.isNew ? "Create it and file here" : "File it here";
  accept.addEventListener("click", () => {
    const decision: SortDecision =
      proposal.decision.to === "waiting"
        ? { to: "waiting", owner: ownerField?.value ?? "" }
        : proposal.decision;
    clearAssist();
    void decide(decision);
  });

  const other = document.createElement("button");
  other.type = "button";
  other.id = "choose-other";
  other.textContent = "Somewhere else";
  other.addEventListener("click", () => {
    // Back to the five buttons Feature 2 shipped. Rejecting a proposal does
    // not take the ordinary path away with it.
    clearAssist();
    say("");
    clearNotice();
  });

  const reject = document.createElement("button");
  reject.type = "button";
  reject.id = "reject-destination";
  reject.textContent = "Reject";
  reject.addEventListener("click", clearAssist);

  row.append(accept, other, reject);
  box.append(row);
  assist.replaceChildren(box);
}

/**
 * The proposal, as editable text.
 *
 * Once it is on screen it is ordinary text: `sort.split()` takes strings, so
 * an edited piece and a proposed one are the same kind of thing to the write
 * path, and nothing records which is which (FR-015, FR-032).
 */
function renderSplitProposal(proposal: SplitProposal): void {
  const box = document.createElement("div");
  box.id = "proposal";

  if (proposal.nothingToSplit) {
    const line = document.createElement("p");
    line.className = "reason";
    line.textContent = "This looks like one thought. Nothing to split.";

    const row = document.createElement("div");
    row.className = "ask";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.id = "reject-split";
    ok.textContent = "OK";
    ok.addEventListener("click", clearAssist);
    row.append(ok);

    // No accept button at all: there is nothing to accept, and offering one
    // would invite a write that changes nothing (FR-011).
    box.append(line, row);
    assist.replaceChildren(box);
    return;
  }

  /** Which pieces the user has dropped. Local to this proposal. */
  const dropped = new Set<number>();

  const list = document.createElement("div");
  const uncovered = document.createElement("div");
  uncovered.id = "uncovered";

  const textareas: HTMLTextAreaElement[] = [];

  const refreshUncovered = (): void => {
    // Core computed which segments no piece names. Dropping a piece here adds
    // its text to that — the arithmetic stays core's, and the client only adds
    // what the user just removed.
    const missing = [
      ...proposal.uncovered,
      ...[...dropped].sort((a, b) => a - b).map((i) => proposal.pieces[i]?.text ?? ""),
    ].filter((t) => t.trim().length > 0);

    if (missing.length === 0) {
      uncovered.hidden = true;
      uncovered.replaceChildren();
      return;
    }

    const heading = document.createElement("strong");
    heading.textContent = "This is not carried into any piece:";
    const ul = document.createElement("ul");
    for (const text of missing) {
      const li = document.createElement("li");
      li.textContent = text.trim();
      ul.append(li);
    }
    uncovered.replaceChildren(heading, ul);
    uncovered.hidden = false;
  };

  proposal.pieces.forEach((piece, index) => {
    const row = document.createElement("div");
    row.className = "piece";

    const area = document.createElement("textarea");
    area.rows = Math.min(4, piece.text.split("\n").length + 1);
    area.value = piece.text.trim();
    textareas.push(area);

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "Drop";
    drop.addEventListener("click", () => {
      if (dropped.has(index)) dropped.delete(index);
      else dropped.add(index);
      row.classList.toggle("dropped", dropped.has(index));
      area.disabled = dropped.has(index);
      drop.textContent = dropped.has(index) ? "Keep" : "Drop";
      refreshUncovered();
    });

    row.append(area, drop);
    list.append(row);
  });

  const row = document.createElement("div");
  row.className = "ask";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.id = "accept-split";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => {
    const kept = textareas.filter((_, i) => !dropped.has(i)).map((t) => t.value);
    void acceptSplit(kept);
  });

  const reject = document.createElement("button");
  reject.type = "button";
  reject.id = "reject-split";
  reject.textContent = "Reject";
  reject.addEventListener("click", clearAssist);

  row.append(accept, reject);
  box.append(list, uncovered, row);
  refreshUncovered();
  assist.replaceChildren(box);
}

/**
 * The accept. One call to the same write path a user with no intelligence
 * configured would reach by typing three pieces themselves.
 */
async function acceptSplit(pieces: string[]): Promise<void> {
  if (!currentRef || deciding) return;
  setBusy(true);
  clearNotice();

  const outcome = await api.split(currentRef, pieces);
  setBusy(false);

  if (outcome.ok) {
    clearAssist();
    await showNext();
    return;
  }

  // Core's words, unchanged. A client that reworded a refusal would be a
  // second vocabulary for the same event.
  say(outcome.message, "error");
  if (outcome.reason === "item-changed") {
    clearAssist();
    await showNext();
  }
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

/**
 * The inbox changed underneath an open session — a capture, an undo, or a
 * client writing from outside the GUI.
 *
 * How much to redraw depends on whether anything is on screen:
 *
 * - **Empty state showing.** Nothing to disturb, and no decision left that
 *   could ever pull the arrival in, so this is the one case that must redraw
 *   the card. Without it the view stays at inbox zero until it is closed and
 *   reopened, with the new thought sitting on disk and invisible.
 * - **An item showing.** Only the tally moves. `showNext` closes any open
 *   picker, and discarding a half-typed project name is far worse than letting
 *   an arrival wait — it is queued behind the current item and will be reached
 *   by sorting anyway. The counter going up is the feedback that it landed.
 */
api.onInboxChanged(() => {
  if (!emptyState.hidden) {
    void showNext();
    return;
  }
  void refreshTally();
});

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
