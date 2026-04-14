import { intro, outro, select, confirm, cancel, isCancel, spinner, note } from "@clack/prompts";
import pc from "picocolors";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
  getGlobalConfigPath,
  LANGUAGE_NAMES,
  LEARNER_LEVEL_NAMES,
  type Config,
  type Engine,
  type DetailLevel,
  type Language,
  type LearnerLevel,
} from "../config/schema.js";
import { detectPlatform, ollamaInstallCommand } from "../detect/platform.js";
import { detectNvidiaVram, pickModelForVram, MODEL_OPTIONS } from "../detect/vram.js";
import { mergeHooksIntoSettings, mergeHooksIntoUserSettings } from "../config/merge.js";
import { callOllama } from "../engines/ollama.js";

type InstallScope = "project" | "global";

function isInsideNpxCache(path: string): boolean {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  return norm.includes("/_npx/") || norm.includes("/.npm/_npx/");
}

function isInsideGlobalNpmRoot(path: string): boolean {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  return norm.includes("/node_modules/vibe-code-explainer/") &&
    (norm.includes("/npm/") || norm.includes("/npm-global/") || norm.includes("/appdata/roaming/npm/") || norm.includes("/.nvm/"));
}

async function runNpmInstall(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("npm", args, {
      stdio: "inherit",
      cwd,
      shell: process.platform === "win32",
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`npm install exited with code ${code}`));
    });
  });
}

function resolveGlobalHookScriptPath(): string | null {
  // Find the global npm root and build the hook path.
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      shell: process.platform === "win32",
    }).trim();
    return join(root, "vibe-code-explainer", "dist", "hooks", "post-tool.js");
  } catch {
    return null;
  }
}

async function ensureProjectInstall(projectRoot: string): Promise<string> {
  const thisFile = fileURLToPath(import.meta.url);

  if (!isInsideNpxCache(thisFile)) {
    const distDir = resolve(thisFile, "..");
    return join(distDir, "hooks", "post-tool.js");
  }

  note(
    "Installing vibe-code-explainer as a dev dependency so the hook path is stable...",
    "Local install"
  );

  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      JSON.stringify({ name: basename(projectRoot), private: true, version: "0.0.0" }, null, 2) + "\n"
    );
  }

  await runNpmInstall(["install", "--save-dev", "vibe-code-explainer"], projectRoot);
  return join(projectRoot, "node_modules", "vibe-code-explainer", "dist", "hooks", "post-tool.js");
}

async function ensureGlobalInstall(): Promise<string> {
  const thisFile = fileURLToPath(import.meta.url);
  if (isInsideGlobalNpmRoot(thisFile)) {
    const distDir = resolve(thisFile, "..");
    return join(distDir, "hooks", "post-tool.js");
  }

  note(
    "Installing vibe-code-explainer globally so every project picks it up...",
    "Global install"
  );

  await runNpmInstall(["install", "-g", "vibe-code-explainer"], process.cwd());

  const resolved = resolveGlobalHookScriptPath();
  if (!resolved) {
    throw new Error(
      "Global install completed but 'npm root -g' failed. Run 'npm root -g' manually to locate the install path and file an issue."
    );
  }
  return resolved;
}

async function checkOllama(): Promise<"running" | "installed-not-running" | "missing"> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("http://localhost:11434/api/tags", { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return "running";
  } catch {
    // fall through
  }

  try {
    execFileSync("ollama", ["--version"], { stdio: "ignore" });
    return "installed-not-running";
  } catch {
    return "missing";
  }
}

