import { intro, outro, select, confirm, text, cancel, isCancel, note } from "@clack/prompts";
import pc from "picocolors";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  loadConfig,
  LANGUAGE_NAMES,
  LEARNER_LEVEL_NAMES,
  CONFIG_FILENAME,
  getGlobalConfigPath,
  type Config,
  type Engine,
  type DetailLevel,
  type Language,
  type LearnerLevel,
} from "../config/schema.js";
import { MODEL_OPTIONS } from "../detect/vram.js";

interface OllamaTagResponse {
  models?: Array<{ name?: string; model?: string }>;
}

async function listInstalledOllamaModels(url: string): Promise<string[] | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as OllamaTagResponse;
    if (!data.models) return [];
    return data.models
      .map((m) => m.name ?? m.model ?? "")
      .filter((n) => n.length > 0);
  } catch {
    return null;
  }
}

function normalizeModelName(name: string): string {
  // Ollama sometimes returns tags as "qwen3.5:9b" and sometimes as
  // "qwen3.5:9b-q4_K_M". Compare on the base "<model>:<tag>" prefix.
  return name.toLowerCase().split(/[-_]/)[0];
}

function hasModel(installed: string[], wanted: string): boolean {
  const wantedNorm = normalizeModelName(wanted);
  const wantedLower = wanted.toLowerCase();
  return installed.some((n) => {
    const base = n.toLowerCase();
    if (base === wantedLower) return true;
    // Looser match for variant tags (e.g. "qwen3.5:9b-q4_K_M" matches "qwen3.5")
    return normalizeModelName(base).startsWith(wantedNorm);
  });
}

async function pullOllamaModel(model: string): Promise<boolean> {
  note(
    `Pulling ${pc.cyan(model)}\n${pc.dim("This can take a while on the first run (several GB download).")}`,
    "Downloading model"
  );
  return new Promise((resolvePromise) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit" });
    child.on("error", () => {
      process.stderr.write(
        pc.red("\nFailed to run `ollama pull`. Make sure Ollama is installed and running.\n")
      );
      resolvePromise(false);
    });
    child.on("close", (code) => {
      if (code === 0) {
        process.stdout.write(pc.green(`\n\u2713 Pulled ${model}\n`));
        resolvePromise(true);
      } else {
        process.stderr.write(pc.red(`\n\u2717 ollama pull exited with code ${code}\n`));
        resolvePromise(false);
      }
    });
  });
}


function handleCancel<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Exited without saving.");
    process.exit(0);
  }
}

function renderCurrent(config: Config): string {
  const hooks: string[] = [];
  if (config.hooks.edit) hooks.push("Edit");
  if (config.hooks.write) hooks.push("Write");
  if (config.hooks.bash) hooks.push("Bash");

  const excluded = config.exclude.length > 0 ? config.exclude.join(", ") : "(none)";
  const timeoutLabel =
    config.skipIfSlowMs === 0 ? "Never skip" : `${Math.round(config.skipIfSlowMs / 1000)}s`;

  return [
    `${pc.bold("Engine:       ")} ${config.engine === "ollama" ? "Local LLM (Ollama)" : "Claude Code (native)"}`,
    `${pc.bold("Model:        ")} ${config.ollamaModel}`,
    `${pc.bold("Ollama URL:   ")} ${config.ollamaUrl}`,
    `${pc.bold("Detail level: ")} ${config.detailLevel}`,
    `${pc.bold("Language:     ")} ${LANGUAGE_NAMES[config.language]}`,
    `${pc.bold("Learner level:")} ${LEARNER_LEVEL_NAMES[config.learnerLevel]}`,
    `${pc.bold("Hooks:        ")} ${hooks.join(" \u2713  ") || "(all disabled)"}`,
    `${pc.bold("Excluded:     ")} ${excluded}`,
    `${pc.bold("Skip if slow: ")} ${timeoutLabel}`,
  ].join("\n");
}

type MenuChoice =
  | "engine"
  | "model"
  | "url"
  | "detail"
  | "language"
  | "level"
  | "hooks"
  | "exclude"
  | "timeout"
  | "back";

