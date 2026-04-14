import { intro, outro, confirm, cancel, isCancel, note, select } from "@clack/prompts";
import pc from "picocolors";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAME, getGlobalConfigPath } from "../config/schema.js";
import { removeHooksFromSettings, removeHooksFromUserSettings } from "../config/merge.js";

export async function runUninstall(): Promise<void> {
  intro(pc.bold("code-explainer uninstall"));

  const projectRoot = process.cwd();
  const projectConfigPath = join(projectRoot, CONFIG_FILENAME);
  const globalConfigPath = getGlobalConfigPath();

  const hasProject = existsSync(projectConfigPath) ||
    existsSync(join(projectRoot, ".claude", "settings.local.json")) ||
    existsSync(join(projectRoot, ".claude", "settings.json"));
  const hasGlobal = existsSync(globalConfigPath);

  if (!hasProject && !hasGlobal) {
    cancel("No code-explainer install found (neither project nor global).");
    return;
  }

  let scope: "project" | "global" | "both";
  if (hasProject && hasGlobal) {
    const choice = await select<"project" | "global" | "both">({
      message: "Both a project and a global install were detected. Which to remove?",
      options: [
        { label: "This project only", value: "project" },
        { label: "Global only", value: "global" },
        { label: "Both", value: "both" },
      ],
      initialValue: "project",
    });
    if (isCancel(choice)) {
      cancel("Uninstall cancelled.");
      return;
    }
    scope = choice;
  } else if (hasProject) {
    scope = "project";
  } else {
    scope = "global";
  }

  const proceed = await confirm({
    message: `Remove code-explainer ${scope === "both" ? "from both project and global" : `from ${scope}`}?`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Uninstall cancelled.");
    return;
  }

  const messages: string[] = [];

  if (scope === "project" || scope === "both") {
    const hookResult = removeHooksFromSettings(projectRoot, { useLocal: true });
    if (hookResult.removed && hookResult.path) {
      messages.push(`${pc.green("\u2713")} Removed hooks from ${pc.cyan(hookResult.path)}`);
    }
    const hookResultNonLocal = removeHooksFromSettings(projectRoot, { useLocal: false });
    if (hookResultNonLocal.removed && hookResultNonLocal.path) {
      messages.push(`${pc.green("\u2713")} Removed hooks from ${pc.cyan(hookResultNonLocal.path)}`);
    }
    if (existsSync(projectConfigPath)) {
      try {
        unlinkSync(projectConfigPath);
        messages.push(`${pc.green("\u2713")} Deleted ${pc.cyan(projectConfigPath)}`);
      } catch {
        messages.push(`${pc.yellow("\u26A0")} Could not delete ${pc.cyan(projectConfigPath)} (permissions?)`);
      }
    }
  }

  if (scope === "global" || scope === "both") {
    const hookResult = removeHooksFromUserSettings();
    if (hookResult.removed && hookResult.path) {
      messages.push(`${pc.green("\u2713")} Removed hooks from ${pc.cyan(hookResult.path)}`);
    }
    if (existsSync(globalConfigPath)) {
      try {
        unlinkSync(globalConfigPath);
        messages.push(`${pc.green("\u2713")} Deleted ${pc.cyan(globalConfigPath)}`);
      } catch {
        messages.push(`${pc.yellow("\u26A0")} Could not delete ${pc.cyan(globalConfigPath)} (permissions?)`);
      }
    }
  }

  if (messages.length === 0) {
    note("Nothing to remove.", "Uninstall");
  } else {
    note(messages.join("\n"), "Uninstall complete");
  }

  const tip =
    scope === "global" || scope === "both"
      ? "Note: the globally-installed npm package is still on disk. Run 'npm uninstall -g vibe-code-explainer' to remove it completely.\nOllama and any pulled models stay installed."
      : "Note: Ollama and any pulled models stay installed. Remove them with 'ollama rm <model>' if desired.";
  outro(pc.dim(tip));
}
