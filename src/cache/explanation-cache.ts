import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExplanationResult } from "../config/schema.js";
import { assertSafeSessionId } from "../session/session-id.js";
import { getUserTmpDir } from "../session/tmpdir.js";

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