async function changeEngine(config: Config): Promise<Config> {
  const value = await select<Engine>({
    message: "Explanation engine",
    options: [
      { label: "Local LLM (Ollama)", value: "ollama", hint: "free, private, works offline" },
      { label: "Claude Code (native)", value: "claude", hint: "best quality, uses API tokens" },
    ],
    initialValue: config.engine,
  });
  handleCancel(value);
  return { ...config, engine: value };
}

async function changeModel(config: Config): Promise<Config> {
  const value = await select({
    message: "Ollama model",
    options: MODEL_OPTIONS.map((m) => ({
      label: m.label,
      value: m.model,
      hint: m.hint,
    })),
    initialValue: config.ollamaModel,
  });
  handleCancel(value);

  if (value === config.ollamaModel) {
    // Nothing actually changed; skip the download check.
    return config;
  }

  // Check whether Ollama already has the model pulled. If not, offer to pull it.
  const installed = await listInstalledOllamaModels(config.ollamaUrl);
  if (installed === null) {
    note(
      `Could not reach Ollama at ${pc.cyan(config.ollamaUrl)}. The model will be selected, but you'll need to pull it manually with ${pc.cyan(`ollama pull ${value}`)} before the first explanation.`,
      "Ollama unreachable"
    );
    return { ...config, ollamaModel: value };
  }

  if (hasModel(installed, value)) {
    note(`${pc.green("\u2713")} Model ${pc.cyan(value)} is already installed.`, "Model ready");
    return { ...config, ollamaModel: value };
  }

  const shouldPull = await confirm({
    message: `Model ${value} is not installed locally. Pull it now?`,
    initialValue: true,
  });
  handleCancel(shouldPull);

  if (!shouldPull) {
    note(
      `Saved the selection, but you must run ${pc.cyan(`ollama pull ${value}`)} before it works.`,
      "Model not pulled"
    );
    return { ...config, ollamaModel: value };
  }

  const pullOk = await pullOllamaModel(value);
  if (!pullOk) {
    note(
      `Pull failed. Saving the model selection anyway — run ${pc.cyan(`ollama pull ${value}`)} manually when Ollama is reachable.`,
      "Pull failed"
    );
  }
  return { ...config, ollamaModel: value };
}

async function changeUrl(config: Config): Promise<Config> {
  const value = await text({
    message: "Ollama endpoint URL",
    initialValue: config.ollamaUrl,
    validate(v) {
      try {
        new URL(v);
        return;
      } catch {
        return "Must be a valid URL (e.g., http://localhost:11434)";
      }
    },
  });
  handleCancel(value);
  return { ...config, ollamaUrl: value };
}

async function changeDetail(config: Config): Promise<Config> {
  const value = await select<DetailLevel>({
    message: "Detail level",
    options: [
      { label: "Standard", value: "standard", hint: "1-2 sentence explanation per change (recommended)" },
      { label: "Minimal", value: "minimal", hint: "one short sentence per change" },
      { label: "Verbose", value: "verbose", hint: "detailed bullet-point breakdown" },
    ],
    initialValue: config.detailLevel,
  });
  handleCancel(value);
  return { ...config, detailLevel: value };
}

async function changeLanguage(config: Config): Promise<Config> {
  const value = await select<Language>({
    message: "Language for explanations",
    options: (Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => ({
      label: LANGUAGE_NAMES[code],
      value: code,
      hint: code === "en" ? "default" : undefined,
    })),
    initialValue: config.language,
  });
  handleCancel(value);
  return { ...config, language: value };
}

async function changeLevel(config: Config): Promise<Config> {
  const value = await select<LearnerLevel>({
    message: "Programming knowledge level",
    options: (Object.keys(LEARNER_LEVEL_NAMES) as LearnerLevel[]).map((code) => ({
      label: LEARNER_LEVEL_NAMES[code],
      value: code,
      hint: code === "intermediate" ? "default" : undefined,
    })),
    initialValue: config.learnerLevel,
  });
  handleCancel(value);
  return { ...config, learnerLevel: value };
}

async function changeHooks(config: Config): Promise<Config> {
  const editOn = await confirm({ message: "Explain file edits?", initialValue: config.hooks.edit });
  handleCancel(editOn);
  const writeOn = await confirm({ message: "Explain new files?", initialValue: config.hooks.write });
  handleCancel(writeOn);
  const bashOn = await confirm({
    message: "Explain destructive Bash commands (rm, git reset, etc.)?",
    initialValue: config.hooks.bash,
  });
  handleCancel(bashOn);

  return {
    ...config,
    hooks: { edit: editOn, write: writeOn, bash: bashOn },
  };
}

