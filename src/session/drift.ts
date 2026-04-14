import type { SessionEntry } from "./tracker.js";

const SENSITIVE_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)payment/i,
  /(^|\/)billing/i,
  /(^|\/)stripe/i,
  /(^|\/)auth/i,
  /(^|\/)credential/i,
  /(^|\/)secret/i,
  /(^|\/)\.ssh\//i,
];

function topLevelDir(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = norm.split("/").filter(Boolean);
  return parts[0] ?? "";
}

export function matchesSensitivePattern(filePath: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(filePath));
}

export interface DriftAnalysis {
  isUnrelated: boolean;
  reason?: string;
}

/**
 * Path-heuristic drift detection for the Ollama engine.
 * Flags a new file as unrelated if:
 *   1. It matches a sensitive pattern (env, payment, auth, secrets) AND
 *      the session did not start in a similarly-sensitive area.
 *   2. It lives in a different top-level directory than every file
 *      edited so far in the session (cross-module drift).
 *
 * Returns `isUnrelated: false` for the first few edits (not enough
 * context to judge).
 */
export function analyzeDrift(
  newFilePath: string,
  priorEntries: SessionEntry[]
): DriftAnalysis {
  // Not enough context yet for the first edit.
  if (priorEntries.length === 0) {
    return { isUnrelated: false };
  }

  const priorFiles = Array.from(new Set(priorEntries.map((e) => e.file)));
  const priorTopDirs = new Set(priorFiles.map(topLevelDir));
  const priorHasSensitive = priorFiles.some(matchesSensitivePattern);

  // Sensitive-pattern drift: the new file is in a sensitive area but
  // prior session was not working there.
  if (matchesSensitivePattern(newFilePath) && !priorHasSensitive) {
    return {
      isUnrelated: true,
      reason: `touches sensitive area (${newFilePath}) that was not part of earlier edits`,
    };
  }

  // Cross-module drift: only flag after at least 2 prior edits established
  // a working area.
  if (priorEntries.length >= 2) {
    const newTop = topLevelDir(newFilePath);
    if (newTop && !priorTopDirs.has(newTop)) {
      return {
        isUnrelated: true,
        reason: `is in a different top-level area (${newTop}) than earlier edits (${Array.from(priorTopDirs).join(", ")})`,
      };
    }
  }

  return { isUnrelated: false };
}

export interface DriftThresholdResult {
  shouldAlert: boolean;
  totalFiles: number;
  unrelatedFiles: string[];
}

const DRIFT_ALERT_THRESHOLD = 3;

/**
 * Decide whether to surface a drift alert based on accumulated session state.
 * Fires once, on the single edit that takes the unique-unrelated-file count
 * to exactly DRIFT_ALERT_THRESHOLD. Further unrelated files in the same
 * session do not refire — the user can run `summary` for a full picture.
 * This avoids the alert-fatigue pattern where naturally cross-module work
 * in a monorepo would trigger repeated alerts at 3, 6, 9, etc.
 */
export function shouldAlertDrift(entries: SessionEntry[]): DriftThresholdResult {
  const uniqueFiles = Array.from(new Set(entries.map((e) => e.file)));
  const unrelatedFiles = Array.from(
    new Set(entries.filter((e) => e.unrelated).map((e) => e.file))
  );

  const lastEntry = entries[entries.length - 1];
  const lastWasUnrelated = lastEntry?.unrelated ?? false;

  // Single-fire: alert only on the invocation that takes unique unrelated
  // file count to exactly the threshold, and only when the triggering edit
  // itself was the unrelated one (otherwise we'd alert on a benign edit that
  // simply happened to be logged after a drift crossing).
  const shouldAlert =
    lastWasUnrelated && unrelatedFiles.length === DRIFT_ALERT_THRESHOLD;

  return {
    shouldAlert,
    totalFiles: uniqueFiles.length,
    unrelatedFiles,
  };
}
