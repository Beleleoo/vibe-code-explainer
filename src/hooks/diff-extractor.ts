import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

export type DiffResult =
  | { kind: "diff"; content: string; lines: number; truncated: boolean }
  | { kind: "new-file"; content: string; lines: number; truncated: boolean }
  | { kind: "binary"; message: string }
  | { kind: "empty" }
  | { kind: "skip"; reason: string };

const MAX_DIFF_LINES = 200;
const HEAD_LINES = 150;
const TAIL_LINES = 50;

function truncateDiff(content: string): { content: string; lines: number; truncated: boolean } {
  const lines = content.split("\n");
  if (lines.length <= MAX_DIFF_LINES) {
    return { content, lines: lines.length, truncated: false };
  }
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  const truncated = [
    ...head,
    `[...truncated, ${omitted} more lines not shown]`,
    ...tail,
  ].join("\n");
  return { content: truncated, lines: lines.length, truncated: true };
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 1024 * 1024 * 10 });
}

/**
 * Build a unified-style diff directly from an Edit tool's old_string/new_string
 * payload. More reliable than `git diff` because it works even on untracked
 * files (the common case: user asks Claude to edit a file that was just
 * created and never committed). Multi-line strings produce proper line-by-line
 * - / + markers so the model can tell additions apart from modifications.
 */
