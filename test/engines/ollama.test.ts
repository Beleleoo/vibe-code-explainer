import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callOllama } from "../../src/engines/ollama.js";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";

const baseConfig = { ...DEFAULT_CONFIG };

describe("callOllama", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed explanation on successful JSON response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"impact":"Visual change.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "- old\n+ new",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toBe("Visual change.");
      expect(outcome.result.risk).toBe("none");
    }
  });

  it("extracts JSON from markdown code fences", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '```json\n{"impact":"Test.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"low","riskReason":"New dep."}\n```',
      }),
    });

    const outcome = await callOllama({
      filePath: "package.json",
      diff: "+ new dep",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.risk).toBe("low");
    }
  });

  it("extracts JSON from markdown fence with NO closing backticks", async () => {
    // Real-world failure case: qwen3.5 sometimes opens ```json but never closes.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '```json\n{"impact":"Visual.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toBe("Visual.");
      expect(outcome.result.risk).toBe("none");
    }
  });

  it("extracts JSON when model outputs prose before the JSON block", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: 'Here is the analysis:\n\n{"impact":"Prose prefix case.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toBe("Prose prefix case.");
    }
  });

  it("extracts first balanced object when model outputs nested braces in string values", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"impact":"Object like {a: 1}","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.ts",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toContain("Object like");
    }
  });

  it("falls back to truncated raw text when JSON is malformed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: "This is not JSON, just raw text from the model." }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toContain("This is not JSON");
      expect(outcome.result.risk).toBe("none");
    }
  });

  it("truncates raw text fallback to 200 chars + ellipsis", async () => {
    const longText = "word ".repeat(100); // 500 chars
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: longText }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact.length).toBeLessThanOrEqual(203);
      expect(outcome.result.impact.endsWith("...")).toBe(true);
    }
  });

  it("returns skip when response is empty", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: "   " }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("skip");
    if (outcome.kind === "skip") {
      expect(outcome.reason).toContain("empty");
    }
  });

  it("returns error when connection is refused", async () => {
    const err = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    fetchMock.mockRejectedValue(err);

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.problem).toContain("Cannot reach Ollama");
      expect(outcome.fix).toContain("ollama serve");
    }
  });

  it("returns skip on AbortError (timeout)", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValue(err);

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: { ...baseConfig, skipIfSlowMs: 100 },
    });

    expect(outcome.kind).toBe("skip");
    if (outcome.kind === "skip") {
      expect(outcome.reason).toContain("too long");
    }
  });

  it("returns error when Ollama returns 404 for missing model", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "model 'nonexistent' not found",
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: { ...baseConfig, ollamaModel: "nonexistent" },
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.problem).toContain("not found");
      expect(outcome.fix).toContain("ollama pull");
    }
  });

  it("rejects non-loopback URL with security warning", async () => {
    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: { ...baseConfig, ollamaUrl: "http://evil.example.com:11434" },
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.problem).toContain("not local");
    }
    // fetch should not have been called
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts 127.0.0.1 as loopback", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"summary":"ok","risk":"none","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: { ...baseConfig, ollamaUrl: "http://127.0.0.1:11434" },
    });

    expect(outcome.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects invalid risk value in response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        response: '{"impact":"Test","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"critical","riskReason":""}',
      }),
    });

    const outcome = await callOllama({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    // Should fall back to raw text since risk value is invalid
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.risk).toBe("none");
    }
  });
});
