import { Menu, Tray, nativeImage, app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { createRefresher } from "./menu-state";
import { trayClickOpensMenu, trayIconFile, trayIconIsTemplate } from "./resources";

export interface TrayHandle {
  /** Re-reads `canUndo` and rebuilds the menu if the answer changed. */
  refresh(): void;
  destroy(): void;
}

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
  onProjects: () => void;
  onTopThree: () => void;
  onReview: () => void;
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
export function createTray(actions: TrayActions): TrayHandle | undefined {
  try {
    const tray = new Tray(trayImage());
    tray.setToolTip("Waypoint — capture a thought");

    const buildMenu = (): Menu =>
      Menu.buildFromTemplate([
        { label: "Capture a thought", click: actions.onCapture },
        { label: "Dictate a thought", click: actions.onDictate },
        { label: "Undo last capture", click: actions.onUndo, enabled: actions.canUndo() },
        { label: "Sort inbox", click: actions.onSort },
        { label: "Projects", click: actions.onProjects },
        { label: "Top three", click: actions.onTopThree },
        { label: "Weekly review", click: actions.onReview },
        { type: "separator" },
        { label: "Quit Waypoint", click: () => app.quit() },
      ]);

    // Rebuilt whenever undoability changes, not on menu open: Linux app
    // indicators never fire the open events, so waiting for one there left the
    // undo item disabled forever. See menu-state.ts.
    const refresh = createRefresher(actions.canUndo, () => tray.setContextMenu(buildMenu()));
    refresh();

    tray.on("right-click", refresh);
    // Only where a left click would otherwise do nothing. On macOS the click
    // rides along with the menu the system is already opening, so capturing
    // here meant every visit to the menu also threw a capture box on screen.
    if (!trayClickOpensMenu(process.platform)) tray.on("click", actions.onCapture);

    return { refresh, destroy: () => tray.destroy() };
  } catch (err) {
    // Some Linux desktops have no system tray at all. That is survivable — the
    // hotkey and `activate` handler still work — so it must not stop startup.
    console.warn("[waypoint] could not create tray icon:", err);
    return undefined;
  }
}

/**
 * The tray icon, picked per platform — see `trayIconFile` for why the two
 * differ. An empty image renders as a blank, unclickable-looking gap, so fall
 * back only if the asset is genuinely missing.
 */
function trayImage(): Electron.NativeImage {
  const file = trayIconFile(process.platform);
  const candidates = [
    join(__dirname, "..", "..", "..", "build", file),
    join(process.resourcesPath ?? "", "build", file),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const image = nativeImage.createFromPath(path);
      if (!image.isEmpty()) {
        // Marking a non-template image as one is not merely useless off macOS;
        // it is how the icon ended up painted black on a black GNOME top bar.
        if (trayIconIsTemplate(process.platform)) image.setTemplateImage(true);
        return image;
      }
    }
  }
  return nativeImage.createEmpty();
}
