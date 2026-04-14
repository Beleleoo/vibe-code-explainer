import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "../../src/config/schema.js";

// Regression: ISSUE-002 — config set accepted invalid enum values without validation,
// corrupting the config file and bricking subsequent config commands.
// Found by /qa on 2026-04-14
// Report: .gstack/qa-reports/qa-report-vibe-code-explainer-2026-04-14.md

describe("config set validation guard", () => {
  let tmpDir: string;
  let configPath: string;
  const validConfig = {
    engine: "ollama",
    ollamaModel: "qwen3.5:4b",
    ollamaUrl: "http://localhost:11434",
    detailLevel: "standard",
    language: "en",
    learnerLevel: "intermediate",
    hooks: { edit: true, write: true, bash: true },
    exclude: ["*.lock"],
    skipIfSlowMs: 30000,
    bashFilter: { capturePatterns: ["rm"] },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ce-test-"));
    configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify(validConfig, null, 2));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateConfig rejects invalid engine enum values", () => {
    // This is the exact precondition that triggered the bug:
    // config set would write invalid values before we added the guard.
    expect(() => validateConfig({ engine: "invalid-engine" })).toThrow(/engine/i);
  });

  it("validateConfig rejects invalid detailLevel", () => {
    expect(() => validateConfig({ detailLevel: "extreme" })).toThrow(/detailLevel/i);
  });

  it("validateConfig rejects invalid language", () => {
    expect(() => validateConfig({ language: "xx" })).toThrow(/language/i);
  });

  it("validateConfig accepts valid engine values", () => {
    expect(() => validateConfig({ engine: "ollama" })).not.toThrow();
    expect(() => validateConfig({ engine: "claude" })).not.toThrow();
  });

  it("a mutated config object with an invalid field fails validateConfig", () => {
    // Simulate what config set does: load → mutate → validate
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    config.engine = "invalid-engine"; // the bad mutation
    expect(() => validateConfig(config)).toThrow(/engine/i);
    // The config file should NOT have been written (caller's responsibility,
    // but we verify the guard throws before any write would happen)
  });
});
