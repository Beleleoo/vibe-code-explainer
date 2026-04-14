import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordEntry,
  readSession,
  getSessionFilePath,
  cleanStaleSessionFiles,
} from "../../src/session/tracker.js";
import { existsSync, statSync, utimesSync } from "node:fs";

const SESSION = "tracker-test-" + Date.now();

function cleanup(sessionId: string) {
  const path = getSessionFilePath(sessionId);
  if (existsSync(path)) {
    try {
      require("node:fs").unlinkSync(path);
    } catch {
      /* noop */
    }
  }
}

describe("recordEntry / readSession", () => {
  beforeEach(() => {
    cleanup(SESSION);
  });

  afterEach(() => {
    cleanup(SESSION);
  });

  it("records a single entry and reads it back", () => {
    recordEntry(SESSION, {
      file: "src/app.ts",
      timestamp: Date.now(),
      risk: "none",
      summary: "visual change",
    });

    const entries = readSession(SESSION);
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe("src/app.ts");
    expect(entries[0].risk).toBe("none");
  });

  it("returns empty array for non-existent session", () => {
    const entries = readSession("never-created-" + Date.now());
    expect(entries).toEqual([]);
  });

  it("aggregates multiple appended entries", () => {
    const ts = Date.now();
    recordEntry(SESSION, { file: "a.ts", timestamp: ts, risk: "none", summary: "1" });
    recordEntry(SESSION, { file: "b.ts", timestamp: ts + 1, risk: "low", summary: "2" });
    recordEntry(SESSION, { file: "c.ts", timestamp: ts + 2, risk: "medium", summary: "3" });

    const entries = readSession(SESSION);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(entries.map((e) => e.risk)).toEqual(["none", "low", "medium"]);
  });

  it("skips malformed lines and keeps valid ones", () => {
    const path = getSessionFilePath(SESSION);
    require("node:fs").appendFileSync(
      path,
      JSON.stringify({ file: "a.ts", timestamp: 1, risk: "none", summary: "ok" }) +
        "\n" +
        "not valid json\n" +
        JSON.stringify({ file: "b.ts", timestamp: 2, risk: "low", summary: "ok" }) +
        "\n"
    );

    const entries = readSession(SESSION);
    expect(entries).toHaveLength(2);
  });
});

describe("cleanStaleSessionFiles", () => {
  it("removes files older than 2 hours", () => {
    const staleId = "stale-test-" + Date.now();
    recordEntry(staleId, {
      file: "old.ts",
      timestamp: Date.now(),
      risk: "none",
      summary: "old",
    });

    const path = getSessionFilePath(staleId);
    expect(existsSync(path)).toBe(true);

    // Backdate mtime to 3 hours ago
    const threeHoursAgo = (Date.now() - 3 * 60 * 60 * 1000) / 1000;
    utimesSync(path, threeHoursAgo, threeHoursAgo);

    cleanStaleSessionFiles();

    expect(existsSync(path)).toBe(false);
  });

  it("preserves recent files", () => {
    const freshId = "fresh-test-" + Date.now();
    recordEntry(freshId, {
      file: "new.ts",
      timestamp: Date.now(),
      risk: "none",
      summary: "new",
    });

    const path = getSessionFilePath(freshId);
    cleanStaleSessionFiles();
    expect(existsSync(path)).toBe(true);

    cleanup(freshId);
  });
});
