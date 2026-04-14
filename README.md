# vibe-code-explainer

**Real-time diff explanations for vibe coders using Claude Code.**

Every time Claude Code edits a file, creates a file, or runs a destructive
command, vibe-code-explainer prints a plain-English explanation in your terminal
before Claude continues. Catches unrelated changes, flags risky edits, and makes
AI-generated code readable for people who can't read diffs.

No more accepting code blindly.

---

## Example output

**Safe change (low/no risk):**

```
╭─ vibe-code-explainer ─────────────────────────╮
│                                                 │
│  📄  src/app/page.tsx                           │
│                                                 │
│  ▸ Impact                                       │
│    Changed page background from solid dark      │
│    blue to a gradient.                          │
│                                                 │
│  ▸ How it works                                 │
│    `bg-gradient-to-br` + `from-`/`to-` Tailwind │
│    utilities generate a CSS linear-gradient.    │
│                                                 │
│  ▸ Why                                          │
│    Tailwind: utility classes for gradients      │
│    instead of writing custom CSS.               │
│                                                 │
│  ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄  │
│                                                 │
│  ✓  Risk: None                                  │
│                                                 │
╰─────────────────────────────────────────────────╯
```

**Risky change (medium/high risk):**

```
╭─ vibe-code-explainer ─────────────────────────╮       ← red border
│                                                 │
│  📄  .env                                       │
│                                                 │
│  ▸ Impact                                       │
│    Added a Stripe payment secret key directly   │
│    in the environment file.                     │
│                                                 │
│  ▸ How it works                                 │
│    `.env` files store environment variables,    │
│    read by your code at runtime. `sk_live_`     │
│    is Stripe's prefix for production keys.      │
│                                                 │
│  ▸ Why                                          │
│    Convention: secrets live in .env files that  │
│    are kept out of git via .gitignore.          │
│                                                 │
│  ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄ ─ ┄  │
│                                                 │
│  🚨  Risk: High                                 │
│      A live Stripe production key is hardcoded. │
│      Make sure .env is in .gitignore before     │
│      committing.                                │
│                                                 │
╰─────────────────────────────────────────────────╯
```

---

## ⚠️ Compatibility: Claude Code CLI only

**Hooks currently only fire when you use Claude Code in a terminal (CLI).** The
VS Code extension and Desktop App ignore PostToolUse hooks as of Claude Code
v2.1.105 (April 2026). This is a known bug on Anthropic's side, tracked in:

