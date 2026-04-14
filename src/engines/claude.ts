import { execFile } from "node:child_process";
import type { Config } from "../config/schema.js";
import { buildClaudePrompt } from "../prompts/templates.js";
import type { EngineOutcome } from "./types.js";
import { parseResponse, truncateText } from "./parse.js";

export interface ClaudeCallInputs {
  filePath: string;
  diff: string;
  config: Config;
  recentSummaries?: string[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runClaude(prompt: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", prompt],
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 2, // 2MB
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (e.code === "ENOENT") {
            reject(Object.assign(new Error("claude CLI not found"), { code: "ENOENT" }));
            return;
          }
          if (e.killed || e.signal === "SIGTERM") {
            reject(Object.assign(new Error("claude timed out"), { code: "TIMEOUT" }));
            return;
          }
          // Include stderr for context
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: e.code as unknown as number ?? 1 });
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: 0 });
      }
    );
    child.on("error", (err) => {
      reject(err);
    });
  });
}

export async function callClaude(inputs: ClaudeCallInputs): Promise<EngineOutcome> {
  // Guard prompt building so config-enum drift cannot throw out of the engine
  // (top-level main() would otherwise swallow silently with no skip notice).
  let prompt: string;
  try {
    prompt = buildClaudePrompt(inputs.config.detailLevel, {
      filePath: inputs.filePath,
      diff: inputs.diff,
      language: inputs.config.language,
      learnerLevel: inputs.config.learnerLevel,
      recentSummaries: inputs.recentSummaries,
    });
  } catch (err) {
    return {
      kind: "error",
      problem: "Failed to build Claude prompt",
      cause: (err as Error).message || String(err),
      fix: "Check detailLevel/learnerLevel/language values via 'npx vibe-code-explainer config'",
    };
  }

  try {
    const result = await runClaude(prompt, inputs.config.skipIfSlowMs);

    if (result.code !== 0) {
      const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
      if (/auth|login|unauthorized|not authenticated|api key/i.test(combined)) {
        return {
          kind: "error",
          problem: "Claude Code is not authenticated",
          cause: "The 'claude' CLI requires a valid login",
          fix: "Run 'claude login' in a terminal, or switch engines via 'npx vibe-code-explainer config'",
        };
      }
      return {
        kind: "error",
        problem: "Claude CLI returned an error",
        cause: result.stderr.trim() || `exit code ${result.code}`,
        fix: "Run 'claude --help' to verify the CLI works, or switch engines via 'npx vibe-code-explainer config'",
      };
    }

    if (!result.stdout.trim()) {
      return { kind: "skip", reason: "Claude returned an empty response" };
    }

    const parsed = parseResponse(result.stdout);
    if (parsed) {
      return { kind: "ok", result: parsed };
    }

    // Malformed output: fall back to truncated raw text as the impact field.
    return {
      kind: "ok",
      result: {
        impact: truncateText(result.stdout.trim(), 200),
        howItWorks: "",
        why: "",
        deepDive: [],
        isSamePattern: false,
        samePatternNote: "",
        risk: "none",
        riskReason: "",
      },
    };
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "ENOENT") {
      return {
        kind: "error",
        problem: "Claude CLI not found",
        cause: "The 'claude' command is not installed or not on PATH",
        fix: "Install Claude Code, or switch to Ollama engine via 'npx vibe-code-explainer config'",
      };
    }
    if (e.code === "TIMEOUT") {
      return {
        kind: "skip",
        reason: `explanation took too long (>${inputs.config.skipIfSlowMs}ms)`,
      };
    }
    return {
      kind: "error",
      problem: "Claude CLI invocation failed",
      cause: e.message,
      fix: "Check that 'claude' works by running 'claude --help' in a terminal",
    };
  }
}
