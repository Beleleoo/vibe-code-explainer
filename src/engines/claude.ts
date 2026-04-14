import { execFile } from "node:child_process";
import type {
  Config,
  DeepDiveItem,
  ExplanationResult,
  RiskLevel,
} from "../config/schema.js";
import { buildClaudePrompt } from "../prompts/templates.js";
import type { EngineOutcome } from "./ollama.js";

export interface ClaudeCallInputs {
  filePath: string;
  diff: string;
  config: Config;
  userPrompt?: string;
  recentSummaries?: string[];
}

function extractBalancedObject(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // Strategy 1: already a raw JSON object.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  // Strategy 2: fenced — ```json ... ``` (possibly missing closing ```).
  const fenceOpen = trimmed.match(/```(?:json)?\s*\n?/);
  if (fenceOpen) {
    const afterOpen = trimmed.slice(fenceOpen.index! + fenceOpen[0].length);
    const closingIdx = afterOpen.indexOf("```");
    const inner = closingIdx !== -1 ? afterOpen.slice(0, closingIdx) : afterOpen;
    const innerTrimmed = inner.trim();
    if (innerTrimmed.startsWith("{")) {
      const lastBrace = innerTrimmed.lastIndexOf("}");
      if (lastBrace !== -1) return innerTrimmed.slice(0, lastBrace + 1);
    }
  }

  // Strategy 3: JSON embedded in prose — first balanced object.
  const firstOpen = trimmed.indexOf("{");
  if (firstOpen !== -1) {
    const balanced = extractBalancedObject(trimmed, firstOpen);
    if (balanced) return balanced;

    // Strategy 4: last-resort slice from first { to last }.
    const lastClose = trimmed.lastIndexOf("}");
    if (lastClose > firstOpen) return trimmed.slice(firstOpen, lastClose + 1);
  }

  return null;
}

function coerceString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function coerceDeepDive(v: unknown): DeepDiveItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((it): it is { term?: unknown; explanation?: unknown } => typeof it === "object" && it !== null)
    .map((it) => ({
      term: coerceString(it.term),
      explanation: coerceString(it.explanation),
    }))
    .filter((it) => it.term.length > 0);
}

function parseResponse(rawText: string): ExplanationResult | null {
  const json = extractJson(rawText);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const risk = coerceString(parsed.risk) as RiskLevel;
    if (!["none", "low", "medium", "high"].includes(risk)) return null;
    return {
      impact: coerceString(parsed.impact),
      howItWorks: coerceString(parsed.howItWorks),
      why: coerceString(parsed.why),
      deepDive: coerceDeepDive(parsed.deepDive),
      isSamePattern: parsed.isSamePattern === true,
      samePatternNote: coerceString(parsed.samePatternNote),
      risk,
      riskReason: coerceString(parsed.riskReason),
    };
  } catch {
    return null;
  }
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
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
  const prompt = buildClaudePrompt(inputs.config.detailLevel, {
    filePath: inputs.filePath,
    diff: inputs.diff,
    userPrompt: inputs.userPrompt,
    language: inputs.config.language,
    learnerLevel: inputs.config.learnerLevel,
    recentSummaries: inputs.recentSummaries,
  });

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
