import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeHooksIntoSettings, removeHooksFromSettings, HOOK_MARKER } from "../../src/config/merge.js";

const HOOK_SCRIPT = "/opt/code-explainer/dist/hooks/post-tool.js";

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "ce-merge-test-"));
}

function settingsPath(root: string, filename = "settings.local.json"): string {
  return join(root, ".claude", filename);
}

function readSettings(root: string, filename = "settings.local.json"): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(root, filename), "utf-8"));
}

describe("mergeHooksIntoSettings", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates .claude/settings.local.json when it does not exist", () => {
    const result = mergeHooksIntoSettings(root, HOOK_SCRIPT);
    expect(result.created).toBe(true);
    expect(existsSync(result.path)).toBe(true);

    const settings = readSettings(root);
    expect(settings.hooks).toBeDefined();
  });

  it("adds hooks when settings file exists without hooks", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath(root), JSON.stringify({ theme: "dark" }) + "\n");

    const result = mergeHooksIntoSettings(root, HOOK_SCRIPT);
    expect(result.created).toBe(false);

    const settings = readSettings(root) as {
      theme: string;
      hooks: { PostToolUse: Array<{ matcher: string; hooks: unknown[] }> };
    };
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.PostToolUse).toHaveLength(2);
  });

  it("preserves existing hooks from other tools", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath(root),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: "prettier --write" }],
            },
          ],
        },
      }) + "\n"
    );

    mergeHooksIntoSettings(root, HOOK_SCRIPT);
    const settings = readSettings(root) as {
      hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };

    const allCommands = settings.hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    expect(allCommands.some((c) => c.includes("prettier"))).toBe(true);
    expect(allCommands.some((c) => c.includes("post-tool"))).toBe(true);
  });

  it("is idempotent (re-merging does not duplicate)", () => {
    mergeHooksIntoSettings(root, HOOK_SCRIPT);
    mergeHooksIntoSettings(root, HOOK_SCRIPT);

    const settings = readSettings(root) as {
      hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };

    const codeExplainerEntries = settings.hooks.PostToolUse.flatMap((e) =>
      e.hooks.filter((h) => h.command.includes(HOOK_MARKER))
    );
    // 2 matcher groups (Edit|Write|MultiEdit, Bash), each with 1 command
    expect(codeExplainerEntries).toHaveLength(2);
  });

  it("throws on malformed JSON rather than corrupting the file", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath(root), "{ not valid json,,,");

    expect(() => mergeHooksIntoSettings(root, HOOK_SCRIPT)).toThrow(/not valid JSON/);
  });

  it("throws when top-level is not an object", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath(root), JSON.stringify(["array at top"]));

    expect(() => mergeHooksIntoSettings(root, HOOK_SCRIPT)).toThrow(/JSON object/);
  });
});

describe("removeHooksFromSettings", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes code-explainer hooks, preserves others", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath(root),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [
                { type: "command", command: "prettier --write" },
                { type: "command", command: `node /opt/code-explainer/dist/hooks/post-tool.js` },
              ],
            },
          ],
        },
      }) + "\n"
    );

    const result = removeHooksFromSettings(root);
    expect(result.removed).toBe(true);

    const settings = readSettings(root) as {
      hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };
    const allCommands = settings.hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    expect(allCommands).toContain("prettier --write");
    expect(allCommands.some((c) => c.includes("post-tool"))).toBe(false);
  });

  it("removes empty PostToolUse array after cleanup", () => {
    mergeHooksIntoSettings(root, HOOK_SCRIPT);
    removeHooksFromSettings(root);

    const settings = readSettings(root);
    expect(settings.hooks).toBeUndefined();
  });

  it("reports removed: false when nothing matched", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath(root), JSON.stringify({ theme: "dark" }));

    const result = removeHooksFromSettings(root);
    expect(result.removed).toBe(false);
  });

  it("handles missing settings file gracefully", () => {
    const result = removeHooksFromSettings(root);
    expect(result.removed).toBe(false);
    expect(result.path).toBeNull();
  });

  it("does not corrupt malformed files during uninstall", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath(root), "{ bad json");

    expect(() => removeHooksFromSettings(root)).not.toThrow();
  });
});
