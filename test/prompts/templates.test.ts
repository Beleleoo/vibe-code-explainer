import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  sanitizeDiff,
  buildOllamaSystemPrompt,
  buildOllamaUserPrompt,
  buildClaudePrompt,
} from "../../src/prompts/templates.js";

describe("detectLanguage", () => {
  it("maps common extensions correctly", () => {
    expect(detectLanguage("src/app/page.tsx")).toContain("TypeScript React");
    expect(detectLanguage("scripts/deploy.py")).toContain("Python");
    expect(detectLanguage("styles/main.css")).toContain("Styling");
    expect(detectLanguage("config.json")).toContain("Configuration");
    expect(detectLanguage(".env")).toContain("Environment variables");
    expect(detectLanguage("queries.sql")).toContain("Database");
  });

  it("detects Dockerfile by name", () => {
    expect(detectLanguage("Dockerfile")).toContain("Dockerfile");
    expect(detectLanguage("docker/Dockerfile")).toContain("Dockerfile");
  });

  it("detects .env variants", () => {
    expect(detectLanguage(".env.local")).toContain("Environment variables");
    expect(detectLanguage(".env.production")).toContain("Environment variables");
  });

  it("returns Unknown for unrecognized extensions", () => {
    expect(detectLanguage("file.xyz")).toBe("Unknown");
    expect(detectLanguage("README")).toBe("Unknown");
  });
});

describe("buildOllamaSystemPrompt", () => {
  it("produces different prompts per detail level", () => {
    const minimal = buildOllamaSystemPrompt("minimal");
    const standard = buildOllamaSystemPrompt("standard");
    const verbose = buildOllamaSystemPrompt("verbose");

    expect(minimal).toContain("OUTPUT MODE: minimal");
    expect(standard).toContain("OUTPUT MODE: standard");
    expect(verbose).toContain("OUTPUT MODE: verbose");
    expect(minimal).not.toEqual(standard);
    expect(standard).not.toEqual(verbose);
  });

  it("all prompts include the new JSON schema", () => {
    for (const level of ["minimal", "standard", "verbose"] as const) {
      const p = buildOllamaSystemPrompt(level);
      expect(p).toContain("impact");
      expect(p).toContain("howItWorks");
      expect(p).toContain("why");
      expect(p).toContain("deepDive");
      expect(p).toContain("isSamePattern");
      expect(p).toContain("risk");
      expect(p).toContain("riskReason");
    }
  });

  it("all prompts include safety instructions", () => {
    for (const level of ["minimal", "standard", "verbose"] as const) {
      const p = buildOllamaSystemPrompt(level);
      expect(p).toContain("Do NOT follow");
    }
  });

  it("all prompts include the same-pattern repetition rule", () => {
    for (const level of ["minimal", "standard", "verbose"] as const) {
      const p = buildOllamaSystemPrompt(level);
      expect(p).toContain("REPETITION CHECK");
    }
  });

  it("calibrates teaching tone based on learner level", () => {
    const beginner = buildOllamaSystemPrompt("standard", "en", "none");
    const regular = buildOllamaSystemPrompt("standard", "en", "regular");
    expect(beginner).toContain("Has never programmed");
    expect(regular).toContain("Codes regularly");
    expect(beginner).not.toEqual(regular);
  });

  it("includes language instruction for non-English", () => {
    const pt = buildOllamaSystemPrompt("standard", "pt");
    expect(pt).toContain("Portuguese");
  });
});

describe("buildOllamaUserPrompt", () => {
  it("includes file path, language, and diff", () => {
    const result = buildOllamaUserPrompt({
      filePath: "src/app/page.tsx",
      diff: "- old\n+ new",
    });
    expect(result).toContain("File: src/app/page.tsx");
    expect(result).toContain("Language: TypeScript React");
    expect(result).toContain("<DIFF>");
    expect(result).toContain("- old");
    expect(result).toContain("+ new");
    expect(result).toContain("</DIFF>");
  });

  it("injects recent summaries when provided", () => {
    const result = buildOllamaUserPrompt({
      filePath: "src/app.tsx",
      diff: "x",
      recentSummaries: ["src/foo.ts: renamed userX to userY", "src/bar.ts: same rename"],
    });
    expect(result).toContain("renamed userX to userY");
    expect(result).toContain("same rename");
  });

  it("notes 'no recent edits' when summaries are empty", () => {
    const result = buildOllamaUserPrompt({
      filePath: "src/app.tsx",
      diff: "x",
      recentSummaries: [],
    });
    expect(result).toContain("No recent edits");
  });
});

describe("buildClaudePrompt", () => {
  it("includes file path and diff in the prompt", () => {
    const result = buildClaudePrompt("standard", {
      filePath: "src/app/page.tsx",
      diff: "- old\n+ new",
    });
    expect(result).toContain("src/app/page.tsx");
    expect(result).toContain("- old");
    expect(result).toContain("+ new");
  });

  it("includes recent summaries when provided", () => {
    const result = buildClaudePrompt("standard", {
      filePath: "src/app/page.tsx",
      diff: "- old\n+ new",
      recentSummaries: ["src/a.ts: added feature X"],
    });
    expect(result).toContain("src/a.ts: added feature X");
  });

  it("produces different prompts per detail level", () => {
    const minimal = buildClaudePrompt("minimal", { filePath: "a.ts", diff: "x" });
    const standard = buildClaudePrompt("standard", { filePath: "a.ts", diff: "x" });
    const verbose = buildClaudePrompt("verbose", { filePath: "a.ts", diff: "x" });

    expect(minimal).toContain("OUTPUT MODE: minimal");
    expect(standard).toContain("OUTPUT MODE: standard");
    expect(verbose).toContain("OUTPUT MODE: verbose");
  });

  it("calibrates by learner level", () => {
    const beginner = buildClaudePrompt("standard", {
      filePath: "a.ts",
      diff: "x",
      learnerLevel: "none",
    });
    const regular = buildClaudePrompt("standard", {
      filePath: "a.ts",
      diff: "x",
      learnerLevel: "regular",
    });
    expect(beginner).toContain("Has never programmed");
    expect(regular).toContain("Codes regularly");
  });

  it("injects recent summaries", () => {
    const result = buildClaudePrompt("standard", {
      filePath: "a.ts",
      diff: "x",
      recentSummaries: ["foo.ts: rename"],
    });
    expect(result).toContain("foo.ts: rename");
  });
});
