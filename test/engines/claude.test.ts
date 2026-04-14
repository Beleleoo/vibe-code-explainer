import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";

// Mock child_process.execFile before importing callClaude
vi.mock("node:child_process", () => {
  return {
    execFile: vi.fn(),
  };
});

import { execFile } from "node:child_process";
import { callClaude } from "../../src/engines/claude.js";

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

type ExecFileCallback = (err: unknown, stdout: string, stderr: string) => void;

function mockExec(behavior: (cb: ExecFileCallback) => void) {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
    behavior(cb as ExecFileCallback);
    return { on: () => {} } as unknown as ReturnType<typeof execFile>;
  });
}

const baseConfig = { ...DEFAULT_CONFIG, engine: "claude" as const };

describe("callClaude", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed explanation on successful stdout", async () => {
    mockExec((cb) => {
      cb(null, '{"impact":"Visual change.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}', "");
    });

    const outcome = await callClaude({
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

  it("includes file path and diff in the prompt", async () => {
    let capturedPrompt = "";
    execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
      capturedPrompt = (args as string[])[1] || "";
      (cb as ExecFileCallback)(null, '{"impact":"ok","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}', "");
      return { on: () => {} } as unknown as ReturnType<typeof execFile>;
    });

    await callClaude({
      filePath: "app.tsx",
      diff: "+ const hero = true;",
      config: baseConfig,
    });

    expect(capturedPrompt).toContain("app.tsx");
    expect(capturedPrompt).toContain("+ const hero = true;");
  });

  it("includes recent summaries in the prompt when provided", async () => {
    let capturedPrompt = "";
    execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
      capturedPrompt = (args as string[])[1] || "";
      (cb as ExecFileCallback)(null, '{"impact":"ok","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"none","riskReason":""}', "");
      return { on: () => {} } as unknown as ReturnType<typeof execFile>;
    });

    await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
      recentSummaries: ["src/hero.tsx: added animation"],
    });

    expect(capturedPrompt).toContain("src/hero.tsx: added animation");
  });

  it("returns error when claude command is not found (ENOENT)", async () => {
    mockExec((cb) => {
      const err = Object.assign(new Error("not found"), { code: "ENOENT" });
      cb(err, "", "");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.problem).toContain("not found");
      expect(outcome.fix).toContain("Install Claude Code");
    }
  });

  it("returns skip when claude times out", async () => {
    mockExec((cb) => {
      const err = Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" });
      cb(err, "", "");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: { ...baseConfig, skipIfSlowMs: 100 },
    });

    expect(outcome.kind).toBe("skip");
    if (outcome.kind === "skip") {
      expect(outcome.reason).toContain("too long");
    }
  });

  it("returns error for auth failure in stderr", async () => {
    mockExec((cb) => {
      const err = Object.assign(new Error("exited"), { code: 1 });
      cb(err, "", "Error: unauthorized, please run 'claude login'");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.problem).toContain("not authenticated");
      expect(outcome.fix).toContain("claude login");
    }
  });

  it("returns skip when claude outputs nothing", async () => {
    mockExec((cb) => {
      cb(null, "   \n", "");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("skip");
  });

  it("falls back to raw text when JSON is malformed", async () => {
    mockExec((cb) => {
      cb(null, "This is just prose, not JSON.", "");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.impact).toContain("This is just prose");
      expect(outcome.result.risk).toBe("none");
    }
  });

  it("extracts JSON from markdown code fences", async () => {
    mockExec((cb) => {
      cb(null, '```json\n{"impact":"Test.","howItWorks":"","why":"","deepDive":[],"isSamePattern":false,"samePatternNote":"","risk":"low","riskReason":"New dep."}\n```', "");
    });

    const outcome = await callClaude({
      filePath: "app.tsx",
      diff: "x",
      config: baseConfig,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.risk).toBe("low");
    }
  });
});
