import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Engine = "ollama" | "claude";
export type DetailLevel = "minimal" | "standard" | "verbose";
export type RiskLevel = "none" | "low" | "medium" | "high";

export type Language =
  | "en"
  | "pt"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "zh"
  | "ja"
  | "ko";

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  pt: "Portuguese",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
};

export type LearnerLevel = "none" | "beginner" | "intermediate" | "regular";

export const LEARNER_LEVEL_NAMES: Record<LearnerLevel, string> = {
  none: "Never programmed",
  beginner: "Just starting out",
  intermediate: "Read code with difficulty",
  regular: "Code regularly",
};

export interface HooksConfig {
  edit: boolean;
  write: boolean;
  bash: boolean;
}

export interface BashFilterConfig {
  capturePatterns: string[];
}

export interface Config {
  engine: Engine;
  ollamaModel: string;
  ollamaUrl: string;
  detailLevel: DetailLevel;
  language: Language;
  learnerLevel: LearnerLevel;
  hooks: HooksConfig;
  exclude: string[];
  skipIfSlowMs: number;
  bashFilter: BashFilterConfig;
}

export interface DeepDiveItem {
  term: string;
  explanation: string;
}

export interface ExplanationResult {
  impact: string;
  howItWorks: string;
  why: string;
  deepDive: DeepDiveItem[];
  isSamePattern: boolean;
  samePatternNote: string;
  risk: RiskLevel;
  riskReason: string;
}

export interface HookPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  // Claude Code sends this as an object for Edit/Write/MultiEdit and a string
  // for Bash; type it as unknown so consumers validate before use.
  tool_response: unknown;
}

export const CONFIG_FILENAME = "code-explainer.config.json";

export function getGlobalConfigPath(): string {
  return join(homedir(), ".code-explainer.config.json");
}

export const DEFAULT_CONFIG: Config = {
  engine: "ollama",
  ollamaModel: "qwen3.5:4b",
  ollamaUrl: "http://localhost:11434",
  detailLevel: "standard",
  language: "en",
  learnerLevel: "intermediate",
  hooks: {
    edit: true,
    write: true,
    bash: true,
  },
  exclude: ["*.lock", "dist/**", "node_modules/**"],
  skipIfSlowMs: 30000,
  bashFilter: {
    capturePatterns: [
      "rm",
      "mv",
      "cp",
      "mkdir",
      "npm install",
      "pip install",
      "yarn add",
      "pnpm add",
      "chmod",
      "chown",
      "git checkout",
      "git reset",
      "git revert",
      "sed -i",
    ],
  },
};

function mergeConfig(base: Config, overlay: Partial<Config>): Config {
  return {
    ...base,
    ...overlay,
    hooks: { ...base.hooks, ...(overlay.hooks ?? {}) },
    bashFilter: {
      ...base.bashFilter,
      ...(overlay.bashFilter ?? {}),
    },
  };
}

function tryReadJson(path: string): Partial<Config> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Partial<Config>;
  } catch {
    return null;
  }
}

/**
 * Load config with three-level resolution, most specific first:
 *   1. Project config (passed as configPath) — overrides everything
 *   2. Global user config (~/.code-explainer.config.json)
 *   3. Built-in defaults
 *
 * A project config that lacks a field falls through to the global; a global
 * that lacks a field falls through to defaults. This lets a global install
 * set everyone's defaults while still allowing per-project overrides.
 */
export function loadConfig(configPath: string): Config {
  const globalConfig = tryReadJson(getGlobalConfigPath());
  const projectConfig = tryReadJson(configPath);

  let result = DEFAULT_CONFIG;
  if (globalConfig) result = mergeConfig(result, globalConfig);
  if (projectConfig) result = mergeConfig(result, projectConfig);
  return result;
}
