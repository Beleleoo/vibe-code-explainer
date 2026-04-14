---
date: 2026-04-13
topic: code-explainer
---

# code-explainer — Real-time diff explanations for vibe coders

## Problem Frame

Non-developers using Claude Code (designers, PMs, founders building real products with AI) accept every AI-generated code change blindly. They cannot read diffs, spot unrelated modifications, or assess security risks. Every existing solution (PR summaries, code scanning, governance frameworks) works post-hoc, but vibe coders never read PRs. The intervention point must be during the coding session, not after it.

## Requirements

**Core Hook System**
- R1. A PostToolUse hook intercepts every Edit, Write, and Bash tool call from Claude Code
- R2. Each intercepted change is sent to an explanation engine that returns a plain-English summary and risk level
- R3. The explanation is printed as a formatted box in the terminal (stderr) before Claude Code continues
- R4. The hook is synchronous — Claude Code waits for the explanation. If the engine takes longer than the configured timeout (default 8s), the explanation is skipped and a notice is printed
- R5. The user can cancel a slow explanation with Ctrl+C without breaking Claude Code
- R6. A single hook entry point dispatches by tool name (not 3 separate hook files)

**Explanation Engines**
- R7. Ollama engine: sends the diff to a local LLM via HTTP POST to the configured Ollama URL (default `localhost:11434`). Free, offline, private. No conversation context.
- R8. Claude Code engine: runs `claude -p` with the diff and (when available) the user's original request. Can detect unrelated changes. Consumes API tokens.
- R9. When the Claude Code engine has user context, changes unrelated to the user's request are flagged as at least medium risk
- R10. Both engines output the same JSON schema: `{ "summary", "risk", "riskReason" }`. Risk levels are: `"none"` (visual, text, styling, formatting), `"low"` (config, dependencies, renames, tests), `"medium"` (auth, payment, API keys, database, env vars, security, user data), `"high"` (removing security checks, hardcoded secrets, disabling validation, encryption changes)
- R11. Three detail levels (minimal, standard, verbose), each with its own dedicated prompt template per engine

**Diff Handling**
- R12. Edit and Write hooks extract diffs via `git diff`. Write hook detects new/untracked files and sends full file content as "new file created"
- R13. Bash hook filters commands against a word-boundary allowlist (rm, mv, cp, mkdir, npm install, git reset, sed -i, etc.). Read-only commands are skipped
- R14. Binary files are detected and skipped with a one-line notice
- R15. Empty diffs are skipped silently
- R16. Diffs longer than 200 lines are truncated (first 150 + last 50) with a marker
- R17. Diff content is sanitized before being sent to the LLM to prevent prompt injection. Threat model: a malicious diff could contain text that overrides the system prompt or injects instructions to produce a false "safe" rating. Approach: wrap diff in `<DIFF>` delimiters, strip lines matching known injection patterns (lines starting with RULES:, SYSTEM:, INSTRUCTION:, OUTPUT: case-insensitive). Exact regex patterns deferred to planning

**Session Drift Detection**
- R18. Every explained change is recorded in the session state reliably, without data loss from concurrent writes
- R19. Session is keyed to Claude Code's session ID from the hook payload, with PPID as fallback
- R20. When the accumulated changes include files flagged as unrelated, a session drift alert box is printed. Detection methods: Ollama engine uses path heuristics (files in different top-level directories from previously edited files, or files matching sensitive patterns like `auth/`, `payment/`, `.env` when the session started in a different area). Claude Code engine compares each change against the user's original request for context-aware detection. False positives are acceptable in v1 since the alert says "consider reviewing," not "this is wrong"
- R21. `npx code-explainer summary` reads the session state and prints a report
- R22. `npx code-explainer session end` clears the session state (separate command from summary, not a destructive flag)
- R23. Stale session files (>2 hours) are cleaned up automatically on hook startup

**Explanation Caching**
- R24. Explanations are cached by diff hash. Repeated identical diffs return the cached result without querying the engine
- R25. Cache is per-session and cleared when the session ends

**Init CLI**
- R26. `npx code-explainer init` runs an interactive setup using @clack/prompts
- R27. Init detects if Ollama is installed. If not, offers to install it (platform-appropriate command)
- R28. User chooses engine (Ollama or Claude Code) and detail level (minimal, standard, verbose) through interactive prompts
- R29. If Ollama is selected and NVIDIA GPU is detected, the model is auto-selected. Otherwise, a model chooser is presented with VRAM recommendations:
  - `qwen3-coder:30b` — recommended for ≤8 GB VRAM. Uses MoE architecture: 30B total params but only 3.3B active, so it fits and runs fast on low VRAM while being smarter than smaller dense models
  - `qwen2.5-coder:14b` — recommended for 12-16 GB VRAM. Dense model with strong code understanding
  - `qwen2.5-coder:32b` — recommended for ≥20 GB VRAM. Best local quality
  - `qwen2.5-coder:7b` — fallback, smallest dense model, works on any GPU