export function buildDiffFromEdit(
  filePath: string,
  oldString: string,
  newString: string
): DiffResult {
  if (!oldString && !newString) return { kind: "empty" };

  const oldLines = oldString ? oldString.split("\n") : [];
  const newLines = newString ? newString.split("\n") : [];

  const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ Edit @@`;
  const minus = oldLines.map((l) => `-${l}`).join("\n");
  const plus = newLines.map((l) => `+${l}`).join("\n");

  const parts = [header, minus, plus].filter((s) => s.length > 0);
  const content = parts.join("\n");

  const { content: final, lines, truncated } = truncateDiff(content);
  return { kind: "diff", content: final, lines, truncated };
}

/**
 * Build a combined unified-style diff from a MultiEdit payload's edits array.
 */
export function buildDiffFromMultiEdit(
  filePath: string,
  edits: Array<{ old_string?: string; new_string?: string; oldString?: string; newString?: string }>
): DiffResult {
  if (!edits || edits.length === 0) return { kind: "empty" };

  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  const hunks: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const oldStr = e.old_string ?? e.oldString ?? "";
    const newStr = e.new_string ?? e.newString ?? "";
    if (!oldStr && !newStr) continue;

    const oldLines = oldStr ? oldStr.split("\n") : [];
    const newLines = newStr ? newStr.split("\n") : [];
    const minus = oldLines.map((l) => `-${l}`).join("\n");
    const plus = newLines.map((l) => `+${l}`).join("\n");

    hunks.push(`@@ Edit ${i + 1} of ${edits.length} @@`);
    if (minus) hunks.push(minus);
    if (plus) hunks.push(plus);
  }

  if (hunks.length === 0) return { kind: "empty" };

  const content = [header, ...hunks].join("\n");
  const { content: final, lines, truncated } = truncateDiff(content);
  return { kind: "diff", content: final, lines, truncated };
}

export function extractEditDiff(filePath: string, cwd: string): DiffResult {
  // Check if we're in a git repo.
  try {
    runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  } catch {
    return { kind: "skip", reason: "not inside a git repository" };
  }

  // Check for binary.
  try {
    const numstat = runGit(["diff", "--numstat", "--", filePath], cwd).trim();
    if (numstat.startsWith("-\t-\t")) {
      return { kind: "binary", message: `Binary file modified: ${filePath}` };
    }
  } catch {
    // Non-fatal, fall through to diff.
  }

  let diffOutput = "";
  try {
    diffOutput = runGit(["diff", "--no-color", "--", filePath], cwd);
  } catch {
    diffOutput = "";
  }

  if (!diffOutput.trim()) {
    // File may be untracked (newly created via Write/Edit on a fresh file).
    return extractNewFileDiff(filePath, cwd);
  }

  const { content, lines, truncated } = truncateDiff(diffOutput);
  return { kind: "diff", content, lines, truncated };
}

export function extractNewFileDiff(filePath: string, cwd: string): DiffResult {
  try {
    runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  } catch {
    // Not a git repo — fall back to reading the file if possible.
    return readFileAsNewDiff(filePath);
  }

  // Check if file is untracked.
  let untracked = "";
  try {
    untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", filePath], cwd).trim();
  } catch {
    untracked = "";
  }

  if (untracked) {
    return readFileAsNewDiff(filePath);
  }

  // Might be a file with no changes, or tracked without a diff.
  return { kind: "empty" };
}

/**
 * Inspect the first 8KB of the raw file bytes to decide whether content is
 * binary BEFORE decoding as UTF-8. Node's `readFileSync(path, 'utf-8')`
 * replaces invalid bytes with U+FFFD rather than preserving null bytes,
 * which means binary files without literal NULs (PNG/WASM/.mo/most
 * proprietary formats) would silently pass a later `raw.includes("\0")`
 * check and be sent to the LLM as garbled "text".
 */
function looksBinary(buf: Buffer): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf;
  if (sample.length === 0) return false;
  if (sample.indexOf(0) !== -1) return true;
  let nonPrint = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    // Common whitespace (tab, LF, CR), printable ASCII, or UTF-8 continuation
    // / high-bit bytes. Count anything else as suspicious.
    if (
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      (b >= 0x20 && b <= 0x7e) ||
      b >= 0x80
    ) {
      continue;
    }
    nonPrint++;
  }
  return nonPrint / sample.length > 0.3;
}

function readFileAsNewDiff(filePath: string): DiffResult {
  if (!existsSync(filePath)) {
    return { kind: "skip", reason: `file not found: ${filePath}` };
  }

  try {
    const stat = statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return { kind: "skip", reason: `file too large (${Math.round(stat.size / 1024)}KB)` };
    }

    const buf = readFileSync(filePath);
    if (buf.length === 0) {
      return { kind: "empty" };
    }
    if (looksBinary(buf)) {
      return { kind: "binary", message: `Binary file created: ${filePath}` };
    }

    const raw = buf.toString("utf-8");
    if (!raw.trim()) {
      return { kind: "empty" };
    }

    const withMarkers = raw.split("\n").map((l) => `+ ${l}`).join("\n");
    const diff = `--- /dev/null\n+++ b/${filePath}\n${withMarkers}`;
    const { content, lines, truncated } = truncateDiff(diff);
    return { kind: "new-file", content, lines, truncated };
  } catch {
    return { kind: "skip", reason: "could not read file" };
  }
}

/**
 * Minimal glob matcher supporting *, **, and simple extensions.
 * Matches POSIX-style paths (caller normalizes).
 *
 * - `*.ext` matches `file.ext` in any directory
 * - `dir/**` matches anything under `dir/` recursively
 * - `**\/file.ts` matches `file.ts` anywhere
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Build regex from the pattern
  let regexSrc = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*") {
      if (normalizedPattern[i + 1] === "*") {
        // ** matches anything (including /)
        regexSrc += ".*";
        i += 2;
        if (normalizedPattern[i] === "/") i++; // consume trailing /
      } else {
        // * matches anything except /
        regexSrc += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexSrc += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]]/.test(ch)) {
      regexSrc += "\\" + ch;
      i++;
    } else {
      regexSrc += ch;
      i++;
    }
  }

  // If the pattern has no directory component, match the filename anywhere.
  const hasSlash = normalizedPattern.includes("/");
  const anchored = hasSlash
    ? new RegExp(`^${regexSrc}$`)
    : new RegExp(`(^|/)${regexSrc}$`);

  return anchored.test(normalized);
}

export function isExcluded(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(filePath, p));
}
