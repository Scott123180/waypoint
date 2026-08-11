import { readFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";

import { WHISPER_MODEL_FILENAME } from "./resources";

/**
 * Configuration is a flat JSON file in the platform config directory.
 *
 * Every function here takes its environment explicitly rather than reading
 * globals, so tests never touch the real home directory.
 */

export interface WaypointConfig {
  /** Absolute path to the markdown inbox. Lives outside the app repo. */
  inboxPath: string;
  /**
   * Directory holding the whole vault: the inbox plus every sort destination.
   *
   * Derived from `inboxPath`'s directory rather than defaulted independently,
   * so relocating the inbox moves projects, areas, and the running lists with
   * it instead of scattering them across two directories (research R8a).
   * An explicit value in the config file overrides the derivation.
   */
  vaultRoot: string;
  /** Electron accelerator opening the capture box for typing. */
  hotkey: string;
  /** Electron accelerator opening the capture box already dictating (FR-001a). */
  dictateHotkey: string;
  /** Absolute path to the bundled whisper model. */
  whisperModelPath: string;
}

export interface ConfigEnv {
  home: string;
  platform: NodeJS.Platform | "linux" | "darwin";
  /** Overrides the XDG config root on Linux. */
  xdgConfigHome?: string | undefined;
  /** Overrides the XDG state root on Linux. */
  xdgStateHome?: string | undefined;
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

export function currentEnv(): ConfigEnv {
  return {
    home: homedir(),
    platform: osPlatform(),
    xdgConfigHome: process.env["XDG_CONFIG_HOME"],
    xdgStateHome: process.env["XDG_STATE_HOME"],
  };
}

export function defaultConfig(env: ConfigEnv): WaypointConfig {
  // resourcesDir comes from whisperResourcesDir() so the model always resolves
  // to the same place as the binary. The empty-string fallback only applies in
  // tests that do not care about the model path.
  const resources = env.resourcesDir ?? "";
  return {
    inboxPath: join(env.home, "waypoint", "inbox.md"),
    vaultRoot: join(env.home, "waypoint"),
    // Dictation gets the more prominent combination: it is the mode reached for
    // most, and it is the one that otherwise costs a keystroke *and* a click.
    hotkey: "CommandOrControl+Shift+Enter",
    dictateHotkey: "CommandOrControl+Shift+Space",
    whisperModelPath: join(resources, WHISPER_MODEL_FILENAME),
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

  for (const key of ["inboxPath", "hotkey", "dictateHotkey", "whisperModelPath"] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.length > 0) {
      config[key] = value;
    } else {
      // Keep the default rather than refusing to start.
      badKeys.push(key);
    }
  }

  // Resolved after inboxPath so a relocated inbox takes its vault with it. An
  // explicit vaultRoot wins; an invalid one falls back to the derivation rather
  // than to the home-directory default, which would split the vault in two.
  const rawVaultRoot = record["vaultRoot"];
  if (rawVaultRoot === undefined) {
    config.vaultRoot = dirname(config.inboxPath);
  } else if (typeof rawVaultRoot === "string" && rawVaultRoot.length > 0) {
    config.vaultRoot = rawVaultRoot;
  } else {
    config.vaultRoot = dirname(config.inboxPath);
    badKeys.push("vaultRoot");
  }

  const result: ConfigLoadResult = { config };
  if (badKeys.length > 0) {
    result.problem =
      `Config at ${filePath} has invalid values for ${badKeys.join(", ")}; ` +
      `using defaults for those.`;
  }
  return result;
}

export interface VaultPaths {
  projectsDir: string;
  areasDir: string;
  waitingPath: string;
  calendarPath: string;
  trashPath: string;
}

/**
 * Every sort destination, derived from one root.
 *
 * Centralized so no caller invents its own path. See
 * specs/002-inbox-view-sort/contracts/vault-format.md
 */
export function vaultPaths(config: WaypointConfig): VaultPaths {
  return {
    projectsDir: join(config.vaultRoot, "projects"),
    areasDir: join(config.vaultRoot, "areas"),
    waitingPath: join(config.vaultRoot, "waiting.md"),
    calendarPath: join(config.vaultRoot, "calendar.md"),
    trashPath: join(config.vaultRoot, "trash.md"),
  };
}

/**
 * Where the sort journal lives: the platform *state* directory, deliberately
 * not the user's vault.
 *
 * It is recovery bookkeeping with a lifetime measured in milliseconds. Keeping
 * it out of the vault keeps the user's git history clean and avoids a file
 * they would reasonably wonder about (research R9).
 */
export function sortJournalPath(env: ConfigEnv): string {
  if (env.platform === "darwin") {
    return join(env.home, "Library", "Application Support", "waypoint", "sort-journal.jsonl");
  }
  const xdg = env.xdgStateHome && env.xdgStateHome.length > 0
    ? env.xdgStateHome
    : join(env.home, ".local", "state");
  return join(xdg, "waypoint", "sort-journal.jsonl");
}
