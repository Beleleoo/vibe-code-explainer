import { existsSync, readFileSync, appendFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { RiskLevel } from "../config/schema.js";
import { clearCache } from "../cache/explanation-cache.js";
import { formatDriftAlert, printToStderr } from "../format/box.js";
import { assertSafeSessionId } from "./session-id.js";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface SessionEntry {
  file: string;
  timestamp: number;
  risk: RiskLevel;
  summary: string;
  unrelated?: boolean;
}

/**
 * Per-user tmp subdirectory for session and cache files.
 * We suffix with the OS username (works cross-platform; getuid is undefined
 * on Windows) so a shared %TEMP% on a multi-user Windows box does not
 * leak one user's session state into another's.
 */
function getUserTmpDir(): string {
  let suffix: string;
  try {
    const info = userInfo();
    suffix = typeof info.username === "string" && info.username ? info.username : "user";
  } catch {
    suffix = "user";
  }
  // Defensive: keep the suffix itself path-safe.
  suffix = suffix.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "user";
  const dir = join(tmpdir(), `code-explainer-${suffix}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getSessionFilePath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(getUserTmpDir(), `session-${sessionId}.jsonl`);
}

export function recordEntry(sessionId: string, entry: SessionEntry): void {
  const path = getSessionFilePath(sessionId);
  try {
    appendFileSync(path, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch {
    // Non-fatal
  }
}

export function readSession(sessionId: string): SessionEntry[] {
  const path = getSessionFilePath(sessionId);
  if (!existsSync(path)) return [];

  try {
    const content = readFileSync(path, "utf-8");
    return content
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as SessionEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is SessionEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Get the last N recorded summaries for this session, oldest-first.
 * Used to feed prompt context for "same pattern" detection.
 */
export function getRecentSummaries(sessionId: string, n: number): string[] {
  const entries = readSession(sessionId);
  if (entries.length === 0) return [];
  return entries.slice(-n).map((e) => `${e.file}: ${e.summary}`);
}

export function cleanStaleSessionFiles(): void {
  try {
    const dir = getUserTmpDir();
    const now = Date.now();
    const entries = readdirSync(dir);
    for (const name of entries) {
      if (!name.startsWith("session-") && !name.startsWith("cache-")) continue;
      const filePath = join(dir, name);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > TWO_HOURS_MS) {
          unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function getSessionIdFromEnv(): string | undefined {
  return process.env.CODE_EXPLAINER_SESSION_ID;
}

function findLatestSession(): string | undefined {
  try {
    const dir = getUserTmpDir();
    const entries = readdirSync(dir)
      .filter((n) => n.startsWith("session-") && n.endsWith(".jsonl"))
      .map((n) => ({
        name: n,
        id: n.slice("session-".length, -".jsonl".length),
        mtime: statSync(join(dir, n)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.id;
  } catch {
    return undefined;
  }
}

export async function printSummary(): Promise<void> {
  const sessionId = getSessionIdFromEnv() ?? findLatestSession();
  if (!sessionId) {
    process.stderr.write("[code-explainer] No active session found. Session data is created when Claude Code makes changes.\n");
    return;
  }

  const entries = readSession(sessionId);
  if (entries.length === 0) {
    process.stderr.write(`[code-explainer] Session '${sessionId}' has no recorded changes yet.\n`);
    return;
  }

  const related = entries.filter((e) => !e.unrelated);
  const unrelated = entries.filter((e) => e.unrelated);
  const uniqueFiles = Array.from(new Set(entries.map((e) => e.file)));
  const unrelatedFiles = Array.from(new Set(unrelated.map((e) => e.file)));

  const alert = formatDriftAlert(uniqueFiles.length, unrelatedFiles);
  printToStderr(alert);

  process.stderr.write(`\nTotal changes: ${entries.length}\n`);
  process.stderr.write(`Files touched: ${uniqueFiles.length}\n`);
  process.stderr.write(`Related changes: ${related.length}\n`);
  process.stderr.write(`Unrelated/risky: ${unrelated.length}\n`);

  const risks: Record<RiskLevel, number> = { none: 0, low: 0, medium: 0, high: 0 };
  for (const e of entries) risks[e.risk]++;
  process.stderr.write(`\nRisk breakdown:\n`);
  process.stderr.write(`  None:   ${risks.none}\n`);
  process.stderr.write(`  Low:    ${risks.low}\n`);
  process.stderr.write(`  Medium: ${risks.medium}\n`);
  process.stderr.write(`  High:   ${risks.high}\n`);
}

export async function endSession(): Promise<void> {
  const sessionId = getSessionIdFromEnv() ?? findLatestSession();
  if (!sessionId) {
    process.stderr.write("[code-explainer] No active session to end.\n");
    return;
  }

  const sessionPath = getSessionFilePath(sessionId);
  if (existsSync(sessionPath)) {
    try {
      unlinkSync(sessionPath);
    } catch {
      // ignore
    }
  }
  clearCache(sessionId);
  process.stderr.write(`[code-explainer] Session '${sessionId}' ended. State cleared.\n`);
}
