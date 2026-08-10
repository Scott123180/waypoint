/**
 * The capture box.
 *
 * Handles input and rendering only. It has no idea what a timestamp is, what
 * the inbox format looks like, or when a capture is valid — it asks the core
 * through `window.waypoint` and shows what comes back.
 */

interface Notice {
  level: "info" | "error";
  message: string;
  recoverableText?: string;
}

type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

interface WaypointApi {
  submit(text: string, source: "typed" | "dictated"): Promise<SubmitResponse>;
  dismiss(): void;
  onReset(callback: () => void): void;
  onNotice(callback: (notice: Notice) => void): void;
}

declare global {
  interface Window {
    waypoint: WaypointApi;
  }
}

const input = document.getElementById("capture-input") as HTMLTextAreaElement;
const notice = document.getElementById("notice") as HTMLDivElement;

function focusInput(): void {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function clearNotice(): void {
  notice.textContent = "";
  notice.classList.remove("visible");
}

function showNotice(next: Notice): void {
  notice.textContent = next.message;

  if (next.recoverableText) {
    // A failed write must never mean a lost thought: show the text back so it
    // can at least be copied out.
    const recoverable = document.createElement("span");
    recoverable.className = "recoverable";
    recoverable.textContent = next.recoverableText;
    notice.appendChild(recoverable);
  }

  notice.classList.add("visible");
}

function reset(): void {
  input.value = "";
  clearNotice();
  focusInput();
}

async function submit(): Promise<void> {
  const text = input.value;

  // Hide first, without awaiting the result. Waiting on the round-trip here
  // would put disk latency back on the path this whole design keeps clear.
  const pending = window.waypoint.submit(text, "typed");

  const result = await pending;
  if (!result.ok && result.error === "empty") {
    // Nothing was captured, so stay open rather than swallowing the keystroke.
    focusInput();
    return;
  }

  input.value = "";
  window.waypoint.dismiss();
}

input.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    input.value = "";
    clearNotice();
    window.waypoint.dismiss();
  }
});

window.waypoint.onReset(reset);
window.waypoint.onNotice(showNotice);

// The window is reused across captures, so re-focus whenever it comes forward.
window.addEventListener("focus", focusInput);

focusInput();

export {};
