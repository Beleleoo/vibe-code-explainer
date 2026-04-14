import { describe, it, expect } from "vitest";
import { validateConfig, DEFAULT_CONFIG } from "../../src/config/schema.js";

describe("validateConfig", () => {
  it("accepts a valid full config", () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result.engine).toBe("ollama");
    expect(result.detailLevel).toBe("standard");
    expect(result.skipIfSlowMs).toBe(30000);
  });

  it("fills missing fields with defaults when partial config provided", () => {
    const result = validateConfig({ engine: "claude" });
    expect(result.engine).toBe("claude");
    expect(result.ollamaModel).toBe(DEFAULT_CONFIG.ollamaModel);
    expect(result.detailLevel).toBe("standard");
  });

  it("throws for invalid engine value", () => {
    expect(() => validateConfig({ engine: "openai" })).toThrow(/engine/i);
  });

  it("throws for invalid detailLevel", () => {
    expect(() => validateConfig({ detailLevel: "extreme" })).toThrow(/detailLevel/i);
  });

  it("throws for invalid ollamaUrl", () => {
    expect(() => validateConfig({ ollamaUrl: "not-a-url" })).toThrow(/ollamaUrl/i);
  });

  it("throws for negative skipIfSlowMs", () => {
    expect(() => validateConfig({ skipIfSlowMs: -1 })).toThrow(/skipIfSlowMs/i);
  });

  it("accepts skipIfSlowMs = 0 (never skip)", () => {
    const result = validateConfig({ skipIfSlowMs: 0 });
    expect(result.skipIfSlowMs).toBe(0);
  });

  it("coerces string skipIfSlowMs to number", () => {
    const result = validateConfig({ skipIfSlowMs: "5000" });
    expect(result.skipIfSlowMs).toBe(5000);
  });

  it("throws for invalid language code", () => {
    expect(() => validateConfig({ language: "xx" })).toThrow(/language/i);
  });

  it("throws for invalid learnerLevel", () => {
    expect(() => validateConfig({ learnerLevel: "expert" })).toThrow(/learnerLevel/i);
  });

  it("accepts empty bashFilter.capturePatterns array", () => {
    const result = validateConfig({ bashFilter: { capturePatterns: [] } });
    expect(result.bashFilter.capturePatterns).toEqual([]);
  });

  it("accepts custom capturePatterns", () => {
    const result = validateConfig({ bashFilter: { capturePatterns: ["terraform apply", "kubectl delete"] } });
    expect(result.bashFilter.capturePatterns).toContain("terraform apply");
  });

  it("throws helpful error message listing all invalid fields", () => {
    let err: Error | null = null;
    try {
      validateConfig({ engine: "bad", detailLevel: "also-bad" });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("engine");
    expect(err!.message).toContain("detailLevel");
  });
});
