import { existsSync, mkdirSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

/**
 * Per-user tmp subdirectory for session and cache files.
 * Suffixes with the OS username (works cross-platform; `process.getuid`
 * is undefined on Windows) so a shared %TEMP% on a multi-user Windows
 * box does not leak one user's session state into another's.
 */
export function getUserTmpDir(): string {
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
