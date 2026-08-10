/**
 * The capture box.
 *
 * Handles input and rendering only. It has no idea what a timestamp is, what
 * the inbox format looks like, or when a capture is valid — it asks the core
 * through `window.waypoint` and shows what comes back.
 */

interface Notice {
  id?: string;
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
  undo(id: string): Promise<{ ok: boolean; reason?: string }>;
  ackNotice(id: string): void;
  dismiss(): void;
  onReset(callback: (mode: CaptureMode) => void): void;
  onStartDictation(callback: () => void): void;
  onNotice(callback: (notice: Notice) => void): void;
  onFakeDictation(callback: (result: TranscribeResponse) => void): void;
}

type CaptureMode = "type" | "dictate";

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

    // Sticky: it replays on every open until the user says they have it, so
    // closing the box cannot quietly drop the last copy of the thought.
    if (next.id) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.id = "notice-dismiss";
      dismiss.textContent = "Got it";
      dismiss.addEventListener("click", () => {
        window.waypoint.ackNotice(next.id!);
        clearNotice();
        focusInput();
      });
      notice.appendChild(dismiss);
    }
  }

  notice.classList.add("visible");
}

function reset(): void {
  input.value = "";
  hasTranscript = false;
  clearNotice();
  focusInput();
}

/* --------------------------------------------------------- dictation state -- */

/**
 * The three states dictation moves through, kept visible at all times.
 *
 * Before this existed, recording and transcribing were distinguished only by a
 * dimmed button, and a transcription that takes 3-5 seconds read as a hang.
 */
type DictationState = "idle" | "acquiring" | "recording" | "transcribing";

const status = document.getElementById("status") as HTMLDivElement;
const statusLabel = document.getElementById("status-label") as HTMLSpanElement;
const levelMeter = document.getElementById("level-meter") as HTMLSpanElement;
const levelBars = Array.from(levelMeter.querySelectorAll("i"));
const elapsed = document.getElementById("elapsed") as HTMLSpanElement;

const LABELS: Record<DictationState, string> = {
  idle: "",
  acquiring: "Starting microphone…",
  recording: "Listening",
  transcribing: "Transcribing…",
};

let state: DictationState = "idle";
let elapsedTimer: number | undefined;

function setState(next: DictationState): void {
  state = next;
  status.dataset["state"] = next;
  statusLabel.textContent = LABELS[next];

  if (next === "recording") {
    status.dataset["startedAt"] = String(Date.now());
    startElapsed();
  } else {
    stopElapsed();
  }

  if (next !== "recording") setLevel(0);
  // Only transcription is a genuine wait; recording ends when the user says so.
  dictateButton.disabled = next === "transcribing" || next === "acquiring";
  dictateButton.setAttribute("aria-pressed", String(next === "recording"));
  dictateButton.textContent = next === "recording" ? "Stop" : "Dictate";
}

function startElapsed(): void {
  const started = Date.now();
  const tick = (): void => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  tick();
  elapsedTimer = window.setInterval(tick, 250);
}

function stopElapsed(): void {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
  elapsedTimer = undefined;
  elapsed.textContent = "";
}

/** Paints the meter and publishes the level for tests to observe. */
function setLevel(level: number): void {
  status.dataset["level"] = level.toFixed(3);
  const lit = Math.round(level * levelBars.length);
  levelBars.forEach((bar, index) => {
    const on = index < lit;
    bar.classList.toggle("lit", on);
    bar.style.transform = `scaleY(${on ? 0.28 + 0.72 * ((index + 1) / levelBars.length) : 0.28})`;
  });
}

let smoothed = 0;

/**
 * Turns a block of samples into a 0..1 meter reading.
 *
 * Mapped through decibels rather than raw amplitude because speech sits low in
 * linear terms — a linear meter barely twitches at conversational volume and so
 * fails at the one job it has, which is showing that the microphone is live.
 * Attack is instant and release is gradual, so a peak is legible rather than a
 * flicker.
 */
function meterLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);

  const db = 20 * Math.log10(rms + 1e-9);
  const normalized = Math.min(1, Math.max(0, (db + 60) / 60));

  smoothed = normalized > smoothed ? normalized : smoothed * 0.8 + normalized * 0.2;
  return smoothed;
}


/** Text currently in the box came from dictation and has not been retyped. */
let hasTranscript = false;

async function submit(): Promise<void> {
  const text = input.value;
  const source = hasTranscript ? "dictated" : "typed";

  // Not awaited before hiding: waiting on the round-trip here would put disk
  // latency back on the path this whole design keeps clear.
  const pending = window.waypoint.submit(text, source);

  const result = await pending;
  if (!result.ok && result.error === "empty") {
    // Nothing was captured, so stay open rather than swallowing the keystroke.
    focusInput();
    return;
  }

  // A dictated capture stays undoable from the tray until the next capture
  // begins. The affordance lives there rather than here because the box closes
  // on submit (FR-013), so an in-box button would never be seen — and keeping
  // the box open to show one would be exactly the blocking step FR-010 forbids.

  input.value = "";
  hasTranscript = false;
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
    // Dismissing must also release the microphone; a hidden box that is still
    // recording is both a privacy problem and a stuck indicator on reopen.
    if (recording) teardown();
    setState("idle");
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
    hasTranscript = true;
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

/** Tears down the audio graph and releases the microphone. */
function teardown(): Float32Array[] {
  if (!recording) return [];
  const { stream, context, processor, source, chunks } = recording;
  recording = undefined;

  processor.disconnect();
  source.disconnect();
  void context.close();
  for (const track of stream.getTracks()) track.stop();

  smoothed = 0;
  return chunks;
}

async function startDictation(): Promise<void> {
  // Idempotent: a second dictate hotkey press mid-recording must be inert
  // rather than discarding what has been said so far.
  if (state !== "idle") return;

  setState("acquiring");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Failing back to idle matters as much as the message: leaving the box
    // showing "Listening" at a microphone that never opened is the exact
    // confusion this state machine exists to prevent.
    setState("idle");
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
    const samples = event.inputBuffer.getChannelData(0);
    // The meter is driven from the same samples that will be transcribed, so a
    // moving meter is direct evidence the transcriber is getting audio.
    setLevel(meterLevel(samples));
    // Copied because the underlying buffer is reused by the audio thread.
    chunks.push(new Float32Array(samples));
  };

  source.connect(processor);
  processor.connect(context.destination);

  recording = { stream, context, processor, source, chunks };
  setState("recording");
  focusInput();

  // If the microphone disappears mid-recording, end cleanly rather than
  // leaving the button stuck in a recording state.
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      if (!recording) return;
      teardown();
      setState("idle");
      showNotice({ level: "error", message: "Microphone disconnected. Nothing was captured." });
      focusInput();
    });
  }
}

async function stopDictation(): Promise<void> {
  if (state !== "recording") return;

  const sampleRate = recording?.context.sampleRate ?? 48_000;
  const chunks = teardown();

  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  if (total === 0) {
    setState("idle");
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

  setState("transcribing");
  try {
    applyTranscription(await window.waypoint.transcribe(samples, sampleRate));
  } finally {
    // Returning to idle in `finally` so a thrown transcription cannot strand
    // the box showing "Transcribing…" forever.
    setState("idle");
  }
}

dictateButton.addEventListener("click", () => {
  void (state === "recording" ? stopDictation() : startDictation());
});

window.waypoint.onReset((mode) => {
  if (recording) teardown();
  setState("idle");
  reset();
  if (mode === "dictate") void startDictation();
});

// Dictation asked for on a box that is already open: start listening without
// touching what the user has already typed (FR-003a).
window.waypoint.onStartDictation(() => {
  void startDictation();
});

window.waypoint.onNotice(showNotice);
window.waypoint.onFakeDictation(applyTranscription);

setState("idle");

// The window is reused across captures, so re-focus whenever it comes forward.
window.addEventListener("focus", focusInput);

focusInput();

export {};