async function pullModel(model: string): Promise<boolean> {
  note(
    `Pulling ${pc.cyan(model)}\n${pc.dim("This can take a while on the first run (several GB download).")}`,
    "Downloading model"
  );

  return new Promise((resolvePromise) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit" });
    child.on("error", () => {
      process.stderr.write(pc.red("\nFailed to run `ollama pull`. Make sure Ollama is running.\n"));
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

async function runWarmup(config: Config): Promise<void> {
  const s = spinner();
  s.start(`Warming up ${config.ollamaModel}`);

  const outcome = await callOllama({
    filePath: "warmup.txt",
    diff: "+ hello world",
    config: { ...config, skipIfSlowMs: 60000 },
  });

  if (outcome.kind === "ok") {
    s.stop("Warmup complete. First real explanation will be fast.");
  } else if (outcome.kind === "error") {
    s.stop(`Warmup failed: ${outcome.problem}`);
  } else {
    s.stop(`Warmup skipped: ${outcome.reason}`);
  }
}

async function pickModel(): Promise<string | symbol> {
  const vram = detectNvidiaVram();
  if (vram) {
    const recommended = pickModelForVram(vram.totalMb);
    note(
      `Detected ${pc.green(vram.gpuName)} with ${pc.green(`${Math.round(vram.totalMb / 1024)} GB VRAM`)}.\nRecommended model: ${pc.cyan(recommended)}`,
      "GPU detection"
    );
    return recommended;
  }

  note("No NVIDIA GPU detected (or nvidia-smi unavailable). Pick a model that fits your machine.", "GPU detection");
  const choice = await select({
    message: "Which model should code-explainer use?",
    options: MODEL_OPTIONS.map((m) => ({
      label: m.label,
      value: m.model,
      hint: m.hint,
    })),
    initialValue: "qwen3.5:4b",
  });
  return choice;
}

function handleCancel<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

export async function runInit(args: string[]): Promise<void> {
  const skipWarmup = args.includes("--skip-warmup");

  intro(pc.bold("code-explainer setup"));

  // Step 1: Install scope — project or global
  const scope = await select<InstallScope>({
    message: "Where should code-explainer be installed?",
    options: [
      {
        label: "This project only",
        value: "project",
        hint: "Hooks in .claude/settings.local.json, config in this folder",
      },
      {
        label: "Globally (every project)",
        value: "global",
        hint: "Hooks in ~/.claude/settings.json, config in ~/.code-explainer.config.json",
      },
    ],
    initialValue: "project",
  });
  handleCancel(scope);

  // Step 2: Engine
  const engineChoice = await select<Engine>({
    message: "Which explanation engine do you want to use?",
    options: [
      { label: "Local LLM (Ollama)", value: "ollama", hint: "free, private, works offline" },
      { label: "Claude Code (native)", value: "claude", hint: "best quality, uses API tokens" },
    ],
    initialValue: "ollama",
  });
  handleCancel(engineChoice);

  // Step 3: Detail level
  const detailChoice = await select<DetailLevel>({
    message: "How detailed should explanations be?",
    options: [
      { label: "Standard", value: "standard", hint: "1-2 sentence explanation per change (recommended)" },
      { label: "Minimal", value: "minimal", hint: "one short sentence per change" },
      { label: "Verbose", value: "verbose", hint: "detailed bullet-point breakdown" },
    ],
    initialValue: "standard",
  });
  handleCancel(detailChoice);

  // Step 4: Language
  const languageChoice = await select<Language>({
    message: "What language should explanations be written in?",
    options: (Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => ({
      label: LANGUAGE_NAMES[code],
      value: code,
      hint: code === "en" ? "default" : undefined,
    })),
    initialValue: "en",
  });
  handleCancel(languageChoice);

  // Step 5: Learner level (only meaningful when teaching is on, i.e. not minimal)
  let learnerLevelChoice: LearnerLevel = DEFAULT_CONFIG.learnerLevel;
  if (detailChoice !== "minimal") {
    const choice = await select<LearnerLevel>({
      message: "What's your programming knowledge level? (used to calibrate explanations)",
      options: (Object.keys(LEARNER_LEVEL_NAMES) as LearnerLevel[]).map((code) => ({
        label: LEARNER_LEVEL_NAMES[code],
        value: code,
        hint: code === "intermediate" ? "default" : undefined,
      })),
      initialValue: "intermediate",
    });
    handleCancel(choice);
    learnerLevelChoice = choice;
  }

  // Step 6: Ollama-specific setup
  let ollamaModel = DEFAULT_CONFIG.ollamaModel;

  if (engineChoice === "ollama") {
    const status = await checkOllama();

    if (status === "missing") {
      const platform = detectPlatform();
      const installCmd = ollamaInstallCommand(platform);
      note(
        `Ollama is not installed.\nInstall with: ${pc.cyan(installCmd)}\nOr visit: ${pc.cyan("https://ollama.com/download")}`,
        "Missing prerequisite"
      );
      const proceed = await confirm({
        message: "Install Ollama manually and continue after it's ready?",
        initialValue: true,
      });
      handleCancel(proceed);
      if (!proceed) {
        cancel("Setup paused. Run 'npx vibe-code-explainer init' again after installing Ollama.");
        process.exit(0);
      }
    } else if (status === "installed-not-running") {
      note(
        `Ollama is installed but the service isn't running.\nStart it with: ${pc.cyan("ollama serve")} (in a separate terminal).`,
        "Ollama not running"
      );
    }

    const modelChoice = await pickModel();
    handleCancel(modelChoice);
    ollamaModel = modelChoice;

    const pullOk = await pullModel(ollamaModel);
    if (!pullOk) {
      const skipPull = await confirm({
        message: "Continue without pulling the model? (You'll need to run 'ollama pull' manually.)",
        initialValue: false,
      });
      handleCancel(skipPull);
      if (!skipPull) {
        cancel("Setup aborted.");
        process.exit(1);
      }
    }
  }

  // Build config
  const config: Config = {
    ...DEFAULT_CONFIG,
    engine: engineChoice,
    detailLevel: detailChoice,
    language: languageChoice,
    learnerLevel: learnerLevelChoice,
    ollamaModel,
  };

  // Write config file (global or project path)
  const projectRoot = process.cwd();
  const configPath = scope === "global" ? getGlobalConfigPath() : join(projectRoot, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    const overwrite = await confirm({
      message: `${configPath} already exists. Overwrite?`,
      initialValue: false,
    });
    handleCancel(overwrite);
    if (!overwrite) {
      cancel("Setup aborted to avoid overwriting existing config.");
      process.exit(0);
    }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Install and wire up hooks
  let hookScript: string;
  let mergeResult;

  if (scope === "global") {
    hookScript = await ensureGlobalInstall();
    mergeResult = mergeHooksIntoUserSettings(hookScript);
  } else {
    hookScript = await ensureProjectInstall(projectRoot);
    mergeResult = mergeHooksIntoSettings(projectRoot, hookScript);
  }

  note(
    `${pc.green("\u2713")} Wrote ${pc.cyan(configPath)}\n${pc.green("\u2713")} ${mergeResult.created ? "Created" : "Updated"} ${pc.cyan(mergeResult.path)}`,
    "Configuration saved"
  );

  // Warmup
  if (engineChoice === "ollama" && !skipWarmup) {
    await runWarmup(config);
  }

  const whereMsg =
    scope === "global"
      ? `\nEvery Claude Code session on ${homedir()} will now explain every Edit, Write, and destructive Bash command.`
      : "\nClaude Code sessions in this project will now explain every Edit, Write, and destructive Bash command.";

  outro(pc.bold("code-explainer is active.") + whereMsg);
}
