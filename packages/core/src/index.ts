/**
 * Public surface of @waypoint/core.
 *
 * Everything a client is allowed to touch is exported here and nowhere else.
 * See specs/001-quick-capture/contracts/core-api.md
 */

export type { InboxStore, TranscriptionPort, Clock } from "./ports/index";
export { EmptyCaptureError, TranscriptionFailedError, InboxWriteError } from "./errors";

export type { CaptureItem, CaptureSource } from "./capture/capture-item";
export { CaptureService } from "./capture/capture-service";
export type { SubmitResult, CaptureServiceDeps } from "./capture/capture-service";
