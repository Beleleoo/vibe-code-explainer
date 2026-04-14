import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Zod schema — used to validate and parse config files at load time.
// Using z.coerce where sensible so that older config files with slightly
// different types (e.g., skipIfSlowMs stored as a string) still work.
// ---------------------------------------------------------------------------

const EngineSchema = z.enum(["ollama", "claude"]);
const DetailLevelSchema = z.enum(["minimal", "standard", "verbose"]);
const LanguageSchema = z.enum(["en", "pt", "es", "fr", "de", "it", "zh", "ja", "ko"]);
const LearnerLevelSchema = z.enum(["none", "beginner", "intermediate", "regular"]);

const HooksConfigSchema = z.object({
  edit: z.boolean().default(true),
  write: z.boolean().default(true),
  bash: z.boolean().default(true),
}).default({});

const BashFilterConfigSchema = z.object({
  capturePatterns: z.array(z.string()).default([]),
}).default({});

export const ConfigSchema = z.object({
  engine: EngineSchema.default("ollama"),
  ollamaModel: z.string().min(1).default("qwen3.5:4b"),
  ollamaUrl: z.string().url().default("http://localhost:11434"),
  detailLevel: DetailLevelSchema.default("standard"),
  language: LanguageSchema.default("en"),
  learnerLevel: LearnerLevelSchema.default("intermediate"),
  hooks: HooksConfigSchema,
  exclude: z.array(z.string()).default(["*.lock", "dist/**", "node_modules/**"]),
  skipIfSlowMs: z.coerce.number().int().min(0).default(30000),
  bashFilter: BashFilterConfigSchema,
});

export type ConfigInput = z.input<typeof ConfigSchema>;

/**
 * Validate a raw JSON object against the config schema.
 * Returns a typed Config on success, or throws a ZodError-derived Error with
 * a human-readable message listing all invalid fields.
 */
export function validateConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
  throw new Error(`[code-explainer] Invalid config:\n${issues}`);
}

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

/**
 * Read and parse a config file. Returns the partial config or null if the
 * file is missing. Throws if the JSON is malformed or fails schema validation
 * (so callers surface useful errors rather than silently using defaults).
 */
function tryReadJson(path: string): Partial<Config> | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[code-explainer] Config file ${path} is not valid JSON: ${msg}`);
  }
  // Partial validation: only validate keys that are present. Unknown keys are
  // ignored (forward-compat). We re-use ConfigSchema with .partial() so that
  // missing keys fall through to the DEFAULT_CONFIG merger rather than errors.
  const partial = ConfigSchema.partial().safeParse(raw);
  if (!partial.success) {
    const issues = partial.error.issues
      .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`[code-explainer] Invalid config in ${path}:\n${issues}`);
  }
  return partial.data as Partial<Config>;
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
