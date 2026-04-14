import { describe, it, expect } from "vitest";
import { parseFlags, flagBool, flagString } from "../../src/cli/flags.js";

describe("parseFlags", () => {
  it("parses boolean flags", () => {
    const { flags } = parseFlags(["--json"]);
    expect(flags["json"]).toBe(true);
  });

  it("parses --flag=value", () => {
    const { flags } = parseFlags(["--output=json"]);
    expect(flags["output"]).toBe("json");
  });

  it("treats bare --flag as boolean (does not consume next arg as value)", () => {
    const { flags, positional } = parseFlags(["--output", "json", "extra"]);
    // Without =, --output is boolean; "json" and "extra" are positionals
    expect(flags["output"]).toBe(true);
    expect(positional).toEqual(["json", "extra"]);
  });

  it("parses short flags", () => {
    const { flags } = parseFlags(["-j", "-y"]);
    expect(flags["j"]).toBe(true);
    expect(flags["y"]).toBe(true);
  });

  it("separates positional args from flags", () => {
    const { flags, positional } = parseFlags(["show", "--json", "extra"]);
    expect(flags["json"]).toBe(true);
    expect(positional).toEqual(["show", "extra"]);
  });

  it("handles empty input", () => {
    const { flags, positional } = parseFlags([]);
    expect(flags).toEqual({});
    expect(positional).toEqual([]);
  });

  it("handles mixed flags and positionals", () => {
    const { flags, positional } = parseFlags(["get", "engine", "--verbose"]);
    expect(flags["verbose"]).toBe(true);
    expect(positional).toEqual(["get", "engine"]);
  });
});

describe("flagBool", () => {
  it("returns true when any listed name is present as boolean", () => {
    const { flags } = parseFlags(["--json"]);
    expect(flagBool(flags, "json", "j")).toBe(true);
  });

  it("returns true when short flag matches", () => {
    const { flags } = parseFlags(["-j"]);
    expect(flagBool(flags, "json", "j")).toBe(true);
  });

  it("returns false when none of the names are present", () => {
    const { flags } = parseFlags(["--verbose"]);
    expect(flagBool(flags, "json", "j")).toBe(false);
  });
});

describe("flagString", () => {
  it("returns the string value for a named flag", () => {
    const { flags } = parseFlags(["--output=table"]);
    expect(flagString(flags, "output")).toBe("table");
  });

  it("returns undefined for a boolean flag (no value)", () => {
    const { flags } = parseFlags(["--json"]);
    expect(flagString(flags, "json")).toBeUndefined();
  });

  it("returns undefined for an absent flag", () => {
    const { flags } = parseFlags([]);
    expect(flagString(flags, "output")).toBeUndefined();
  });
});
