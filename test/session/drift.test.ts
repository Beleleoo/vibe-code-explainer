import { describe, it, expect } from "vitest";
import { analyzeDrift, matchesSensitivePattern, shouldAlertDrift } from "../../src/session/drift.js";
import type { SessionEntry } from "../../src/session/tracker.js";

function entry(file: string, unrelated = false): SessionEntry {
  return {
    file,
    timestamp: Date.now(),
    risk: "none",
    summary: "x",
    unrelated,
  };
}

describe("matchesSensitivePattern", () => {
  it("matches .env files", () => {
    expect(matchesSensitivePattern(".env")).toBe(true);
    expect(matchesSensitivePattern(".env.local")).toBe(true);
    expect(matchesSensitivePattern("app/.env")).toBe(true);
  });

  it("matches auth/payment/billing paths", () => {
    expect(matchesSensitivePattern("src/auth/middleware.ts")).toBe(true);
    expect(matchesSensitivePattern("lib/payment-processor.ts")).toBe(true);
    expect(matchesSensitivePattern("src/billing/index.ts")).toBe(true);
    expect(matchesSensitivePattern("src/stripe-client.ts")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(matchesSensitivePattern("src/app/page.tsx")).toBe(false);
    expect(matchesSensitivePattern("components/Button.tsx")).toBe(false);
    expect(matchesSensitivePattern("styles/main.css")).toBe(false);
  });
});

describe("analyzeDrift", () => {
  it("does not flag the first edit (no context)", () => {
    const result = analyzeDrift("src/app/page.tsx", []);
    expect(result.isUnrelated).toBe(false);
  });

  it("flags sensitive file when session was not in sensitive area", () => {
    const prior = [
      entry("src/components/Button.tsx"),
      entry("src/components/Card.tsx"),
    ];
    const result = analyzeDrift(".env", prior);
    expect(result.isUnrelated).toBe(true);
    expect(result.reason).toContain("sensitive");
  });

  it("does NOT flag sensitive file when session already works in sensitive area", () => {
    const prior = [entry("src/auth/login.ts"), entry("src/auth/session.ts")];
    const result = analyzeDrift("src/auth/token.ts", prior);
    expect(result.isUnrelated).toBe(false);
  });

  it("flags cross-module drift after 2+ prior edits", () => {
    const prior = [
      entry("app/src/components/Button.tsx"),
      entry("app/src/components/Card.tsx"),
    ];
    const result = analyzeDrift("server/routes/api.ts", prior);
    expect(result.isUnrelated).toBe(true);
    expect(result.reason).toContain("different top-level");
  });

  it("does NOT flag same top-level-dir files", () => {
    const prior = [
      entry("src/components/Button.tsx"),
      entry("src/components/Card.tsx"),
    ];
    const result = analyzeDrift("src/utils/helpers.ts", prior);
    expect(result.isUnrelated).toBe(false);
  });

  it("does not flag cross-module on only 1 prior edit (too early)", () => {
    const prior = [entry("app/page.tsx")];
    const result = analyzeDrift("server/routes.ts", prior);
    expect(result.isUnrelated).toBe(false);
  });
});

describe("shouldAlertDrift", () => {
  it("does not alert with zero unrelated files", () => {
    const entries = [entry("a.ts"), entry("b.ts"), entry("c.ts")];
    const result = shouldAlertDrift(entries);
    expect(result.shouldAlert).toBe(false);
    expect(result.unrelatedFiles).toHaveLength(0);
  });

  it("alerts when unrelated count crosses 3", () => {
    const entries = [
      entry("a.ts"),
      entry("src/auth/x.ts", true),
      entry("src/payments/y.ts", true),
      entry(".env", true),
    ];
    const result = shouldAlertDrift(entries);
    expect(result.shouldAlert).toBe(true);
    expect(result.unrelatedFiles).toHaveLength(3);
  });

  it("reports totalFiles correctly", () => {
    const entries = [
      entry("a.ts"),
      entry("b.ts"),
      entry("c.ts"),
      entry("a.ts"), // duplicate, should be counted once
    ];
    const result = shouldAlertDrift(entries);
    expect(result.totalFiles).toBe(3);
  });
});
