import { join, resolve } from "node:path";

/**
 * Where the bundled whisper binary and model live.
 *
 * Both the binary and the model must resolve to the *same* directory. Deriving
 * them independently is how they drifted apart: the binary followed the
 * packaged resources path while the model defaulted under the user's home, so
 * dictation could never find it out of the box.
 */
export interface ResourceEnv {
  isPackaged: boolean;
  /** Electron's `process.resourcesPath`. */
  resourcesPath: string;
  /** `__dirname` of the compiled main process entry. */
  mainDir: string;
}

export function whisperResourcesDir(env: ResourceEnv): string {
  if (env.isPackaged) {
    // electron-builder places extraResources alongside the app bundle.
    return join(env.resourcesPath, "whisper");
  }

  // dist/src/main → repo root, matching where scripts/fetch-whisper.sh installs.
  const repoRoot = resolve(env.mainDir, "..", "..", "..", "..", "..");
  return join(repoRoot, "resources", "whisper");
}

export function whisperBinaryName(platform: NodeJS.Platform | string): string {
  return platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

export const WHISPER_MODEL_FILENAME = "ggml-small.en.bin";

/**
 * Which tray icon a platform gets, and whether it is a macOS template image.
 *
 * macOS is the only platform that answers "adapt to the bar behind you" for
 * us: a *template* image is black pixels plus alpha, and the menu bar tints it
 * to suit light or dark appearance, live, with no work here.
 *
 * Nowhere else can. The StatusNotifierItem protocol Linux trays speak has no
 * way to ask what colour the panel is, and the desktop's light/dark preference
 * is a different question with a different answer: every Yaru variant, the
 * light ones included, paints the GNOME top bar #131313. Following
 * `nativeTheme.shouldUseDarkColors` there would put a black icon on a black bar
 * in light mode — worse than not trying. A light icon is simply the correct
 * one, whatever the theme reports.
 */
export function trayIconFile(platform: NodeJS.Platform | string): string {
  return platform === "darwin" ? "trayTemplate.png" : "trayLight.png";
}

export function trayIconIsTemplate(platform: NodeJS.Platform | string): boolean {
  return platform === "darwin";
}
