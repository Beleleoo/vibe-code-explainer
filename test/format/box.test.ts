import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  formatExplanationBox,
  formatDriftAlert,
  formatSkipNotice,
  formatErrorNotice,
} from "../../src/format/box.js";
import type { ExplanationResult } from "../../src/config/schema.js";

function makeResult(overrides: Partial<ExplanationResult> = {}): ExplanationResult {
  return {
    impact: "Changed background to gradient.",
    howItWorks: "linear-gradient generates the CSS.",
    why: "Tailwind utility classes.",
    deepDive: [],
    isSamePattern: false,
    samePatternNote: "",
    risk: "none",
    riskReason: "",
    ...overrides,
  };
}

describe("formatExplanationBox", () => {
  beforeEach(() => {
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  it("renders standard mode with all 3 sections", () => {
    const result = makeResult();
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).toContain("src/app/page.tsx");
    expect(box).toContain("Impact");
    expect(box).toContain("How it works");
    expect(box).toContain("Why");
    expect(box).toContain("Risk: None");
  });

  it("renders minimal mode with only impact, no section headers", () => {
    const result = makeResult({
      impact: "Visual change.",
    });
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "minimal",
      language: "en",
    });
    expect(box).toContain("Visual change.");
    expect(box).not.toContain("How it works");
    expect(box).not.toContain("Why");
  });

  it("renders verbose mode with deeper dive section", () => {
    const result = makeResult({
      deepDive: [
        { term: "Tailwind", explanation: "Utility-first CSS framework" },
        { term: "linear-gradient", explanation: "CSS function for color blends" },
      ],
    });
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "verbose",
      language: "en",
    });
    expect(box).toContain("Deeper dive");
    expect(box).toContain("Tailwind");
    expect(box).toContain("Utility-first CSS framework");
    expect(box).toContain("linear-gradient");
  });

  it("collapses to short note when isSamePattern is true", () => {
    const result = makeResult({
      isSamePattern: true,
      samePatternNote: "Same rename refactor as before",
      impact: "",
      howItWorks: "",
      why: "",
    });
    const box = formatExplanationBox({
      filePath: "src/other.ts",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).toContain("Same rename refactor as before");
    expect(box).not.toContain("How it works");
    expect(box).not.toContain("Why");
  });

  it("uses fallback note when isSamePattern is true but samePatternNote is empty", () => {
    const result = makeResult({
      isSamePattern: true,
      samePatternNote: "",
      impact: "",
      howItWorks: "",
      why: "",
    });
    const box = formatExplanationBox({
      filePath: "src/other.ts",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).toContain("Same pattern as before");
  });

  it("renders risk reason for non-none risk", () => {
    const result = makeResult({
      risk: "high",
      riskReason: "Hardcoded API key in environment file",
    });
    const box = formatExplanationBox({
      filePath: ".env",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).toContain("Risk: High");
    expect(box).toContain("Hardcoded API key");
  });

  it("translates section labels to Portuguese", () => {
    const result = makeResult();
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "standard",
      language: "pt",
    });
    expect(box).toContain("Impacto");
    expect(box).toContain("Como funciona");
    expect(box).toContain("Por que");
    expect(box).toContain("Risco: Nenhum");
  });

  it("translates section labels to Spanish", () => {
    const result = makeResult();
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "standard",
      language: "es",
    });
    expect(box).toContain("Impacto");
    expect(box).toContain("C\u00f3mo funciona");
    expect(box).toContain("Por qu\u00e9");
  });

  it("produces plain text without ANSI codes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    const result = makeResult();
    const box = formatExplanationBox({
      filePath: "src/app/page.tsx",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).not.toMatch(/\x1B\[/);
    expect(box).toContain("[OK]");
  });

  it("uses [!!!] marker for high risk in NO_COLOR mode", () => {
    process.env.NO_COLOR = "1";
    const result = makeResult({
      risk: "high",
      riskReason: "Critical issue",
    });
    const box = formatExplanationBox({
      filePath: ".env",
      result,
      detailLevel: "standard",
      language: "en",
    });
    expect(box).toContain("[!!!]");
  });

  it("highlights inline `code` in non-NO_COLOR mode", () => {
    const result = makeResult({
      howItWorks: "Uses `linear-gradient` to blend colors.",
    });
    const box = formatExplanationBox({
      filePath: "src/app.css",
      result,
      detailLevel: "standard",
      language: "en",
    });
    // Should still contain the text content
    expect(box).toContain("linear-gradient");
  });
});

describe("formatDriftAlert", () => {
  it("renders a drift alert with file list", () => {
    const result = formatDriftAlert(
      12,
      ["src/lib/payments.ts", ".env", "package.json"],
      "update the homepage hero"
    );
    expect(result).toContain("SESSION DRIFT");
    expect(result).toContain("12 files");
    expect(result).toContain("3 may be unrelated");
    expect(result).toContain("src/lib/payments.ts");
    expect(result).toContain("update the homepage hero");
  });

  it("renders without user request when not provided", () => {
    const result = formatDriftAlert(5, ["auth.ts"]);
    expect(result).toContain("SESSION DRIFT");
    expect(result).toContain("auth.ts");
    expect(result).not.toContain("Your request");
  });
});

describe("formatSkipNotice", () => {
  it("formats a skip notice with reason", () => {
    const result = formatSkipNotice("explanation took too long (>8s)");
    expect(result).toContain("[code-explainer] skipped: explanation took too long (>8s)");
  });
});

describe("formatErrorNotice", () => {
  it("follows the error message template", () => {
    const result = formatErrorNotice(
      "Cannot reach Ollama",
      "The Ollama service is not running",
      "Run 'ollama serve' in a separate terminal"
    );
    expect(result).toContain("[code-explainer] Cannot reach Ollama.");
    expect(result).toContain("The Ollama service is not running.");
    expect(result).toContain("Fix: Run 'ollama serve' in a separate terminal.");
  });
});
