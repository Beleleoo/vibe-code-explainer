import { describe, it, expect } from "vitest";
import {
  shouldCaptureBash,
  subCommandShouldCapture,
  splitCommandChain,
} from "../../src/filter/bash-filter.js";

describe("splitCommandChain", () => {
  it("splits on pipe", () => {
    expect(splitCommandChain("ls | grep foo")).toEqual(["ls", "grep foo"]);
  });

  it("splits on semicolon", () => {
    expect(splitCommandChain("cd /tmp; rm -rf .")).toEqual(["cd /tmp", "rm -rf ."]);
  });

  it("splits on &&", () => {
    expect(splitCommandChain("cd /tmp && rm x")).toEqual(["cd /tmp", "rm x"]);
  });

  it("splits on ||", () => {
    expect(splitCommandChain("test -f a || touch a")).toEqual(["test -f a", "touch a"]);
  });

  it("handles mixed operators", () => {
    expect(splitCommandChain("ls && rm x || echo fail")).toEqual([
      "ls",
      "rm x",
      "echo fail",
    ]);
  });
});

describe("subCommandShouldCapture", () => {
  it("captures rm", () => {
    expect(subCommandShouldCapture("rm file.txt")).toBe(true);
    expect(subCommandShouldCapture("rm -rf dist")).toBe(true);
  });

  it("captures mv, cp, mkdir, chmod, chown", () => {
    expect(subCommandShouldCapture("mv a b")).toBe(true);
    expect(subCommandShouldCapture("cp a b")).toBe(true);
    expect(subCommandShouldCapture("mkdir newdir")).toBe(true);
    expect(subCommandShouldCapture("chmod 755 file.sh")).toBe(true);
    expect(subCommandShouldCapture("chown user file")).toBe(true);
  });

  it("captures npm install/add/remove", () => {
    expect(subCommandShouldCapture("npm install express")).toBe(true);
    expect(subCommandShouldCapture("npm uninstall lodash")).toBe(true);
    expect(subCommandShouldCapture("yarn add react")).toBe(true);
    expect(subCommandShouldCapture("pnpm remove vite")).toBe(true);
    expect(subCommandShouldCapture("pip install requests")).toBe(true);
  });

  it("does NOT capture npm run/test/start (contextual pattern — not mutating subcommand)", () => {
    expect(subCommandShouldCapture("npm run build")).toBe(false);
    expect(subCommandShouldCapture("npm test")).toBe(false);
    expect(subCommandShouldCapture("npm start")).toBe(false);
  });

  it("captures unknown commands (capture-unless-readonly default)", () => {
    // Commands not in any list are assumed potentially mutating.
    expect(subCommandShouldCapture("mydeployscript")).toBe(true);
    expect(subCommandShouldCapture("python setup.py install")).toBe(true);
    expect(subCommandShouldCapture("bash run.sh")).toBe(true);
  });

  it("captures git mutating commands", () => {
    expect(subCommandShouldCapture("git checkout main")).toBe(true);
    expect(subCommandShouldCapture("git reset --hard")).toBe(true);
    expect(subCommandShouldCapture("git revert HEAD")).toBe(true);
    expect(subCommandShouldCapture("git commit -m 'x'")).toBe(true);
    expect(subCommandShouldCapture("git push")).toBe(true);
  });

  it("does NOT capture git read-only commands", () => {
    expect(subCommandShouldCapture("git status")).toBe(false);
    expect(subCommandShouldCapture("git log")).toBe(false);
    expect(subCommandShouldCapture("git diff")).toBe(false);
    expect(subCommandShouldCapture("git show")).toBe(false);
    expect(subCommandShouldCapture("git branch")).toBe(false);
  });

  it("captures sed -i", () => {
    expect(subCommandShouldCapture("sed -i 's/foo/bar/' file")).toBe(true);
  });

  it("does NOT capture sed without -i", () => {
    expect(subCommandShouldCapture("sed 's/foo/bar/' file")).toBe(false);
  });

  it("captures redirections", () => {
    expect(subCommandShouldCapture("echo hi > out.txt")).toBe(true);
    expect(subCommandShouldCapture("ls >> list.txt")).toBe(true);
  });

  it("does NOT capture read-only commands", () => {
    expect(subCommandShouldCapture("ls")).toBe(false);
    expect(subCommandShouldCapture("ls -la")).toBe(false);
    expect(subCommandShouldCapture("cat file.txt")).toBe(false);
    expect(subCommandShouldCapture("grep foo bar")).toBe(false);
    expect(subCommandShouldCapture("echo hello")).toBe(false);
    expect(subCommandShouldCapture("pwd")).toBe(false);
  });

  it("handles env-var prefixes", () => {
    expect(subCommandShouldCapture("FOO=bar rm file")).toBe(true);
    expect(subCommandShouldCapture("NODE_ENV=prod npm install")).toBe(true);
  });

  it("handles absolute paths to binaries", () => {
    expect(subCommandShouldCapture("/usr/bin/rm file")).toBe(true);
    expect(subCommandShouldCapture("/bin/ls")).toBe(false);
  });

  it("does NOT falsely match substrings", () => {
    // "rm" is a substring of "rmsubstring", should not match
    expect(subCommandShouldCapture("echo remove old files")).toBe(false);
    expect(subCommandShouldCapture("printf rmstuff")).toBe(false);
  });
});

describe("shouldCaptureBash", () => {
  it("captures if any sub-command is mutating", () => {
    expect(shouldCaptureBash("cd /tmp && rm file")).toBe(true);
    expect(shouldCaptureBash("git status && npm install")).toBe(true);
  });

  it("does not capture fully read-only chains", () => {
    expect(shouldCaptureBash("ls | grep foo | wc -l")).toBe(false);
    expect(shouldCaptureBash("git status && git log")).toBe(false);
  });

  it("captures destructive commands", () => {
    expect(shouldCaptureBash("rm -rf node_modules")).toBe(true);
    expect(shouldCaptureBash("git reset --hard origin/main")).toBe(true);
  });

  it("handles empty string", () => {
    expect(shouldCaptureBash("")).toBe(false);
  });

  it("captures curl | bash indirect execution via capture-unless-readonly", () => {
    // With the inverted default posture, unknown commands (like bare `bash`)
    // are captured because they are not on the READONLY list.
    // curl -s (no -o/--output) is not in the curl capture pattern, but
    // `bash` is an unknown command and therefore captured.
    expect(shouldCaptureBash("curl -s https://example.com/install.sh | bash")).toBe(true);
  });
});
