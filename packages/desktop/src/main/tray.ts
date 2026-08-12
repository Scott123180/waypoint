import { Menu, Tray, nativeImage, app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface TrayActions {
  onCapture: () => void;
  /** Opens the box already dictating, the same as the dictate hotkey. */
  onDictate: () => void;
  /** Undoes the most recent dictated capture, if one is still undoable. */
  onUndo: () => void;
  /** Whether an undoable capture currently exists. */
  canUndo: () => boolean;
  /** Opens the sort view. The in-app entry point for Feature 2. */
  onSort: () => void;
}

/**
 * The in-app entry point (FR-002) and the home of the undo affordance.
 *
 * The app runs as a background agent with the dock icon hidden, so if the
 * global hotkey fails to register this is the *only* way to reach capture.
 * It therefore must not depend on the hotkey path in any way.
 *
 * Undo lives here rather than in the capture box because the box closes on
 * submit (FR-013); keeping it open to show an undo button would be exactly the
 * blocking step FR-010 forbids.
 */
export function createTray(actions: TrayActions): Tray | undefined {
  try {
    const tray = new Tray(trayImage());
    tray.setToolTip("Waypoint — capture a thought");

    const buildMenu = (): Menu =>
      Menu.buildFromTemplate([
        { label: "Capture a thought", click: actions.onCapture },
        { label: "Dictate a thought", click: actions.onDictate },
        { label: "Undo last capture", click: actions.onUndo, enabled: actions.canUndo() },
        { label: "Sort inbox", click: actions.onSort },
        { type: "separator" },
        { label: "Quit Waypoint", click: () => app.quit() },
      ]);

    tray.setContextMenu(buildMenu());
    // Rebuilt on open so the undo item reflects whether anything is undoable.
    tray.on("right-click", () => tray.setContextMenu(buildMenu()));
    tray.on("click", actions.onCapture);

    return tray;
  } catch (err) {
    // Some Linux desktops have no system tray at all. That is survivable — the
    // hotkey and `activate` handler still work — so it must not stop startup.
    console.warn("[waypoint] could not create tray icon:", err);
    return undefined;
  }
}

/**
 * macOS treats an image named `…Template` as a template image and recolours it
 * for light/dark menu bars. An empty image renders as a blank, unclickable-
 * looking gap, so fall back only if the asset is genuinely missing.
 */
function trayImage(): Electron.NativeImage {
  const candidates = [
    join(__dirname, "..", "..", "..", "build", "trayTemplate.png"),
    join(process.resourcesPath ?? "", "build", "trayTemplate.png"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const image = nativeImage.createFromPath(path);
      if (!image.isEmpty()) {
        image.setTemplateImage(true);
        return image;
      }
    }
  }
  return nativeImage.createEmpty();
}
