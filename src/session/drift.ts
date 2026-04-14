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
 * Fires once every time the unrelated count crosses a multiple of the threshold.
 */
export function shouldAlertDrift(entries: SessionEntry[]): DriftThresholdResult {
  const uniqueFiles = Array.from(new Set(entries.map((e) => e.file)));
  const unrelatedFiles = Array.from(
    new Set(entries.filter((e) => e.unrelated).map((e) => e.file))
  );

  // Alert exactly when we hit the threshold (not every call afterwards).
  const shouldAlert =
    unrelatedFiles.length > 0 &&
    unrelatedFiles.length % DRIFT_ALERT_THRESHOLD === 0 &&
    entries.filter((e) => e.unrelated).length ===
      entries.filter((e) => e.unrelated).length;

  // Fire specifically on the edit that caused us to cross the threshold.
  const lastEntry = entries[entries.length - 1];
  const lastWasUnrelated = lastEntry?.unrelated ?? false;
  const crossedThreshold =
    lastWasUnrelated && unrelatedFiles.length % DRIFT_ALERT_THRESHOLD === 0;

  return {
    shouldAlert: crossedThreshold && shouldAlert,
    totalFiles: uniqueFiles.length,
    unrelatedFiles,
  };
}
