export interface Notice {
  level: "info" | "error";
  message: string;
  recoverableText?: string;
}

export type NoticeEmitter = (notice: Notice) => void;

/** The slice of Electron's globalShortcut we use, injectable for tests. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregisterAll(): void;
}

export interface HotkeyResult {
  registered: boolean;
}

/**
 * Registers the global capture hotkey.
 *
 * Registration failing is an expected outcome, not an exception: another app
 * may already own the combination, or the config may contain a malformed
 * accelerator. Either way startup continues and the tray entry point remains
 * the way in, so the app is never unreachable.
 */
export function registerHotkey(
  accelerator: string,
  onTrigger: () => void,
  api: ShortcutApi,
  emitNotice: NoticeEmitter,
): HotkeyResult {
  let ok = false;
  try {
    ok = api.register(accelerator, onTrigger);
  } catch {
    // Electron throws on a malformed accelerator rather than returning false.
    ok = false;
  }

  if (!ok) {
    emitNotice({
      level: "error",
      message:
        `The capture hotkey ${accelerator} could not be registered — another ` +
        `application is probably using it. Open capture from the tray/menu bar ` +
        `icon, and change "hotkey" in your config file to pick a different one.`,
    });
  }

  return { registered: ok };
}
