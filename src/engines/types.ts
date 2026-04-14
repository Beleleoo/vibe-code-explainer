import type { ExplanationResult } from "../config/schema.js";

/**
 * Shared outcome envelope for every engine. Both ollama and claude engines
 * (and any future engine) must produce this exact shape so the box formatter
 * doesn't need to know which engine ran.
 */
export type EngineOutcome =
  | { kind: "ok"; result: ExplanationResult }
  | { kind: "skip"; reason: string; detail?: string }
  | { kind: "error"; problem: string; cause: string; fix: string };
