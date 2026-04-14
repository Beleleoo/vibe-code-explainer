import type {
  Config,
  DeepDiveItem,
  ExplanationResult,
  RiskLevel,
} from "../config/schema.js";
import { buildOllamaSystemPrompt, buildOllamaUserPrompt } from "../prompts/templates.js";

export type EngineOutcome =
  | { kind: "ok"; result: ExplanationResult }
  | { kind: "skip"; reason: string; detail?: string }
  | { kind: "error"; problem: string; cause: string; fix: string };

export interface OllamaCallInputs {
  filePath: string;
  diff: string;
  config: Config;
  recentSummaries?: string[];
}

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // Strategy 1: already a raw JSON object.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  // Strategy 2: fenced — ```json ... ``` (possibly missing closing ```).
  const fenceOpenMatch = trimmed.match(/```(?:json)?\s*\n?/);
  if (fenceOpenMatch) {
    const afterOpen = trimmed.slice(fenceOpenMatch.index! + fenceOpenMatch[0].length);
    const closingIdx = afterOpen.indexOf("```");
    const inner = closingIdx !== -1 ? afterOpen.slice(0, closingIdx) : afterOpen;
    const innerTrimmed = inner.trim();
    if (innerTrimmed.startsWith("{")) {
      // Slice from first { to the matching brace at the end of the candidate.
      const lastBrace = innerTrimmed.lastIndexOf("}");
      if (lastBrace !== -1) {
        return innerTrimmed.slice(0, lastBrace + 1);
      }
    }
  }

  // Strategy 3: JSON embedded in prose. Find the first balanced { ... }.
  const firstOpen = trimmed.indexOf("{");
  if (firstOpen !== -1) {
    const balanced = extractBalancedObject(trimmed, firstOpen);
    if (balanced) return balanced;

    // Strategy 4 (last resort): slice from first { to last }.
    const lastClose = trimmed.lastIndexOf("}");
    if (lastClose > firstOpen) {
      return trimmed.slice(firstOpen, lastClose + 1);
    }
  }

  return null;
}

/**
 * Walk from startIdx forward, tracking {/} depth while respecting string
 * literals (so braces inside string values don't count). Returns the first
 * balanced object, or null if never balanced.
 */
function extractBalancedObject(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
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

export function parseResponse(rawText: string): ExplanationResult | null {
  const json = extractJson(rawText);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const risk = coerceString(parsed.risk) as RiskLevel;
    if (!["none", "low", "medium", "high"].includes(risk)) {
      return null;
    }
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

export async function callOllama(inputs: OllamaCallInputs): Promise<EngineOutcome> {
  const { config } = inputs;

  if (!isLoopback(config.ollamaUrl)) {
    return {
      kind: "error",
      problem: "Ollama endpoint is not local",
      cause: `The configured URL ${config.ollamaUrl} is not a loopback address, which could send your code to a remote server`,
      fix: "Change ollamaUrl to http://localhost:11434 via 'npx vibe-code-explainer config'",
    };
  }

  const systemPrompt = buildOllamaSystemPrompt(
    config.detailLevel,
    config.language,
    config.learnerLevel
  );
  const userPrompt = buildOllamaUserPrompt({
    filePath: inputs.filePath,
    diff: inputs.diff,
    recentSummaries: inputs.recentSummaries,
  });

  const controller = new AbortController();
  // skipIfSlowMs of 0 means "never skip" — don't set a timeout at all.
  const timeout =
    config.skipIfSlowMs > 0
      ? setTimeout(() => controller.abort(), config.skipIfSlowMs)
      : null;

  try {
    // NOTE: we intentionally do NOT send `format: "json"` to Ollama.
    // Ollama's JSON-format mode returns an EMPTY response when the model
    // can't produce JSON matching the complex schema we ask for — which
    // happens often with 4B–7B models and our 8-field schema (including
    // nested deepDive array). The system prompt already instructs the
    // model to output only JSON; our extractJson()/parseResponse() logic
    // handles JSON wrapped in code fences or embedded in prose, and falls
    // back to placing raw text in the `impact` field if parsing fails.
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (timeout !== null) clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404 || /model.*not found/i.test(text)) {
        return {
          kind: "error",
          problem: `Ollama model '${config.ollamaModel}' not found`,
          cause: "The configured model has not been pulled yet",
          fix: `Run 'ollama pull ${config.ollamaModel}' or re-run 'npx vibe-code-explainer init' to re-select a model`,
        };
      }
      return {
        kind: "error",
        problem: "Ollama request failed",
        cause: `HTTP ${response.status} ${response.statusText}`,
        fix: "Check that Ollama is running correctly ('ollama serve')",
      };
    }

    const data = await response.json() as { response?: string };
    const rawText = data.response ?? "";

    if (!rawText.trim()) {
      return { kind: "skip", reason: "Ollama returned an empty response" };
    }

    const parsed = parseResponse(rawText);
    if (parsed) {
      return { kind: "ok", result: parsed };
    }

    // Malformed JSON: fall back to truncated raw text as the impact field.
    return {
      kind: "ok",
      result: {
        impact: truncateText(rawText.trim(), 200),
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
    if (timeout !== null) clearTimeout(timeout);
    const error = err as Error & { code?: string; cause?: { code?: string } };
    const causeCode = error.cause?.code;
    const msg = error.message || String(error);

    if (error.name === "AbortError") {
      return {
        kind: "skip",
        reason: `explanation took too long (>${config.skipIfSlowMs}ms)`,
      };
    }
    if (error.code === "ECONNREFUSED" || causeCode === "ECONNREFUSED" || /ECONNREFUSED/.test(msg)) {
      return {
        kind: "error",
        problem: "Cannot reach Ollama",
        cause: "The Ollama service is not running or the URL is wrong",
        fix: "Run 'ollama serve' in a separate terminal, or change ollamaUrl via 'npx vibe-code-explainer config'",
      };
    }
    return {
      kind: "error",
      problem: "Ollama request failed unexpectedly",
      cause: msg,
      fix: "Check that Ollama is running and the configured URL is correct",
    };
  }
}

export async function runWarmup(): Promise<void> {
  const { loadConfig, DEFAULT_CONFIG } = await import("../config/schema.js");
  const config = (() => {
    try {
      return loadConfig("code-explainer.config.json");
    } catch {
      return DEFAULT_CONFIG;
    }
  })();

  process.stderr.write(`[code-explainer] Warming up ${config.ollamaModel}...\n`);
  const outcome = await callOllama({
    filePath: "warmup.txt",
    diff: "+ hello world",
    config: { ...config, skipIfSlowMs: 60000 },
  });

  if (outcome.kind === "ok") {
    process.stderr.write("[code-explainer] Warmup complete. First real explanation will be fast.\n");
  } else if (outcome.kind === "error") {
    process.stderr.write(`[code-explainer] Warmup failed. ${outcome.problem}. ${outcome.cause}. Fix: ${outcome.fix}.\n`);
    process.exit(1);
  } else {
    process.stderr.write(`[code-explainer] Warmup skipped: ${outcome.reason}\n`);
  }
}
