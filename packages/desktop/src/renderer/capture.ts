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

type TranscribeResponse =
  | { status: "ok"; text: string }
  | { status: "no-speech" }
  | { status: "failed"; message: string };

interface WaypointApi {
  submit(text: string, source: "typed" | "dictated"): Promise<SubmitResponse>;
  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResponse>;
  dismiss(): void;
  onReset(callback: () => void): void;
  onNotice(callback: (notice: Notice) => void): void;
  onFakeDictation(callback: (result: TranscribeResponse) => void): void;
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

/**
 * Places a completed transcript into the box at the cursor.
 *
 * Never replaces what the user already typed, and never submits on its own —
 * the transcript becomes an item only when the user chooses to save it.
 */
function insertTranscript(text: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;

  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  input.focus();
}

function applyTranscription(result: TranscribeResponse): void {
  if (result.status === "ok") {
    clearNotice();
    insertTranscript(result.text);
    return;
  }

  if (result.status === "no-speech") {
    // Leave whatever was already typed alone and stay open to retry.
    showNotice({ level: "info", message: "Didn't catch that — try again, or type it." });
    focusInput();
    return;
  }

  showNotice({ level: "error", message: result.message });
  focusInput();
}

/* ------------------------------------------------------------- dictation -- */

const dictateButton = document.getElementById("dictate-button") as HTMLButtonElement;

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  chunks: Float32Array[];
}

let recording: Recording | undefined;

function setDictating(active: boolean): void {
  dictateButton.setAttribute("aria-pressed", String(active));
  dictateButton.textContent = active ? "Stop" : "Dictate";
}

/** Tears down the audio graph and releases the microphone. */
function teardown(): Float32Array[] {
  if (!recording) return [];
  const { stream, context, processor, source, chunks } = recording;
  recording = undefined;

  processor.disconnect();
  source.disconnect();
  void context.close();
  for (const track of stream.getTracks()) track.stop();

  setDictating(false);
  return chunks;
}

async function startDictation(): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showNotice({
      level: "error",
      message: "Microphone unavailable. Check permissions, or type your thought instead.",
    });
    focusInput();
    return;
  }

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    // Copied because the underlying buffer is reused by the audio thread.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(context.destination);

  recording = { stream, context, processor, source, chunks };
  setDictating(true);

  // If the microphone disappears mid-recording, end cleanly rather than
  // leaving the button stuck in a recording state.
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      if (!recording) return;
      teardown();
      showNotice({ level: "error", message: "Microphone disconnected. Nothing was captured." });
      focusInput();
    });
  }
}

async function stopDictation(): Promise<void> {
  const sampleRate = recording?.context.sampleRate ?? 48_000;
  const chunks = teardown();

  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  if (total === 0) {
    applyTranscription({ status: "no-speech" });
    return;
  }

  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  // Drop our references to the raw chunks as soon as they are merged; audio
  // exists only in memory and only for as long as transcription needs it.
  chunks.length = 0;

  dictateButton.disabled = true;
  try {
    applyTranscription(await window.waypoint.transcribe(samples, sampleRate));
  } finally {
    dictateButton.disabled = false;
  }
}

dictateButton.addEventListener("click", () => {
  void (recording ? stopDictation() : startDictation());
});

window.waypoint.onReset(() => {
  if (recording) teardown();
  reset();
});
window.waypoint.onNotice(showNotice);
window.waypoint.onFakeDictation(applyTranscription);

// The window is reused across captures, so re-focus whenever it comes forward.
window.addEventListener("focus", focusInput);

focusInput();

export {};
