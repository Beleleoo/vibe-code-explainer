import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HOOK_MARKER = "code-explainer";

interface HookMatcherEntry {
  matcher: string;
  hooks: Array<{
    type: "command";
    command: string;
  }>;
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcherEntry[]>;
  [key: string]: unknown;
}

function buildHookCommand(hookScriptPath: string): string {
  return `node "${hookScriptPath}"`;
}

function buildCodeExplainerEntries(hookScriptPath: string): Record<string, HookMatcherEntry[]> {
  const command = buildHookCommand(hookScriptPath);
  return {
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [{ type: "command", command }],
      },
      {
        matcher: "Bash",
        hooks: [{ type: "command", command }],
      },
    ],
  };
}

function isCodeExplainerHook(cmd: string): boolean {
  return cmd.includes(HOOK_MARKER) && cmd.includes("post-tool");
}

export interface MergeResult {
  created: boolean;
  path: string;
}

/**
 * Read, parse, merge code-explainer hooks into, and write back the settings file.
 * Creates `.claude/settings.json` if it doesn't exist. Preserves all existing
 * hooks and other top-level keys. Idempotent — re-running does not duplicate.
 *
 * Throws if the existing file is malformed JSON, so the caller can surface
 * the error clearly instead of corrupting user settings.
 */
export function mergeHooksIntoSettings(
  projectRoot: string,
  hookScriptPath: string,
  { useLocal = true }: { useLocal?: boolean } = {}
): MergeResult {
  const claudeDir = join(projectRoot, ".claude");
  const filename = useLocal ? "settings.local.json" : "settings.json";
  const settingsPath = join(claudeDir, filename);

  let settings: ClaudeSettings = {};
  let created = false;

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[code-explainer] Cannot merge hooks into ${settingsPath}. The file is not valid JSON. Fix: repair the JSON manually (check for trailing commas, unquoted keys) or delete the file to regenerate. Original error: ${msg}`
      );
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error(
        `[code-explainer] Cannot merge hooks into ${settingsPath}. The file does not contain a JSON object at the top level. Fix: ensure the file starts with { and ends with }.`
      );
    }
  } else {
    created = true;
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const ourEntries = buildCodeExplainerEntries(hookScriptPath);
  const existingPostTool = settings.hooks.PostToolUse ?? [];

  // Remove any previous code-explainer entries to keep idempotency.
  const cleaned = existingPostTool
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !isCodeExplainerHook(h.command)),
    }))
    .filter((entry) => entry.hooks.length > 0);

  settings.hooks.PostToolUse = [...cleaned, ...ourEntries.PostToolUse];

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  return { created, path: settingsPath };
}

/**
 * Remove all code-explainer hook entries from the settings file, preserving
 * other hooks and config. Does nothing if the file or hook entries do not
 * exist. Never throws for missing files.
 */
export function removeHooksFromSettings(
  projectRoot: string,
  { useLocal = true }: { useLocal?: boolean } = {}
): { removed: boolean; path: string | null } {
  const candidates = useLocal
    ? [".claude/settings.local.json", ".claude/settings.json"]
    : [".claude/settings.json"];

  let removedAny = false;
  let lastPath: string | null = null;

  for (const rel of candidates) {
    const path = join(projectRoot, rel);
    if (!existsSync(path)) continue;

    let settings: ClaudeSettings;
    try {
      settings = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // Don't corrupt malformed files during uninstall.
      continue;
    }

    if (!settings.hooks?.PostToolUse) continue;

    const before = JSON.stringify(settings.hooks.PostToolUse);
    settings.hooks.PostToolUse = settings.hooks.PostToolUse
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((h) => !isCodeExplainerHook(h.command)),
      }))
      .filter((entry) => entry.hooks.length > 0);
    const after = JSON.stringify(settings.hooks.PostToolUse);

    if (before !== after) {
      if (settings.hooks.PostToolUse.length === 0) {
        delete settings.hooks.PostToolUse;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
      writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
      removedAny = true;
      lastPath = path;
    }
  }

  return { removed: removedAny, path: lastPath };
}

export { dirname };

/**
 * Merge code-explainer hooks into the user-level ~/.claude/settings.json,
 * so hooks fire in every project. Used by the global install path.
 */
export function mergeHooksIntoUserSettings(hookScriptPath: string): MergeResult {
  const userClaudeDir = join(homedir(), ".claude");
  const settingsPath = join(userClaudeDir, "settings.json");

  let settings: ClaudeSettings = {};
  let created = false;

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[code-explainer] Cannot merge hooks into ${settingsPath}. The file is not valid JSON. Fix: repair the JSON manually or delete the file to regenerate. Original error: ${msg}`
      );
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error(
        `[code-explainer] Cannot merge hooks into ${settingsPath}. The file does not contain a JSON object at the top level.`
      );
    }
  } else {
    created = true;
    if (!existsSync(userClaudeDir)) {
      mkdirSync(userClaudeDir, { recursive: true });
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const ourEntries = {
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [{ type: "command" as const, command: `node "${hookScriptPath}"` }],
      },
      {
        matcher: "Bash",
        hooks: [{ type: "command" as const, command: `node "${hookScriptPath}"` }],
      },
    ],
  };

  const existingPostTool = settings.hooks.PostToolUse ?? [];
  const cleaned = existingPostTool
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !isCodeExplainerHook(h.command)),
    }))
    .filter((entry) => entry.hooks.length > 0);

  settings.hooks.PostToolUse = [...cleaned, ...ourEntries.PostToolUse];

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  return { created, path: settingsPath };
}

/**
 * Remove code-explainer hook entries from ~/.claude/settings.json.
 * Preserves other hooks and config. Never throws on missing files.
 */
export function removeHooksFromUserSettings(): { removed: boolean; path: string | null } {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) return { removed: false, path: null };

  let settings: ClaudeSettings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return { removed: false, path: null };
  }

  if (!settings.hooks?.PostToolUse) return { removed: false, path: null };

  const before = JSON.stringify(settings.hooks.PostToolUse);
  settings.hooks.PostToolUse = settings.hooks.PostToolUse
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !isCodeExplainerHook(h.command)),
    }))
    .filter((entry) => entry.hooks.length > 0);
  const after = JSON.stringify(settings.hooks.PostToolUse);

  if (before === after) return { removed: false, path: null };

  if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { removed: true, path: settingsPath };
}
