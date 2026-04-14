import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { ExplanationResult } from "../config/schema.js";
import { assertSafeSessionId } from "../session/session-id.js";

/**
 * Per-user tmp subdirectory. Duplicated from session/tracker.ts intentionally
 * for Phase 1; phase-2 refactor consolidates both into a shared module.
 */
function getUserTmpDir(): string {
  let suffix: string;
  try {
    const info = userInfo();
    suffix = typeof info.username === "string" && info.username ? info.username : "user";
  } catch {
    suffix = "user";
  }
  suffix = suffix.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "user";
  const dir = join(tmpdir(), `code-explainer-${suffix}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getCacheFilePath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(getUserTmpDir(), `cache-${sessionId}.jsonl`);
}

export function hashDiff(diff: string): string {
  return createHash("sha256").update(diff, "utf-8").digest("hex");
}

interface CacheEntry {
  hash: string;
  result: ExplanationResult;
}

export function getCached(sessionId: string, diff: string): ExplanationResult | undefined {
  const path = getCacheFilePath(sessionId);
  if (!existsSync(path)) return undefined;

  const hash = hashDiff(diff);
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // Iterate in reverse so the most recent entry wins on duplicates.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as CacheEntry;
        if (entry.hash === hash) {
          return entry.result;
        }
      } catch {
        // Skip malformed line
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function setCached(sessionId: string, diff: string, result: ExplanationResult): void {
  const path = getCacheFilePath(sessionId);
  const entry: CacheEntry = { hash: hashDiff(diff), result };
  try {
    appendFileSync(path, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch {
    // Cache write failures are non-fatal
  }
}

export function clearCache(sessionId: string): void {
  const path = getCacheFilePath(sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
