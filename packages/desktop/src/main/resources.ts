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
