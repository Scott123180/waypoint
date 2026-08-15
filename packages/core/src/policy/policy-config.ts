import { readCount } from "../vault/preamble";

/**
 * The values the default policy module enforces, read from `policy.md`.
 *
 * Stored with the data rather than with the application, so every client
 * opening a vault loads identical rules from the vault itself — agreement by
 * construction rather than by convention (Principle V, FR-057).
 *
 * Two habits matter here:
 *
 *   - **Absence is the normal case.** Every vault already on disk has no
 *     `policy.md`, and so does every Feature 3 test fixture. The defaults are
 *     numerically identical to Feature 3's shipped constants, which is what
 *     makes relocating those rules a no-op for existing data (research R10).
 *
 *   - **Fallback is per value, never per file.** A typo in `wip limit` must not
 *     silently restore a milestone cap of four when the user deliberately set
 *     six. Problems are reported for display and never thrown — a configuration
 *     error must not block an operation (FR-060).
 *
 * See specs/004-top-three-wip-limit/contracts/data-files.md
 */

export interface PolicyConfig {
  /** Active projects the user may drive at once (FR-038). */
  wipLimit: number;
  /** Milestones per project. Feature 3's shipped constant (FR-061). */
  milestoneCap: number;
  /** Outcomes per week (FR-063). */
  weeklyOutcomeCap: number;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  wipLimit: 3,
  milestoneCap: 4,
  weeklyOutcomeCap: 3,
};

/** Vault-relative path. */
export const POLICY_PATH = "policy.md";

const KEYS: ReadonlyArray<{ key: string; field: keyof PolicyConfig }> = [
  { key: "wip limit", field: "wipLimit" },
  { key: "milestone cap", field: "milestoneCap" },
  { key: "weekly outcome cap", field: "weeklyOutcomeCap" },
];

export function parsePolicyConfig(content: string | null): PolicyConfig;
export function parsePolicyConfig(
  content: string | null,
  opts: { withProblems: true },
): PolicyConfig & { problems: string[] };
export function parsePolicyConfig(
  content: string | null,
  opts?: { withProblems?: boolean },
): PolicyConfig | (PolicyConfig & { problems: string[] }) {
  const config: PolicyConfig = { ...DEFAULT_POLICY_CONFIG };
  const problems: string[] = [];

  if (content !== null) {
    for (const { key, field } of KEYS) {
      const raw = rawValue(content, key);
      if (raw === null) continue;

      const value = readCount(content, key);
      if (value === null) {
        // Named, so the user can find the line. The default stands for this
        // value only; every other setting they made deliberately survives.
        problems.push(`"${key}" is not a whole number ("${raw}"), so the default of ${config[field]} applies.`);
        continue;
      }
      config[field] = value;
    }
  }

  return opts?.withProblems === true ? { ...config, problems } : config;
}

/** Present-but-unparseable has to be distinguishable from absent. */
function rawValue(content: string, key: string): string | null {
  const lines = content.split("\n");
  const pattern = new RegExp(`^\\s*${key.replace(/ /g, "\\s+")}\\s*:\\s?(.*)$`, "i");
  for (const line of lines) {
    if (/^##\s+/.test(line)) break;
    const m = pattern.exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}
