# code-explainer — Project Brief

> A code review assistant for non-developers using Claude Code.

## Problem

Non-developers using Claude Code accept AI-generated code changes blindly. They cannot read diffs, spot unrelated modifications, or assess security risks. Today, only senior developers can meaningfully review what an AI agent writes. **code-explainer bridges that gap** by translating every code change into plain-language impact explanations, printed directly in the terminal.

## How It Works

1. Claude Code modifies a file (Edit, Write, or destructive Bash command)
2. A post-tool hook intercepts the change and extracts the diff
3. The diff is sent to the chosen explanation engine (local LLM or Claude Code itself)
4. A formatted explanation box is printed in the terminal before Claude Code continues

The hook is **synchronous** — Claude Code waits for the explanation before proceeding. The user reads each explanation as it appears and can manually pause or intervene if needed. No automatic pausing or confirmation prompts.

## Explanation Engines

### Local LLM (Ollama)

- Free, offline, private
- Qwen models auto-selected based on available VRAM:
  - **≤8 GB VRAM** → `qwen2.5-coder:7b`
  - **12–16 GB VRAM** → `qwen2.5-coder:14b`
  - **≥20 GB VRAM** → `qwen2.5-coder:32b`
- Explains the diff only (no conversation context)
- Risk alerts: basic (structural analysis only — e.g., detects changes to payment/auth files)

### Claude Code (Native)

- Uses the Claude Code CLI to generate the explanation
- Has full conversation context (the user's prompt, project state, task intent)
- Best explanation quality
- Consumes session tokens (trade-off: quality vs. cost)
- Risk alerts: intelligent (can detect if a change is unrelated to the user's request)

Both engines produce output in the **same visual format** inside the code-explainer box.

## Output Format

```
┌─ code-explainer ─────────────────────────────
│  src/app/homepage.tsx
│
│  - background: #1a1a2e
│  + background: linear-gradient(to-br, #0a1628, #0d2847)
│
│  → Replaces a flat dark background with a gradient.
│    Visual-only change, no logic or data affected.
│
│  Risk: ✅ None
└──────────────────────────────────────────────
```

When a risk is detected (Claude Code engine):

```
┌─ code-explainer ─────────────────────────────
│  ⚠️  src/lib/payments.ts
│
│  + const WEBHOOK_URL = "https://example.com/hook"
│
│  → Adds a hardcoded external URL to the payment module.
│    This change was NOT related to your request
│    (background color).
│
│  Risk: ⚠️  Unrelated change in sensitive file
└──────────────────────────────────────────────
```

## Hooks Coverage

| Hook      | Trigger                       | Notes                                |
| --------- | ----------------------------- | ------------------------------------ |
| **Edit**  | Every file edit               | Core — most frequent trigger         |
| **Write** | Every file creation/overwrite | Core — catches new files             |
| **Bash**  | Destructive commands only     | Filtered allowlist (see below)       |

### Bash Filter — Captured Commands

Only Bash commands that modify the filesystem or project state trigger an explanation:

- File operations: `rm`, `mv`, `cp`, `mkdir`, redirections (`>`, `>>`)
- Package managers: `npm install`, `pip install`, `yarn add`, `pnpm add`, etc.
- Permission changes: `chmod`, `chown`
- Git mutations: `git checkout`, `git reset`, `git revert`
- Stream editors: `sed -i`, `awk` (in-place)

Read-only commands (`ls`, `cat`, `grep`, `git status`, `git log`, `git diff`, etc.) are ignored.

## Installation

```bash
npx code-explainer init
```

### Init Flow

```
Welcome to code-explainer!

? Choose your explanation engine:
  ❯ Local LLM (Ollama) — free, private, works offline. Requires Ollama installed.
    Claude Code (native) — best quality, full context. Uses session tokens.

? Detail level:
  ❯ Standard — diff summary + plain-language explanation (recommended)
    Minimal — one-line impact summary per file
    Verbose — line-by-line explanation of every change

[If Local LLM selected:]
Checking Ollama installation... ✅ Found
Detecting GPU... NVIDIA RTX 3060 (8GB VRAM) detected.
Recommended model: qwen2.5-coder:7b
Pulling model via Ollama... Done.

✅ Setup complete! code-explainer is now active for this project.
```

### What `init` Does

- Detects OS and environment (Windows, Mac, Linux, WSL)
- Prompts for engine and detail level
- If Local LLM: verifies Ollama is installed, detects VRAM, pulls the right model
- Creates `code-explainer.config.json` in the project root
- Adds hooks to `.claude/settings.json` (or `.claude/settings.local.json`)
- **Brownfield-safe**: edits existing config files, never overwrites them

## Configuration

`code-explainer.config.json`:

```json
{
  "engine": "ollama",
  "ollamaModel": "qwen2.5-coder:7b",
  "detailLevel": "standard",
  "hooks": {
    "edit": true,
    "write": true,
    "bash": true
  },
  "bashFilter": {
    "capturePatterns": [
      "rm", "mv", "cp", "mkdir",
      "npm install", "pip install", "yarn add", "pnpm add",
      "chmod", "chown",
      "git checkout", "git reset", "sed -i"
    ]
  }
}
```

All fields are configurable. Users can disable specific hooks, change the engine at any time, or customize the Bash filter.

## Requirements

### Compatibility

- **OS**: Windows, macOS, Linux, WSL
- **Environment**: any terminal, VS Code integrated terminal, JetBrains terminal, Claude Desktop, any setup that runs Claude Code
- **Stack-agnostic**: works with any programming language or framework
- **Brownfield-safe**: installs into existing projects without breaking anything

### Dependencies

- **Node.js** (already required by Claude Code)
- **Ollama** (only if using Local LLM engine; init checks and guides the user)
- **Claude Code** (the tool this extends)

## Distribution

- Public npm package
- GitHub repository with README, install instructions, and config docs
- Users install via `npx code-explainer init` in any project

## Scope

### v1 (current)

- Post-Edit, post-Write, post-Bash (filtered) hooks
- Two engines: Local LLM (Ollama/Qwen) and Claude Code (native)
- VRAM auto-detection with 3 model tiers
- Formatted terminal output with diff + explanation + risk level
- 3 detail levels (minimal, standard, verbose)
- `npx code-explainer init` interactive setup
- Flexible JSON config
- Cross-platform, cross-environment, stack-agnostic

### v2 (future)

- Intelligent risk alerts for Local LLM engine
- NotebookEdit hook support
- Additional engines if viable free options emerge

### Out of Scope (permanent)

- Web dashboard or panel
- Paid API integrations (OpenAI, Gemini, etc.)
- Automatic pausing or reverting of Claude Code actions
- Any feature that requires user confirmation to continue execution
