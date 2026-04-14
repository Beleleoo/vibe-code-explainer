import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExplanationResult } from "../config/schema.js";
import { assertSafeSessionId } from "../session/session-id.js";
import { getUserTmpDir } from "../session/tmpdir.js";

// Rotate the JSONL cache file when it reaches this many lines to prevent
// unbounded growth within a single long session.
const CACHE_ROTATE_THRESHOLD = 500;
// After rotation, keep the N most recent unique entries (by hash).
const CACHE_COMPACT_TARGET = 250;

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

/**
 * If the cache file has grown beyond CACHE_ROTATE_THRESHOLD lines, compact
 * it: deduplicate by hash (keeping the last occurrence) and write back the
 * CACHE_COMPACT_TARGET most recent unique entries atomically via a .tmp file.
 *
 * Atomic write (writeFileSync + renameSync) prevents a crash mid-write from
 * leaving a truncated cache. Non-fatal — any error is silently swallowed.
 *
 * Note: concurrent hook invocations can both pass the size check and attempt
 * to compact the same file. The last rename wins; both will produce a valid
 * compacted file, so data integrity is preserved without a lockfile.
 */
function rotateCacheIfNeeded(path: string): void {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length <= CACHE_ROTATE_THRESHOLD) return;

    // Deduplicate by hash — later lines overwrite earlier (newest wins).
    const seen = new Map<string, CacheEntry>();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as CacheEntry;
        seen.set(entry.hash, entry);
      } catch {
        // skip malformed lines
      }
    }

    // Keep the CACHE_COMPACT_TARGET most recent unique entries.
    const unique = Array.from(seen.values());
    const compacted = unique.slice(-CACHE_COMPACT_TARGET);

    const tmp = path + ".tmp";
    writeFileSync(tmp, compacted.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    // Non-fatal — rotation failure just means the file keeps growing.
  }
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
    rotateCacheIfNeeded(path);
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