- [anthropics/claude-code#21736](https://github.com/anthropics/claude-code/issues/21736)
- [anthropics/claude-code#27014](https://github.com/anthropics/claude-code/issues/27014)
- [anthropics/claude-code#42336](https://github.com/anthropics/claude-code/issues/42336)

If you are using the Claude Code extension in VS Code and want explanations to
appear, **open an external terminal** (PowerShell, CMD, Git Bash on Windows;
Terminal.app on macOS; your favorite terminal on Linux) and run `claude` from
there. Explanations will appear in that terminal.

As soon as Anthropic ships the fix, this tool will work in the extension too
with no changes on your side.

---

## Install

### 1. Prerequisites

- **Node.js 20 or newer** — already required by Claude Code, so you probably
  have it. Check with `node --version`.
- **Claude Code** — the CLI. If you don't have it, get it from
  [claude.com/code](https://www.claude.com/code).
- **Ollama** (optional) — only if you want to use the local LLM engine. The
  installer will offer to install it for you. Get it from
  [ollama.com](https://ollama.com).

### 2. Run the installer

In your terminal:

```bash
cd path/to/your/project   # or stay in your home directory for a global install
npx vibe-code-explainer init
```

The installer is interactive and walks you through six steps:

#### 1. Install scope: project or global

- **This project only** — hooks live in `.claude/settings.local.json` and the
  config in `./code-explainer.config.json`. Only this project's Claude Code
  sessions get explanations. Best if you only want it in one place or if
  different projects need different settings.
- **Globally (every project)** — hooks live in `~/.claude/settings.json`
  (your user-level Claude Code config) and the config in
  `~/.code-explainer.config.json`. **Every** Claude Code session on your
  machine gets explanations automatically, no per-project setup needed.
  The package is installed once via `npm install -g`.

A project config always takes precedence over the global config if both
exist, so you can set a global default and override per-project.

#### 2. Engine

- **Local LLM (Ollama)** — free, private, works offline. Your code never
  leaves your machine.
- **Claude Code (native)** — uses `claude -p` under the hood for the
  highest-quality explanations and unrelated-change detection. Costs API
  tokens per explanation.

#### 3. Detail level

This is also the **teacher mode** switch:

- **Minimal** — single sentence describing the impact. **No teaching.** Use
  this if you just want to know what changed without any educational content.
- **Standard** — three sections per change: **Impact** (what changes for the
  user), **How it works** (mechanical explanation of the syntax/concept),
  **Why** (why this approach was used). Recommended.
- **Verbose** — same three sections, each more in-depth (2–4 sentences).
  Plus a fourth **Deeper dive** section with related terms to look up.

#### 4. Language

Pick the language the explanations are written in. Supported:

English, Portuguese, Spanish, French, German, Italian, Chinese, Japanese,
Korean.

Only the natural-language fields (impact, howItWorks, why, deepDive items,
riskReason) are translated. JSON keys and risk labels (`none` / `low` /
`medium` / `high`) stay in English so parsing stays stable.

#### 5. Programming knowledge level (only when teaching is on)

If you picked Standard or Verbose, the installer asks how much you already
know about programming. This calibrates the depth of the teaching:

- **Never programmed** — explanations start from "what is a variable" when
  needed. Uses everyday-life analogies.
- **Just starting out** — explains new technical terms, doesn't re-teach
  basics like variables and functions.
- **Read code with difficulty** — assumes core concepts, focuses on idiomatic
  patterns and what specific syntax accomplishes.
- **Code regularly** — concise. Mentions modern features, gotchas, and
  alternatives rather than syntax basics.

#### 6. Model (Ollama only)

- If you have an NVIDIA GPU, the installer auto-detects your VRAM and picks
  the right model.
- Otherwise, you get a chooser with VRAM hints:

  | Model | Recommended for | Notes |
  |-------|-----------------|-------|
  | `qwen3.5:4b` | ≤ 8 GB VRAM | newest (Mar 2026), fastest, ~3.4 GB |
  | `qwen2.5-coder:7b` | ≤ 8 GB VRAM | code-specialized, ~4.7 GB |
  | `qwen3.5:9b` | 8–12 GB VRAM | newest, general-purpose, ~6.6 GB |
  | `qwen2.5-coder:14b` | 12–16 GB VRAM | code-specialized, ~9 GB |
  | `qwen3.5:27b` | 16–24 GB VRAM | newest, ~17 GB |
  | `qwen2.5-coder:32b` | ≥ 24 GB VRAM | best code quality, ~19 GB |

  Pick whichever matches your hardware. The newer `qwen3.5` family (released
  March 2026) is general-purpose with strong coding ability. The
  `qwen2.5-coder` family is code-specialized and remains a solid choice.

#### 6. Pull the model + warmup (Ollama only)

The installer runs `ollama pull <model>` and shows the real download progress
bar. Then it sends a trivial warmup diff so the first real explanation is
fast (otherwise the model has to load into VRAM on first use, which can take
10–15 seconds).

Skip the warmup with:

```bash
npx vibe-code-explainer init --skip-warmup
```

When the installer finishes, you're ready to go. Next time you run `claude`
in a directory covered by this install, you'll see explanations.

---

## Using it

Open Claude Code in a terminal, in the project where you installed it:

```bash
cd path/to/your/project
claude
```

Ask Claude to do anything that edits files or runs destructive commands:

```
> create a hello.ts with a function that prints "hi"
```

An explanation box appears in the Claude Code chat right after each file write,
edit, or destructive Bash command.

### What gets explained

- **Edits** to existing files (via the `Edit` tool)
- **New files** (via the `Write` tool)
- **Multi-edits** (via the `MultiEdit` tool)
- **Destructive Bash commands** such as `rm`, `mv`, `cp`, `mkdir`, `chmod`,
  `chown`, `git checkout`, `git reset`, `git revert`, `sed -i`,
  `npm install`, `pip install`, `yarn add`, `pnpm add`, and output
  redirections (`>`, `>>`).

### What gets skipped

- Read-only Bash commands (`ls`, `cat`, `grep`, `git status`, `git log`, etc.)
- Binary files
- Empty diffs (no actual change)
- Files matching your `exclude` patterns (default: `*.lock`, `dist/**`,
  `node_modules/**`)

### Risk levels

Every explanation includes a risk rating:

| Level | Meaning |
|-------|---------|
| ✅ **None** | Visual/text changes, styling, comments, formatting, whitespace |
| ⚠️ **Low** | Config files, new dependencies, file renames, test changes |
| ⚠️ **Medium** | Authentication, payment code, API keys, database schema, env vars |
| 🚨 **High** | Removing security checks, hardcoded secrets, disabling validation |

---

## Configuration

Change any setting at any time by running `config`. Which command depends on
how you installed it:

**If you installed globally** (the package is on your PATH):

```bash
vibe-code-explainer config
```

**If you installed per-project** (or want to be safe):

```bash
npx vibe-code-explainer config
```

Both commands do the same thing. Use whichever works in your shell. If you
see a stale version run via `npx`, force the latest with:

```bash
npx vibe-code-explainer@latest config
```

The menu auto-detects whether to edit the project config (`./code-explainer.config.json`)
or the global config (`~/.code-explainer.config.json`): project config wins
if both exist.

It opens an interactive menu showing your current settings. Pick what you
want to change, one at a time. Every change is saved immediately. When you
change the model, the tool checks whether Ollama already has it pulled and
offers to download it on the spot if not.

```
code-explainer config (project)

Current settings:
  Engine:         Local LLM (Ollama)
  Model:          qwen3.5:4b
  Ollama URL:     http://localhost:11434
  Detail level:   standard
  Language:       English
  Learner level:  Read code with difficulty
  Hooks:          Edit ✓  Write ✓  Bash ✓
  Excluded:       *.lock, dist/**, node_modules/**
  Skip if slow:   Never skip

? What would you like to change?
  ❯ Engine
    Model
    Ollama URL
    Detail level
    Language
    Learner level
    Enable/disable hooks
    File exclusions
    Latency timeout
    Back (save and exit)
```

If you installed globally, `config` edits `~/.code-explainer.config.json`.
If you installed per-project, it edits `./code-explainer.config.json`.
If both exist, the project config takes precedence at runtime.

### Configurable options

- **Engine** — swap between Ollama (local) and Claude Code (native). Switching
  to Claude Code requires the `claude` CLI to be authenticated.
- **Model** — pick a different Ollama model. The VRAM hints are visible in
  the chooser. You can also set any model name Ollama supports by editing the
  JSON file directly (e.g., `deepseek-coder-v2:16b`).
- **Ollama URL** — defaults to `http://localhost:11434`. Change this if you
  run Ollama in a Docker container on a different port, or on a separate
  machine. Non-loopback URLs trigger a security warning because your code
  would be sent over the network.
- **Detail level** — minimal / standard / verbose. See
  [Install → Detail level](#3-detail-level) for what each produces.
- **Language** — English, Portuguese, Spanish, French, German, Italian,
  Chinese, Japanese, Korean. Applies to the natural-language fields (impact,
  howItWorks, why, deepDive, riskReason); JSON keys and risk labels stay in
  English.
- **Learner level** — calibrates teaching depth. Options: never programmed /
  just starting / read code with difficulty / code regularly. See
  [Install → step 5](#5-programming-knowledge-level-only-when-teaching-is-on).
- **Hooks** — turn on or off individually. If Bash explanations feel noisy,
  disable just that hook and keep Edit + Write.
- **File exclusions** — glob patterns for files you never want explained.
  Defaults cover lockfiles, build output, and dependencies. Add patterns like
  `*.generated.*` if your project has codegen.
- **Latency timeout** — maximum time to wait for an explanation before
  skipping it. Options: 5s (aggressive), 8s (balanced), 15s (patient), or
  never skip (default — explanations always wait until the engine responds).

### Editing the config file directly

If you prefer editing JSON manually:

- **Project install:** edit `code-explainer.config.json` in your project root.
- **Global install:** edit `~/.code-explainer.config.json` in your home
  directory.

Full config schema:

```json
{
  "engine": "ollama",
  "ollamaModel": "qwen3.5:4b",
  "ollamaUrl": "http://localhost:11434",
  "detailLevel": "standard",
  "language": "en",
  "learnerLevel": "intermediate",
  "hooks": {
    "edit": true,
    "write": true,
    "bash": true
  },
  "exclude": ["*.lock", "dist/**", "node_modules/**"],
  "skipIfSlowMs": 0,
  "bashFilter": {
    "capturePatterns": [
      "rm", "mv", "cp", "mkdir",
      "npm install", "pip install", "yarn add", "pnpm add",
      "chmod", "chown",
      "git checkout", "git reset", "git revert",
      "sed -i"
    ]
  }
}
```

Field types:

| Field | Values |
|-------|--------|
| `engine` | `"ollama"` or `"claude"` |
| `ollamaModel` | Any model tag available on your Ollama install |
| `ollamaUrl` | Any valid URL (warns on non-loopback) |
| `detailLevel` | `"minimal"` / `"standard"` / `"verbose"` |
| `language` | `"en"` / `"pt"` / `"es"` / `"fr"` / `"de"` / `"it"` / `"zh"` / `"ja"` / `"ko"` |
| `learnerLevel` | `"none"` / `"beginner"` / `"intermediate"` / `"regular"` |
| `hooks.edit` / `hooks.write` / `hooks.bash` | `true` or `false` |
| `exclude` | Array of glob patterns |
| `skipIfSlowMs` | Number in milliseconds; `0` means never skip |

Changes take effect on the next Claude Code tool call — no restart needed.

---

## Session tools

All commands below accept both forms: `vibe-code-explainer <cmd>` (if
globally installed, on PATH) or `npx vibe-code-explainer <cmd>` (if per-project).

### Summary of what Claude has done

```bash
vibe-code-explainer summary
# or: npx vibe-code-explainer summary
```

Prints a report of every explained change in your current Claude Code session:
total changes, files touched, risk breakdown, and flagged unrelated files.

### Clear the session

```bash
vibe-code-explainer session end
# or: npx vibe-code-explainer session end
```

Clears the session state (tracked files and cache). Run this when you start a
new task so the drift-detection summary doesn't include old edits.

### Warm up the model

```bash
vibe-code-explainer warmup
# or: npx vibe-code-explainer warmup
```

Sends a trivial diff to Ollama to pre-load the model. Useful if you closed and
reopened Ollama — the first real explanation afterwards would otherwise be
slow (10–15 seconds) as the model gets loaded into VRAM.

---

## Uninstall

```bash
vibe-code-explainer uninstall
# or: npx vibe-code-explainer uninstall
```

The uninstaller auto-detects whether you have a project install, a global
install, or both. If both exist, it asks which to remove.

**Project uninstall:** removes the PostToolUse hook entries from
`.claude/settings.local.json` and deletes `code-explainer.config.json`. Other
entries (hooks from other tools, other settings) are preserved.

**Global uninstall:** removes the PostToolUse hooks from
`~/.claude/settings.json` and deletes `~/.code-explainer.config.json`. The
globally-installed npm package stays on disk — remove it with:

```bash
npm uninstall -g vibe-code-explainer
```

Ollama and any pulled models stay installed either way. To remove them:

```bash
ollama rm qwen3.5:4b
# or whichever model you pulled
```

---

## Troubleshooting

### The box doesn't appear after an edit

Most common causes, in order:

1. **You're using the VS Code extension or Desktop App.** Hooks don't fire
   there yet. See [Compatibility](#️-compatibility-claude-code-cli-only)
   above. Use the terminal CLI.
2. **Ollama is not running.** Start it in a separate terminal:
   ```bash
   ollama serve
   ```
   Then try another edit.
3. **The engine is misconfigured.** Run `vibe-code-explainer config` (or
   `npx vibe-code-explainer config`) and check the engine and URL. Try
   switching to the Claude Code engine as a test — if that works, Ollama is
   the issue.
4. **The file is excluded.** Check your `exclude` patterns in the config.

### Claude Code feels slow because it's waiting for explanations

By default, code-explainer never skips — every explanation waits for the
engine to finish so you don't lose context. With Ollama, that can be 10–15s
on cold start, then 2–5s for normal explanations.

If the wait is bothering you:

- Run `vibe-code-explainer warmup` after starting Ollama, so the first
  explanation is fast.
- Set a timeout via `vibe-code-explainer config → Latency timeout`. Options:
  5s (aggressive), 8s (balanced), 15s (patient). Anything that takes longer
  is skipped with a notice instead of blocking Claude Code.

### Explanations are low-quality

Ollama with a 7B model has real limits for complex code (authentication flows,
business logic, security-relevant changes). If explanations feel wrong on
tricky diffs, switch to the Claude Code engine:

```bash
vibe-code-explainer config
# → Engine → Claude Code (native)
```

This uses `claude -p` under the hood and produces much better output, at the
cost of API tokens per explanation.

### I want to skip explanations for a specific file type

Add a glob pattern via the config menu:

```
vibe-code-explainer config → File exclusions → Add a pattern
```

For example, `*.md` to skip all markdown files, or `src/generated/**` to skip
a whole directory.

### I want to turn off Bash explanations but keep Edit/Write

```
vibe-code-explainer config → Enable/disable hooks
```

Uncheck Bash, keep Edit and Write checked.

---

## How it actually works

`vibe-code-explainer` is a Claude Code PostToolUse hook. When Claude Code runs
a tool (Edit, Write, MultiEdit, Bash), the hook script is invoked with the
tool payload on stdin. The script:

1. Reads the payload (file path, old string, new string, or Bash command).
2. Extracts a unified-style diff directly from the payload's old/new strings.
3. Checks the diff against a local SHA-256 cache so repeated diffs don't
   re-query the engine.
4. Checks whether the change is "unrelated" to the session so far based on
   directory ancestry and sensitive-path patterns (`.env`, `auth/`,
   `payment/`, etc.).
5. Sends the diff to the chosen engine with a prompt that teaches the model
   to distinguish additions, modifications, and removals.
6. Parses the JSON response (`summary`, `risk`, `riskReason`), formats it
   into a terminal box, and emits it as a `systemMessage` in the Claude Code
   chat.
7. Records the change in a per-session JSONL file under the OS temp
   directory, keyed to Claude Code's own session ID.
8. Always exits 0 so Claude Code is never blocked.

All state (config, session tracking, cache) lives either in your project
directory (config) or in a user-scoped temp directory (session, cache) with
`0600` file permissions. Nothing is written outside those paths.

---

## Safety philosophy

`vibe-code-explainer` is a **visibility tool**, not a gate. It never blocks
Claude Code, never reverts changes, never requires confirmation. If the
explanation engine fails or times out, the hook skips silently (with a small
notice) so your session keeps flowing.

For real safety, **read the explanations**, and watch for:

- 🚨 **High risk** — security checks, encryption, hardcoded secrets
- ⚠️ **Medium risk** — auth, payment, API keys, database, env vars
- **Session drift alerts** — Claude touched files unrelated to your request

When you see any of these, pause, read the diff yourself, and decide if
you trust the change. That is the entire point of this tool.

---

## License

MIT

## Contributing

Source code: https://github.com/easycao/Code-Explainer

Issues and pull requests welcome.