- R30. Init pulls the selected Ollama model and runs a warmup automatically (skippable with `--skip-warmup`)
- R31. Init writes `code-explainer.config.json` and merges hooks into `.claude/settings.json` (brownfield-safe — preserves existing hooks)

**Config CLI**
- R32. `npx code-explainer config` opens an interactive menu showing current settings and letting the user change any of: engine, model, detail level, hooks (per-hook enable/disable), file exclusions, latency timeout, Ollama URL
- R33. Each setting has its own interactive prompt with clear options (no raw value editing)

**Uninstall CLI**
- R34. `npx code-explainer uninstall` removes hook entries from `.claude/settings.json` (preserves other hooks) and deletes `code-explainer.config.json`

**Config File**
- R35. All settings stored in `code-explainer.config.json` with these fields: engine, ollamaModel, ollamaUrl, detailLevel, hooks (edit/write/bash booleans), exclude (glob patterns), skipIfSlowMs, bashFilter.capturePatterns
- R36. Default file exclusions: `*.lock`, `dist/**`, `node_modules/**`

**Error Handling**
- R37. Every error message follows the template: `[code-explainer] {problem}. {cause}. Fix: {action}.`
- R38. Engine failures (connection refused, timeout, malformed response, empty response, model not found) gracefully skip with a notice — never block Claude Code
- R39. Malformed LLM JSON response falls back to truncated raw text (max 200 chars) in the standard box format
- R40. Corrupted or missing config file falls back to hardcoded defaults with a single warning (not per-invocation)
- R41. Ollama endpoint is verified as loopback address. Non-loopback triggers a security warning

**Cross-Platform**
- R42. Works on Windows, macOS, Linux, WSL
- R43. VRAM auto-detection for NVIDIA only. All other platforms use the interactive model chooser fallback

## Success Criteria

- `npx code-explainer init` completes successfully on macOS, Linux, Windows, WSL
- A non-developer can read every explanation and understand what changed
- Risk alerts fire on genuinely suspicious changes (low false positive rate)
- Session drift detection catches unrelated file modifications
- Ollama explanation latency < 5 seconds for typical diffs (< 100 lines)
- Published to npm, installable in any Claude Code project

## Scope Boundaries

- No web dashboard or panel (terminal-only for v1)
- No paid API integrations beyond Claude Code engine (no OpenAI, no Gemini)
- No automatic pausing or reverting of Claude Code actions
- No VS Code extension (deferred to v2)
- No git pre-commit hook mode (different product thesis)
- No dry-run mode, risk pattern library, or stats command (deferred)
- No express/auto-default init path — users go through the full interactive flow

## Key Decisions

- **Synchronous hooks**: The pause forces attention, which is the value. Mitigated with configurable timeout (default 8s) and Ctrl+C interrupt handling.
- **Single hook entry point**: One `post-tool.ts` dispatches by tool name instead of 3 separate files. DRY, single maintenance surface.
- **Append-only JSONL session state**: Eliminates read-modify-write race conditions entirely. Summary commands aggregate at read time.
- **Separate prompts per detail level**: Each detail level has its own complete, self-contained prompt template rather than a base prompt with swapped instructions.
- **Model chooser over VRAM question**: When auto-detection fails, show model options with VRAM recommendations at the side rather than asking users how much VRAM they have.
- **No express init path**: Users choose their own engine and detail level through the interactive flow.
- **Audience is vibe coders**: Non-developers using Claude Code. Not all developers, not junior devs.

## Dependencies / Assumptions

- Node.js installed (required by Claude Code)
- Ollama installed for local LLM engine (init detects and offers to install)
- Claude Code hook system supports PostToolUse events with tool payload on stdin
- `claude -p` CLI available for Claude Code engine

## Outstanding Questions

### Deferred to Planning
- [Affects R19][Needs research] Does the Claude Code hook payload include a session ID? If not, PPID fallback is the only option
- [Affects R17][Technical] Exact regex patterns for prompt injection sanitization (threat model and approach defined in R17)
- [Affects R31][Technical] Exact merge algorithm for brownfield-safe `.claude/settings.json` editing (5 edge cases identified in eng review)
- [Affects R13][Technical] Bash filter command chain parsing implementation — how to split on `|`, `;`, `&&` and match first token per sub-command

## Next Steps

-> `/ce:plan` for structured implementation planning
