import { execFileSync } from "node:child_process";

export interface VramInfo {
  gpuName: string;
  totalMb: number;
}

/**
 * Detect NVIDIA GPU VRAM via nvidia-smi. Returns null if nvidia-smi is
 * unavailable or fails. Other vendors (Apple Silicon, AMD) are intentionally
 * not auto-detected for v1 — the user picks their model via the chooser.
 */
export function detectNvidiaVram(): VramInfo | null {
  try {
    const output = execFileSync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();

    if (!output) return null;
    const firstLine = output.split("\n")[0];
    const parts = firstLine.split(",").map((s) => s.trim());
    if (parts.length < 2) return null;

    const totalMb = parseInt(parts[1], 10);
    if (isNaN(totalMb) || totalMb <= 0) return null;

    return { gpuName: parts[0], totalMb };
  } catch {
    return null;
  }
}

export interface ModelOption {
  model: string;
  label: string;
  hint: string;
  minVramGb: number;
}

// Updated April 2026. Qwen 3.5 (released March 2026) is the latest general-
// purpose family with strong coding parity. Qwen 2.5 Coder is still the best
// code-specialized option in its size range. Both are listed so users can
// pick "newest" vs "code-specialized" at their VRAM tier.
export const MODEL_OPTIONS: ModelOption[] = [
  {
    model: "qwen3.5:4b",
    label: "qwen3.5:4b",
    hint: "recommended for \u22648 GB VRAM \u2014 newest (Mar 2026), \u223c3.4 GB download",
    minVramGb: 4,
  },
  {
    model: "qwen2.5-coder:7b",
    label: "qwen2.5-coder:7b",
    hint: "alternative for \u22648 GB VRAM \u2014 code-specialized, \u223c4.7 GB",
    minVramGb: 6,
  },
  {
    model: "qwen3.5:9b",
    label: "qwen3.5:9b",
    hint: "recommended for 8-12 GB VRAM \u2014 newest, \u223c6.6 GB",
    minVramGb: 8,
  },
  {
    model: "qwen2.5-coder:14b",
    label: "qwen2.5-coder:14b",
    hint: "recommended for 12-16 GB VRAM \u2014 code-specialized, \u223c9 GB",
    minVramGb: 12,
  },
  {
    model: "qwen3.5:27b",
    label: "qwen3.5:27b",
    hint: "recommended for 16-24 GB VRAM \u2014 newest, \u223c17 GB",
    minVramGb: 16,
  },
  {
    model: "qwen2.5-coder:32b",
    label: "qwen2.5-coder:32b",
    hint: "recommended for \u226524 GB VRAM \u2014 best code quality, \u223c19 GB",
    minVramGb: 24,
  },
];

export function pickModelForVram(totalMb: number): string {
  const totalGb = totalMb / 1024;
  if (totalGb >= 24) return "qwen2.5-coder:32b";
  if (totalGb >= 16) return "qwen3.5:27b";
  if (totalGb >= 12) return "qwen2.5-coder:14b";
  if (totalGb >= 8) return "qwen3.5:9b";
  return "qwen3.5:4b";
}
