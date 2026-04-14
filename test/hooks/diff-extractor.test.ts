import { describe, it, expect } from "vitest";
import {
  matchesGlob,
  isExcluded,
  buildDiffFromEdit,
  buildDiffFromMultiEdit,
} from "../../src/hooks/diff-extractor.js";

describe("buildDiffFromEdit", () => {
  it("produces a unified diff with - and + lines for a single-line change", () => {
    const result = buildDiffFromEdit("foo.ts", "return 42;", "return 43;");
    expect(result.kind).toBe("diff");
    if (result.kind === "diff") {
      expect(result.content).toContain("-return 42;");
      expect(result.content).toContain("+return 43;");
      expect(result.content).toContain("foo.ts");
    }
  });

  it("handles multi-line old_string and new_string", () => {
    const result = buildDiffFromEdit(
      "foo.ts",
      "function foo() {\n  return 1;\n}",
      "function foo() {\n  return 2;\n  console.log('hi');\n}"
    );
    expect(result.kind).toBe("diff");
    if (result.kind === "diff") {
      expect(result.content).toContain("-function foo() {");
      expect(result.content).toContain("-  return 1;");
      expect(result.content).toContain("+  return 2;");
      expect(result.content).toContain("+  console.log('hi');");
    }
  });

  it("returns empty when both strings are empty", () => {
    const result = buildDiffFromEdit("foo.ts", "", "");
    expect(result.kind).toBe("empty");
  });

  it("handles insertion (empty old_string)", () => {
    const result = buildDiffFromEdit("foo.ts", "", "new line");
    expect(result.kind).toBe("diff");
    if (result.kind === "diff") {
      expect(result.content).toContain("+new line");
      // No - lines since old was empty
      expect(result.content).not.toMatch(/\n-/);
    }
  });
});

describe("buildDiffFromMultiEdit", () => {
  it("combines multiple edits into one diff with hunk markers", () => {
    const result = buildDiffFromMultiEdit("foo.ts", [
      { old_string: "const a = 1;", new_string: "const a = 2;" },
      { old_string: "const b = 3;", new_string: "const b = 4;" },
    ]);
    expect(result.kind).toBe("diff");
    if (result.kind === "diff") {
      expect(result.content).toContain("@@ Edit 1 of 2 @@");
      expect(result.content).toContain("@@ Edit 2 of 2 @@");
      expect(result.content).toContain("-const a = 1;");
      expect(result.content).toContain("+const a = 2;");
      expect(result.content).toContain("-const b = 3;");
      expect(result.content).toContain("+const b = 4;");
    }
  });

  it("returns empty when edits array is empty", () => {
    const result = buildDiffFromMultiEdit("foo.ts", []);
    expect(result.kind).toBe("empty");
  });
});

describe("matchesGlob", () => {
  it("matches exact file names", () => {
    expect(matchesGlob("package-lock.json", "package-lock.json")).toBe(true);
    expect(matchesGlob("foo.json", "package-lock.json")).toBe(false);
  });

  it("matches *.ext pattern", () => {
    expect(matchesGlob("package-lock.json", "*.lock")).toBe(false);
    expect(matchesGlob("yarn.lock", "*.lock")).toBe(true);
    expect(matchesGlob("deps.lock", "*.lock")).toBe(true);
  });

  it("matches nested files with *.ext in any subdir", () => {
    expect(matchesGlob("app/yarn.lock", "*.lock")).toBe(true);
    expect(matchesGlob("src/deep/nested.lock", "*.lock")).toBe(true);
  });

  it("matches ** prefix patterns", () => {
    expect(matchesGlob("dist/index.js", "dist/**")).toBe(true);
    expect(matchesGlob("dist/assets/a.js", "dist/**")).toBe(true);
    expect(matchesGlob("src/index.js", "dist/**")).toBe(false);
  });

  it("matches node_modules patterns", () => {
    expect(matchesGlob("node_modules/react/index.js", "node_modules/**")).toBe(true);
    expect(matchesGlob("src/node_modules_copy/a.js", "node_modules/**")).toBe(false);
  });

  it("handles windows-style backslashes", () => {
    expect(matchesGlob("dist\\index.js", "dist/**")).toBe(true);
  });
});

describe("isExcluded", () => {
  const patterns = ["*.lock", "dist/**", "node_modules/**", "*.generated.*"];

  it("excludes lock files", () => {
    expect(isExcluded("yarn.lock", patterns)).toBe(true);
    expect(isExcluded("package-lock.json", patterns)).toBe(false); // not *.lock
  });

  it("excludes dist/**", () => {
    expect(isExcluded("dist/app.js", patterns)).toBe(true);
    expect(isExcluded("src/app.js", patterns)).toBe(false);
  });

  it("excludes generated files", () => {
    expect(isExcluded("schema.generated.ts", patterns)).toBe(true);
  });

  it("does not exclude regular source files", () => {
    expect(isExcluded("src/app.tsx", patterns)).toBe(false);
    expect(isExcluded("README.md", patterns)).toBe(false);
  });
});
