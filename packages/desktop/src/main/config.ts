import { readFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";

/**
 * Configuration is a flat JSON file in the platform config directory.
 *
 * Every function here takes its environment explicitly rather than reading
 * globals, so tests never touch the real home directory.
 */

export interface WaypointConfig {
  /** Absolute path to the markdown inbox. Lives outside the app repo. */
  inboxPath: string;
  /** Electron accelerator string for the global capture hotkey. */
  hotkey: string;
  /** Absolute path to the bundled whisper model. */
  whisperModelPath: string;
}

export interface ConfigEnv {
  home: string;
  platform: NodeJS.Platform | "linux" | "darwin";
  /** Overrides the XDG config root on Linux. */
  xdgConfigHome?: string | undefined;
  /** Where bundled resources live; differs between dev and a packaged app. */
  resourcesDir?: string | undefined;
}

export interface ConfigLoadResult {
  config: WaypointConfig;
  /**
   * Human-readable description of what was wrong with the file, if anything.
   * A bad config never blocks startup — capture must survive it — so this is
   * reported to the user rather than thrown.
   */
  problem?: string;
}

const MODEL_FILENAME = "ggml-small.en.bin";

export function currentEnv(): ConfigEnv {
  return {
    home: homedir(),
    platform: osPlatform(),
    xdgConfigHome: process.env["XDG_CONFIG_HOME"],
  };
}

export function defaultConfig(env: ConfigEnv): WaypointConfig {
  const resources = env.resourcesDir ?? join(env.home, ".local", "share", "waypoint", "whisper");
  return {
    inboxPath: join(env.home, "waypoint", "inbox.md"),
    hotkey: "CommandOrControl+Shift+Space",
    whisperModelPath: join(resources, MODEL_FILENAME),
  };
}

export function configFilePath(env: ConfigEnv): string {
  if (env.platform === "darwin") {
    return join(env.home, "Library", "Application Support", "waypoint", "config.json");
  }
  const xdg = env.xdgConfigHome && env.xdgConfigHome.length > 0
    ? env.xdgConfigHome
    : join(env.home, ".config");
  return join(xdg, "waypoint", "config.json");
}

export function loadConfig(filePath: string, env: ConfigEnv): ConfigLoadResult {
  const defaults = defaultConfig(env);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // No file yet is the normal first-run case, not a problem worth reporting.
      return { config: defaults };
    }
    return {
      config: defaults,
      problem: `Could not read config at ${filePath} (${code ?? "unknown error"}); using defaults.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: defaults,
      problem: `Config at ${filePath} is not valid JSON; using defaults.`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      config: defaults,
      problem: `Config at ${filePath} is not a JSON object; using defaults.`,
    };
  }

  const record = parsed as Record<string, unknown>;
  const config = { ...defaults };
  const badKeys: string[] = [];

  for (const key of ["inboxPath", "hotkey", "whisperModelPath"] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.length > 0) {
      config[key] = value;
    } else {
      // Keep the default rather than refusing to start.
      badKeys.push(key);
    }
  }

  const result: ConfigLoadResult = { config };
  if (badKeys.length > 0) {
    result.problem =
      `Config at ${filePath} has invalid values for ${badKeys.join(", ")}; ` +
      `using defaults for those.`;
  }
  return result;
}
