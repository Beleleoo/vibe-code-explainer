import type { Config } from "../config/schema.js";
import { buildOllamaSystemPrompt, buildOllamaUserPrompt } from "../prompts/templates.js";
import type { EngineOutcome } from "./types.js";
import { parseResponse, truncateText } from "./parse.js";

export type { EngineOutcome };

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

  // Prompt builders read config enums — guard so an unexpected detail/learner
  // value cannot crash the engine (top-level main() would swallow silently
  // with no user-visible skip notice, so we surface a structured error here).
  let systemPrompt: string;
  let userPrompt: string;
  try {
    systemPrompt = buildOllamaSystemPrompt(
      config.detailLevel,
      config.language,
      config.learnerLevel
    );
    userPrompt = buildOllamaUserPrompt({
      filePath: inputs.filePath,
      diff: inputs.diff,
      recentSummaries: inputs.recentSummaries,
    });
  } catch (err) {
    return {
      kind: "error",
      problem: "Failed to build Ollama prompt",
      cause: (err as Error).message || String(err),
      fix: "Check detailLevel/learnerLevel/language values via 'npx vibe-code-explainer config'",
    };
  }

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
    // model to output only JSON; parse.ts handles JSON wrapped in code
    // fences or embedded in prose, and we fall back to placing raw text
    // in the `impact` field if parsing fails.
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

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (timeout !== null) clearTimeout(timeout);
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

    // Keep the AbortSignal active across the body read. If Ollama starts
    // streaming headers then stalls mid-body, the controller will still abort.
    const data = await response.json() as { response?: string };
    if (timeout !== null) clearTimeout(timeout);
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

export type WarmupResult =
  | { kind: "ok" }
  | { kind: "skip"; reason: string }
  | { kind: "error"; problem: string; cause: string; fix: string };

/**
 * Engine-agnostic warmup helper. Callers (init wizard, CLI `warmup`
 * subcommand) format their own output — this helper just runs the
 * warmup and returns a structured result so we don't have two divergent
 * spinner/stderr implementations.
 */
export async function runWarmup(config: Config): Promise<WarmupResult> {
  const outcome = await callOllama({
    filePath: "warmup.txt",
    diff: "+ hello world",
    config: { ...config, skipIfSlowMs: 60000 },
  });

  if (outcome.kind === "ok") return { kind: "ok" };
  if (outcome.kind === "error") {
    return {
      kind: "error",
      problem: outcome.problem,
      cause: outcome.cause,
      fix: outcome.fix,
    };
  }
  return { kind: "skip", reason: outcome.reason };
}
