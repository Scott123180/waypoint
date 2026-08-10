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

export interface HotkeyAccelerators {
  /** Opens the capture box for typing. */
  capture: string;
  /** Opens the capture box already dictating. */
  dictate: string;
}

export interface HotkeyHandlers {
  onCapture: () => void;
  onDictate: () => void;
}

export interface HotkeysResult {
  capture: boolean;
  dictate: boolean;
}

/**
 * Registers both global hotkeys (FR-001a).
 *
 * Each is registered on its own so that one being unavailable — claimed by the
 * window manager, or mistyped in the config — costs the user only that binding.
 * The notice names what failed *and* what still works, because a user told only
 * that "the hotkey" failed has no way to know they still have a way in.
 */
export function registerHotkeys(
  accelerators: HotkeyAccelerators,
  handlers: HotkeyHandlers,
  api: ShortcutApi,
  emitNotice: NoticeEmitter,
): HotkeysResult {
  if (accelerators.capture === accelerators.dictate) {
    // Registering the same combination twice cannot work, and the second call
    // failing would otherwise look like an unrelated conflict.
    const registered = tryRegister(accelerators.dictate, handlers.onDictate, api);
    emitNotice({
      level: "error",
      message:
        `"hotkey" and "dictateHotkey" are both set to ${accelerators.dictate}, so only ` +
        `one of them can work. Dictation kept the binding; set a different accelerator ` +
        `for "hotkey" in your config file to get the typing shortcut back.`,
    });
    return { capture: false, dictate: registered };
  }

  const dictate = tryRegister(accelerators.dictate, handlers.onDictate, api);
  const capture = tryRegister(accelerators.capture, handlers.onCapture, api);

  const failures: string[] = [];
  if (!dictate) failures.push(`dictation (${accelerators.dictate})`);
  if (!capture) failures.push(`typing (${accelerators.capture})`);

  if (failures.length > 0) {
    const survivor = dictate
      ? `${accelerators.dictate} still opens capture and starts dictating.`
      : capture
        ? `${accelerators.capture} still opens capture for typing.`
        : `Use the tray/menu bar icon to capture.`;

    emitNotice({
      level: "error",
      message:
        `Could not register the hotkey for ${failures.join(" or ")} — another application ` +
        `is probably using it. ${survivor} You can pick different accelerators with ` +
        `"hotkey" and "dictateHotkey" in your config file.`,
    });
  }

  return { capture, dictate };
}

function tryRegister(accelerator: string, onTrigger: () => void, api: ShortcutApi): boolean {
  try {
    return api.register(accelerator, onTrigger);
  } catch {
    // Electron throws on a malformed accelerator rather than returning false.
    return false;
  }
}
