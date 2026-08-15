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
  /** Active projects the user may drive at once (004 FR-038). */
  wipLimit: number;
  /** Milestones per project. Feature 3's shipped constant (004 FR-061). */
  milestoneCap: number;
  /** Outcomes per week (004 FR-063). */
  weeklyOutcomeCap: number;
  /**
   * Whether a non-empty inbox stops the weekly review advancing (005 FR-017).
   *
   * Ships as `warn`, the opposite default from the WIP limit and deliberately
   * so: the limit guards a commitment the user is making, while a full inbox
   * only makes the picture incomplete — and a review that cannot start is a
   * review that does not happen.
   */
  inboxGate: "warn" | "block";
  /**
   * How long a waiting subject may sit untouched before it is surfaced
   * (005 FR-038).
   *
   * One value for both subjects — delegated items and projects parked in
   * `waiting` — because they are the same rule applied to two things. Not
   * separately configurable, by construction.
   */
  stalenessDays: number;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  wipLimit: 3,
  milestoneCap: 4,
  weeklyOutcomeCap: 3,
  inboxGate: "warn",
  stalenessDays: 7,
};

/** Vault-relative path. */
export const POLICY_PATH = "policy.md";

/** The whole-number settings. `inbox gate` is a keyword and is read separately. */
const COUNT_KEYS: ReadonlyArray<{ key: string; field: "wipLimit" | "milestoneCap" | "weeklyOutcomeCap" | "stalenessDays" }> = [
  { key: "wip limit", field: "wipLimit" },
  { key: "milestone cap", field: "milestoneCap" },
  { key: "weekly outcome cap", field: "weeklyOutcomeCap" },
  { key: "staleness days", field: "stalenessDays" },
];

const INBOX_GATE_KEY = "inbox gate";
const INBOX_GATE_VALUES = ["warn", "block"] as const;

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
    for (const { key, field } of COUNT_KEYS) {
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

    // The first keyword-valued setting. Its failure is a different shape from a
    // count's — an unrecognised word rather than a number that would not parse —
    // so the message names the word the user typed and the words that work.
    const rawGate = rawValue(content, INBOX_GATE_KEY);
    if (rawGate !== null) {
      const gate = INBOX_GATE_VALUES.find((v) => v === rawGate.toLowerCase());
      if (gate === undefined) {
        problems.push(
          `"${INBOX_GATE_KEY}" is not ${INBOX_GATE_VALUES.join(" or ")} ("${rawGate}"), ` +
            `so the default of ${DEFAULT_POLICY_CONFIG.inboxGate} applies.`,
        );
      } else {
        config.inboxGate = gate;
      }
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
