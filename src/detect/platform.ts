import { platform } from "node:os";

export type Platform = "windows" | "macos" | "linux" | "wsl" | "unknown";

export function detectPlatform(): Platform {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  if (p === "linux") {
    // WSL detection: Microsoft string in /proc/version
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      const release = fs.readFileSync("/proc/version", "utf-8").toLowerCase();
      if (release.includes("microsoft") || release.includes("wsl")) return "wsl";
    } catch {
      // ignore
    }
    return "linux";
  }
  return "unknown";
}

export function ollamaInstallCommand(p: Platform): string {
  switch (p) {
    case "macos":
      return "brew install ollama";
    case "windows":
      return "winget install Ollama.Ollama";
    case "linux":
    case "wsl":
      return "curl -fsSL https://ollama.com/install.sh | sh";
    default:
      return "Visit https://ollama.com/download to install Ollama";
  }
}
