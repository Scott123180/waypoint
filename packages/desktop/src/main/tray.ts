import { Menu, Tray, nativeImage, app } from "electron";

/**
 * The in-app entry point (FR-002).
 *
 * The app runs as a background agent with the dock icon hidden, so if the
 * global hotkey fails to register this is the *only* way to reach capture.
 * It therefore must not depend on the hotkey path in any way.
 */
export function createTray(onCapture: () => void): Tray | undefined {
  try {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("Waypoint — capture a thought");

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Capture a thought", click: onCapture },
        { type: "separator" },
        { label: "Quit Waypoint", click: () => app.quit() },
      ]),
    );

    tray.on("click", onCapture);
    return tray;
  } catch (err) {
    // Some Linux desktops have no system tray at all. That is survivable — the
    // hotkey and `activate` handler still work — so it must not stop startup.
    console.warn("[waypoint] could not create tray icon:", err);
    return undefined;
  }
}
