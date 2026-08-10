import { randomUUID } from "node:crypto";

import type { Clock } from "../ports/index";
import { EmptyCaptureError } from "../errors";

export type CaptureSource = "typed" | "dictated";

/**
 * One captured thought.
 *
 * `id` and `source` are in-memory only — neither is serialized. Capture stores
 * raw, so the entity has nowhere to put a tag, project, or status even if a
 * client wanted to supply one.
 */
export interface CaptureItem {
  id: string;
  text: string;
  capturedAt: Date;
  source: CaptureSource;
}

/**
 * @throws EmptyCaptureError when `text` is empty or whitespace-only.
 */
export function createCaptureItem(
  text: string,
  source: CaptureSource,
  clock: Clock,
): CaptureItem {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new EmptyCaptureError();
  }

  return {
    id: randomUUID(),
    // Trimmed at the edges, otherwise verbatim: no capitalization, punctuation,
    // or reflow fixes. What the user said is what gets stored.
    text: trimmed,
    // Always from the clock, never from a caller, so no client can forge one.
    capturedAt: clock.now(),
    source,
  };
}