async function changeExclude(config: Config): Promise<Config> {
  const action = await select({
    message: `Current exclusions: ${config.exclude.join(", ") || "(none)"}`,
    options: [
      { label: "Add a pattern", value: "add", hint: "e.g., *.generated.*" },
      { label: "Remove a pattern", value: "remove" },
      { label: "Reset to defaults", value: "reset", hint: DEFAULT_CONFIG.exclude.join(", ") },
      { label: "Back", value: "back" },
    ],
  });
  handleCancel(action);

  if (action === "back") return config;
  if (action === "reset") return { ...config, exclude: [...DEFAULT_CONFIG.exclude] };

  if (action === "add") {
    const pattern = await text({ message: "Glob pattern to exclude (e.g., *.generated.*)" });
    handleCancel(pattern);
    if (!pattern.trim()) return config;
    const exclude = Array.from(new Set([...config.exclude, pattern.trim()]));
    return { ...config, exclude };
  }

  if (action === "remove") {
    if (config.exclude.length === 0) {
      note("No exclusions to remove.", "Exclusions");
      return config;
    }
    const target = await select({
      message: "Which pattern to remove?",
      options: config.exclude.map((p) => ({ label: p, value: p })),
    });
    handleCancel(target);
    const exclude = config.exclude.filter((p) => p !== target);
    return { ...config, exclude };
  }

  return config;
}

async function changeTimeout(config: Config): Promise<Config> {
  const value = await select<number>({
    message: "Skip explanation if it takes longer than...",
    options: [
      { label: "5 seconds", value: 5000, hint: "fast, may skip complex changes" },
      { label: "8 seconds", value: 8000, hint: "balanced (recommended)" },
      { label: "15 seconds", value: 15000, hint: "patient, rarely skips" },
      { label: "Never skip", value: 0, hint: "always wait for the explanation" },
    ],
    initialValue: config.skipIfSlowMs,
  });
  handleCancel(value);
  return { ...config, skipIfSlowMs: value };
}

export async function runConfig(): Promise<void> {
  // Prefer project config if present; otherwise edit the global config.
  const projectPath = join(process.cwd(), CONFIG_FILENAME);
  const globalPath = getGlobalConfigPath();

  let configPath: string;
  let scope: "project" | "global";
  if (existsSync(projectPath)) {
    configPath = projectPath;
    scope = "project";
  } else if (existsSync(globalPath)) {
    configPath = globalPath;
    scope = "global";
  } else {
    intro(pc.bold("code-explainer config"));
    cancel(
      `No config file found.\nSearched: ${pc.cyan(projectPath)}\n         ${pc.cyan(globalPath)}\nRun ${pc.cyan("npx vibe-code-explainer init")} first.`
    );
    process.exit(1);
  }

  intro(pc.bold(`code-explainer config (${scope})`));

  let config = loadConfig(configPath);

  while (true) {
    note(renderCurrent(config), "Current settings");

    const choice = await select<MenuChoice>({
      message: "What would you like to change?",
      options: [
        { label: "Engine", value: "engine" },
        { label: "Model", value: "model" },
        { label: "Ollama URL", value: "url" },
        { label: "Detail level", value: "detail" },
        { label: "Language", value: "language" },
        { label: "Learner level", value: "level" },
        { label: "Enable/disable hooks", value: "hooks" },
        { label: "File exclusions", value: "exclude" },
        { label: "Latency timeout", value: "timeout" },
        { label: "Back (save and exit)", value: "back" },
      ],
    });
    handleCancel(choice);

    if (choice === "back") break;
    if (choice === "engine") config = await changeEngine(config);
    if (choice === "model") config = await changeModel(config);
    if (choice === "url") config = await changeUrl(config);
    if (choice === "detail") config = await changeDetail(config);
    if (choice === "language") config = await changeLanguage(config);
    if (choice === "level") config = await changeLevel(config);
    if (choice === "hooks") config = await changeHooks(config);
    if (choice === "exclude") config = await changeExclude(config);
    if (choice === "timeout") config = await changeTimeout(config);

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  outro(pc.green("Settings saved."));
}
