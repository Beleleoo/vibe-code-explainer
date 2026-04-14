import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import {
  hashDiff,
  getCached,
  setCached,
  clearCache,
  getCacheFilePath,
} from "../../src/cache/explanation-cache.js";

const SESSION = "test-session-" + Date.now();

describe("hashDiff", () => {
  it("produces consistent hashes for the same input", () => {
    const h1 = hashDiff("- old\n+ new");
    const h2 = hashDiff("- old\n+ new");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different input", () => {
    const h1 = hashDiff("- old\n+ new");
    const h2 = hashDiff("- different\n+ diff");
    expect(h1).not.toBe(h2);
  });

  it("is whitespace-sensitive", () => {
    const h1 = hashDiff("hello");
    const h2 = hashDiff("hello ");
    expect(h1).not.toBe(h2);
  });

  it("produces a hex string of length 64 (SHA-256)", () => {
    const h = hashDiff("anything");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("cache get/set", () => {
  beforeEach(() => {
    clearCache(SESSION);
  });

  afterEach(() => {
    clearCache(SESSION);
  });

  it("returns undefined on cache miss", () => {
    const result = getCached(SESSION, "new diff");
    expect(result).toBeUndefined();
  });

  it("returns cached result on hit", () => {
    const diff = "- old\n+ new";
    const result = {
      summary: "Visual change.",
      risk: "none" as const,
      riskReason: "",
    };
    setCached(SESSION, diff, result);

    const cached = getCached(SESSION, diff);
    expect(cached).toEqual(result);
  });

  it("does not hit cache with different diff", () => {
    const result = {
      summary: "Visual change.",
      risk: "none" as const,
      riskReason: "",
    };
    setCached(SESSION, "original diff", result);

    const cached = getCached(SESSION, "different diff");
    expect(cached).toBeUndefined();
  });

  it("returns most recent entry when same diff is cached multiple times", () => {
    const diff = "same diff";
    setCached(SESSION, diff, {
      summary: "First.",
      risk: "none",
      riskReason: "",
    });
    setCached(SESSION, diff, {
      summary: "Second.",
      risk: "low",
      riskReason: "Updated.",
    });

    const cached = getCached(SESSION, diff);
    expect(cached?.summary).toBe("Second.");
    expect(cached?.risk).toBe("low");
  });

  it("clearCache removes the session file", () => {
    setCached(SESSION, "x", {
      summary: "ok",
      risk: "none",
      riskReason: "",
    });
    expect(existsSync(getCacheFilePath(SESSION))).toBe(true);

    clearCache(SESSION);
    expect(existsSync(getCacheFilePath(SESSION))).toBe(false);
  });

  it("handles missing cache file gracefully on get", () => {
    const uniqueSession = "never-written-" + Date.now();
    const result = getCached(uniqueSession, "x");
    expect(result).toBeUndefined();
  });
});
