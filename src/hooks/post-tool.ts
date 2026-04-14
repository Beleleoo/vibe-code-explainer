import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../config/schema.js";
import type { Config, HookPayload, ExplanationResult } from "../config/schema.js";
import { callOllama, type EngineOutcome } from "../engines/ollama.js";
import { callClaude } from "../engines/claude.js";
import {
  extractEditDiff,
  extractNewFileDiff,
  buildDiffFromEdit,
  buildDiffFromMultiEdit,
  isExcluded,
} from "./diff-extractor.js";
import { shouldCaptureBash } from "../filter/bash-filter.js";
import { formatExplanationBox, formatDriftAlert, formatSkipNotice, formatErrorNotice } from "../format/box.js";
import { recordEntry, readSession, getRecentSummaries, cleanStaleSessionFiles } from "../session/tracker.js";
import { analyzeDrift, shouldAlertDrift } from "../session/drift.js";
import { getCached, setCached } from "../cache/explanation-cache.js";

const output: string[] = [];

function addOutput(text: string): void {
  output.push(text);
}

/**
 * Emit the Claude Code hook JSON on stdout so the accumulated output
 * appears as a system message in the user's terminal. Always exit 0 so
 * Claude Code is never blocked.
 */
function safeExit(): never {
  if (output.length > 0) {
    // Leading newline separates the box from Claude Code's "PostToolUse:X says:"
    // prefix, which otherwise renders on the same line as the top border.
    const systemMessage = "\n" + output.join("\n");
    process.stdout.write(JSON.stringify({ systemMessage }) + "\n");
  }
  process.exit(0);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    // Safety timeout: if stdin has no data in 2s, resolve empty.
    setTimeout(() => resolve(data), 2000);
  });
}

