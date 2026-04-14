import type {
  DeepDiveItem,
  ExplanationResult,
  RiskLevel,
} from "../config/schema.js";

/**
 * Shared engine response parser. Both Ollama and Claude engines produce the
 * same `{impact, howItWorks, why, deepDive, isSamePattern, samePatternNote,
 * risk, riskReason}` JSON envelope, so the parse logic MUST live in one
 * place — otherwise the two engines will drift on malformed-JSON recovery,
 * risk coercion, or fence handling.
 */

/**
 * Walk from startIdx forward, tracking `{`/`}` depth while respecting string
 * literals (so braces inside string values don't count). Returns the first
 * balanced object, or null if never balanced.
 */
export function extractBalancedObject(text: string, startIdx: number): string | null {
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

/**
 * Pull a JSON object candidate out of raw model output, tolerating prose
 * preamble, code fences, and unterminated fences that small 4B–7B models
 * sometimes emit.
 */
export function extractJson(text: string): string | null {
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
      const lastBrace = innerTrimmed.lastIndexOf("}");
      if (lastBrace !== -1) {
        return innerTrimmed.slice(0, lastBrace + 1);
      }
    }
  }

  // Strategy 3: JSON embedded in prose — first balanced object.
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

export function coerceString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function coerceDeepDive(v: unknown): DeepDiveItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((it): it is { term?: unknown; explanation?: unknown } =>
      typeof it === "object" && it !== null
    )
    .map((it) => ({
      term: coerceString(it.term),
      explanation: coerceString(it.explanation),
    }))
    .filter((it) => it.term.length > 0);
}

/**
 * Coerce unknown risk values to "none" instead of discarding the entire
 * parsed result. A model emitting `"risk": "critical"` (plausible for 4B
 * hallucinations) would otherwise throw away the successfully-parsed
 * impact/howItWorks/why/deepDive content and fall back to raw text —
 * strictly worse UX than showing the content with a safe default risk.
 */
export function coerceRisk(v: unknown): RiskLevel {
  const s = coerceString(v);
  return s === "low" || s === "medium" || s === "high" ? s : "none";
}

export function parseResponse(rawText: string): ExplanationResult | null {
  const json = extractJson(rawText);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      impact: coerceString(parsed.impact),
      howItWorks: coerceString(parsed.howItWorks),
      why: coerceString(parsed.why),
      deepDive: coerceDeepDive(parsed.deepDive),
      isSamePattern: parsed.isSamePattern === true,
      samePatternNote: coerceString(parsed.samePatternNote),
      risk: coerceRisk(parsed.risk),
      riskReason: coerceString(parsed.riskReason),
    };
  } catch {
    return null;
  }
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
