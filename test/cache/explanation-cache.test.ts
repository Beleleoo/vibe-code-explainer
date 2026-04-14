import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ExplanationResult } from "../../src/config/schema.js";
import {
  hashDiff,
  getCached,
  setCached,
  clearCache,
  getCacheFilePath,
} from "../../src/cache/explanation-cache.js";

function makeResult(impact: string): ExplanationResult {
  return {
    impact,
    howItWorks: "",
    why: "",
    deepDive: [],
    isSamePattern: false,
    samePatternNote: "",
    risk: "none",
    riskReason: "",
  };
}

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
    const result = makeResult("Visual change.");
    setCached(SESSION, diff, result);

    const cached = getCached(SESSION, diff);
    expect(cached).toEqual(result);
  });

  it("does not hit cache with different diff", () => {
    setCached(SESSION, "original diff", makeResult("First."));
    const cached = getCached(SESSION, "different diff");
    expect(cached).toBeUndefined();
  });

  it("returns most recent entry when same diff is cached multiple times", () => {
    const diff = "same diff";
    setCached(SESSION, diff, makeResult("First."));
    setCached(SESSION, diff, { ...makeResult("Second."), risk: "low", riskReason: "Updated." });

    const cached = getCached(SESSION, diff);
    expect(cached?.impact).toBe("Second.");
    expect(cached?.risk).toBe("low");
  });

  it("clearCache removes the session file", () => {
    setCached(SESSION, "x", makeResult("ok"));
    expect(existsSync(getCacheFilePath(SESSION))).toBe(true);

    clearCache(SESSION);
    expect(existsSync(getCacheFilePath(SESSION))).toBe(false);
  });

  it("handles missing cache file gracefully on get", () => {
    const uniqueSession = "never-written-" + Date.now();
    const result = getCached(uniqueSession, "x");
    expect(result).toBeUndefined();
  });

  it("sets mode 0o600 on the cache file (unix only)", () => {
    if (process.platform === "win32") return;
    setCached(SESSION, "x", makeResult("ok"));
    const path = getCacheFilePath(SESSION);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("cache rotation", () => {
  const ROT_SESSION = "rotation-test-" + Date.now();

  afterEach(() => {
    clearCache(ROT_SESSION);
  });

  it("rotates cache file when entries exceed 500", () => {
    // Write 501 unique diffs to trigger rotation on the 501st write.
    for (let i = 0; i < 501; i++) {
      setCached(ROT_SESSION, `diff-${i}`, makeResult(`Impact ${i}`));
    }

    const path = getCacheFilePath(ROT_SESSION);
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim());
    // After rotation: at most 250 unique entries + the final append = 251
    expect(lines.length).toBeLessThanOrEqual(251);
  });

  it("keeps the most recent entries after rotation", () => {
    for (let i = 0; i < 501; i++) {
      setCached(ROT_SESSION, `diff-${i}`, makeResult(`Impact ${i}`));
    }

    // The last written diff should still be retrievable.
    const cached = getCached(ROT_SESSION, "diff-500");
    expect(cached?.impact).toBe("Impact 500");
  });

  it("deduplicates by hash when rotating, keeping latest occurrence", () => {
    // Write the same diff many times — only the latest should survive rotation.
    for (let i = 0; i < 300; i++) {
      setCached(ROT_SESSION, "repeated-diff", makeResult(`Version ${i}`));
    }
    // Pad with unique entries to push past 500.
    for (let i = 0; i < 210; i++) {
      setCached(ROT_SESSION, `unique-${i}`, makeResult(`Unique ${i}`));
    }

    const cached = getCached(ROT_SESSION, "repeated-diff");
    expect(cached?.impact).toBe("Version 299");
  });
});