function parsePayload(raw: string): HookPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.session_id === "string" && typeof parsed.tool_name === "string") {
      return parsed as HookPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function loadConfigSafe(cwd: string): Config {
  // loadConfig already falls back to the global config at
  // ~/.code-explainer.config.json when the project path doesn't exist,
  // and to built-in defaults if neither exists.
  try {
    return loadConfig(join(cwd, "code-explainer.config.json"));
  } catch {
    return DEFAULT_CONFIG;
  }
}

function isHookEnabled(toolName: string, config: Config): boolean {
  const lower = toolName.toLowerCase();
  if (lower === "edit" || lower === "multiedit") return config.hooks.edit;
  if (lower === "write") return config.hooks.write;
  if (lower === "bash") return config.hooks.bash;
  return false;
}

async function runEngine(
  filePath: string,
  diff: string,
  config: Config,
  userPrompt: string | undefined,
  recentSummaries: string[],
  signal: AbortSignal
): Promise<EngineOutcome> {
  if (signal.aborted) {
    return { kind: "skip", reason: "interrupted by user" };
  }
  if (config.engine === "ollama") {
    return callOllama({ filePath, diff, config, recentSummaries });
  }
  return callClaude({ filePath, diff, config, userPrompt, recentSummaries });
}

async function main(): Promise<void> {
  // Interrupt handler — always exit 0 on Ctrl+C.
  const controller = new AbortController();
  process.on("SIGINT", () => {
    controller.abort();
    addOutput(formatSkipNotice("interrupted by user"));
    safeExit();
  });

  const raw = await readStdin();
  if (!raw.trim()) safeExit();

  const payload = parsePayload(raw);
  if (!payload) safeExit();

  const cwd = payload.cwd || process.cwd();
  const config = loadConfigSafe(cwd);

  if (!isHookEnabled(payload.tool_name, config)) safeExit();

  cleanStaleSessionFiles();

  // Pass session_id to downstream modules via env (so summary/session-end
  // commands pick the right session without re-parsing the payload).
  process.env.CODE_EXPLAINER_SESSION_ID = payload.session_id;

  // Extract the diff based on tool name.
  let filePath: string;
  let diff: string;

  const lowerTool = payload.tool_name.toLowerCase();
  if (lowerTool === "edit" || lowerTool === "multiedit" || lowerTool === "write") {
    const input = payload.tool_input as {
      file_path?: string;
      filePath?: string;
      old_string?: string;
      new_string?: string;
      oldString?: string;
      newString?: string;
      edits?: Array<{ old_string?: string; new_string?: string; oldString?: string; newString?: string }>;
    };
    const target = input.file_path ?? input.filePath;
    if (!target) safeExit();
    filePath = target as string;

    if (isExcluded(filePath, config.exclude)) safeExit();

    // Preferred path: use the payload's old/new strings directly. This works
    // for untracked files (very common) and is always more accurate than git
    // diff, which may miss changes on files that were created and edited in
    // the same session without a commit.
    let result;
    if (lowerTool === "edit") {
      const oldStr = input.old_string ?? input.oldString ?? "";
      const newStr = input.new_string ?? input.newString ?? "";
      if (oldStr || newStr) {
        result = buildDiffFromEdit(filePath, oldStr, newStr);
      } else {
        result = extractEditDiff(filePath, cwd);
      }
    } else if (lowerTool === "multiedit") {
      if (input.edits && input.edits.length > 0) {
        result = buildDiffFromMultiEdit(filePath, input.edits);
      } else {
        result = extractEditDiff(filePath, cwd);
      }
    } else {
      result = extractNewFileDiff(filePath, cwd);
    }

    if (result.kind === "empty") safeExit();
    if (result.kind === "skip") {
      addOutput(formatSkipNotice(result.reason));
      safeExit();
    }
    if (result.kind === "binary") {
      addOutput(formatSkipNotice(result.message));
      safeExit();
    }
    diff = result.content;
  } else if (lowerTool === "bash") {
    const input = payload.tool_input as { command?: string };
    const command = input.command ?? "";
    if (!command || !shouldCaptureBash(command)) safeExit();
    filePath = "<bash command>";
    diff = command;
  } else {
    safeExit();
  }

  // Cache check.
  const cacheKey = `${filePath}\n${diff}`;
  const cached = getCached(payload.session_id, cacheKey);
  let result: ExplanationResult | null = null;

  if (cached) {
    result = cached;
  } else {
    const recentSummaries = getRecentSummaries(payload.session_id, 3);
    const outcome = await runEngine(
      filePath,
      diff,
      config,
      undefined,
      recentSummaries,
      controller.signal
    );
    if (outcome.kind === "skip") {
      addOutput(formatSkipNotice(outcome.reason));
      safeExit();
    }
    if (outcome.kind === "error") {
      addOutput(formatErrorNotice(outcome.problem, outcome.cause, outcome.fix));
      safeExit();
    }
    result = outcome.result;
    setCached(payload.session_id, cacheKey, result);
  }

  // Path-heuristic drift analysis (only meaningful for Edit/Write).
  let driftReason: string | undefined;
  if (filePath !== "<bash command>") {
    const priorEntries = readSession(payload.session_id);
    const analysis = analyzeDrift(filePath, priorEntries);
    if (analysis.isUnrelated) {
      driftReason = analysis.reason;
    }
  }

  // Print the explanation box with the new structured format.
  addOutput(
    formatExplanationBox({
      filePath,
      result,
      detailLevel: config.detailLevel,
      language: config.language,
    })
  );

  // Record the entry. Use impact as the summary for drift/session tracking.
  const summaryForTracking = result.isSamePattern
    ? result.samePatternNote || "Same pattern as a recent edit"
    : result.impact;

  recordEntry(payload.session_id, {
    file: filePath,
    timestamp: Date.now(),
    risk: result.risk,
    summary: summaryForTracking,
    unrelated: !!driftReason,
  });

  // Drift alert at threshold.
  const updated = readSession(payload.session_id);
  const driftCheck = shouldAlertDrift(updated);
  if (driftCheck.shouldAlert) {
    addOutput(formatDriftAlert(driftCheck.totalFiles, driftCheck.unrelatedFiles, undefined, config.language));
  }

  safeExit();
}

main().catch(() => {
  // Never fail the hook — always exit 0.
  safeExit();
});
