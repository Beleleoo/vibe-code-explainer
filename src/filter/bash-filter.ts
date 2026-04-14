/**
 * Bash command filter — decides whether a Bash command should trigger an
 * explanation. Filters to filesystem-mutating and state-changing commands
 * while skipping read-only operations.
 */

// Commands that modify filesystem or project state.
const MUTATING_COMMANDS = new Set([
  "rm",
  "mv",
  "cp",
  "mkdir",
  "rmdir",
  "chmod",
  "chown",
  "ln",
  "touch",
  "dd",
]);

// Commands that need a specific subcommand/flag to be mutating.
const CONTEXTUAL_COMMANDS: Record<string, RegExp> = {
  npm: /\b(install|add|remove|uninstall|update|ci|link|unlink|init|publish)\b/,
  yarn: /\b(add|remove|install|upgrade|init|publish|link|unlink)\b/,
  pnpm: /\b(add|remove|install|update|link|unlink|publish)\b/,
  pip: /\b(install|uninstall)\b/,
  pip3: /\b(install|uninstall)\b/,
  brew: /\b(install|uninstall|reinstall|upgrade|link|unlink|tap|untap)\b/,
  apt: /\b(install|remove|purge|upgrade|update)\b/,
  "apt-get": /\b(install|remove|purge|upgrade|update)\b/,
  git: /\b(checkout|reset|revert|rebase|merge|commit|push|pull|clean|stash|rm|mv|init|clone|cherry-pick|restore|switch)\b/,
  sed: /(?:^|\s)-i\b/,
  curl: /(?:^|\s)-[a-zA-Z]*o\b|--output\b/,
  wget: /.*/,
  tar: /(?:^|\s)-[a-zA-Z]*x\b|--extract\b|(?:^|\s)-[a-zA-Z]*c\b|--create\b/,
  unzip: /.*/,
  docker: /\b(run|build|push|pull|rm|rmi|exec|start|stop|kill)\b/,
  make: /.*/,
  cargo: /\b(build|run|install|add|remove|update|publish)\b/,
  go: /\b(build|install|get|mod)\b/,
  bun: /\b(install|add|remove|run|build|init|create|link|unlink)\b/,
  deno: /\b(install|compile|bundle|run)\b/,
};

// Commands that are always read-only and never trigger.
const READONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "which",
  "whereis",
  "type",
  "echo",
  "printf",
  "pwd",
  "whoami",
  "id",
  "date",
  "uname",
  "df",
  "du",
  "ps",
  "top",
  "htop",
  "stat",
  "file",
  "wc",
  "sort",
  "uniq",
  "diff",
  "man",
  "help",
  "history",
  "tree",
  "less",
  "more",
  "env",
  "printenv",
  "test",
  "true",
  "false",
]);

/**
 * Split a command string on pipe, semicolon, and logical operators.
 * Returns each sub-command with leading whitespace trimmed.
 */
export function splitCommandChain(command: string): string[] {
  // Split on unquoted chain operators. A simple split is good enough for
  // the vibe-coder case; we explicitly do not handle exotic quoting.
  return command
    .split(/(?:\|\||&&|[|;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check if a single sub-command (e.g., "rm file.txt") should trigger.
 */
export function subCommandShouldCapture(subCmd: string): boolean {
  // Detect redirections (> or >>) — always capture.
  if (/(?<!\d)>>?(?!\d)/.test(subCmd)) {
    // Bare redirections like `ls > out.txt` still count as mutating.
    return true;
  }

  const tokens = subCmd.trim().split(/\s+/);
  if (tokens.length === 0) return false;

  // Skip env-var assignments like `FOO=bar cmd`.
  let idx = 0;
  while (idx < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[idx])) {
    idx++;
  }
  const head = tokens[idx];
  if (!head) return false;

  // Strip leading path (e.g., /usr/bin/rm -> rm).
  const bin = head.split(/[/\\]/).pop() ?? head;

  if (READONLY_COMMANDS.has(bin)) return false;
  if (MUTATING_COMMANDS.has(bin)) return true;

  const contextPattern = CONTEXTUAL_COMMANDS[bin];
  if (contextPattern) {
    const rest = tokens.slice(idx + 1).join(" ");
    return contextPattern.test(rest);
  }

  return false;
}

/**
 * Decide whether a full command string should trigger a code-explainer
 * explanation. Returns true if ANY sub-command in the chain is mutating.
 */
export function shouldCaptureBash(command: string): boolean {
  const parts = splitCommandChain(command);
  return parts.some((p) => subCommandShouldCapture(p));
}
