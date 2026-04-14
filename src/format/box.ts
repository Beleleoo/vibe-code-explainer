import type { ExplanationResult, Language, RiskLevel, DetailLevel } from "../config/schema.js";

// ===========================================================================
// Section header translations per language
// ===========================================================================

interface SectionLabels {
  impact: string;
  howItWorks: string;
  why: string;
  deepDive: string;
  risk: string;
  riskNone: string;
  riskLow: string;
  riskMedium: string;
  riskHigh: string;
  samePatternFallback: string;
}

const LABELS: Record<Language, SectionLabels> = {
  en: {
    impact: "Impact",
    howItWorks: "How it works",
    why: "Why",
    deepDive: "Deeper dive",
    risk: "Risk",
    riskNone: "None",
    riskLow: "Low",
    riskMedium: "Medium",
    riskHigh: "High",
    samePatternFallback: "Same pattern as before applied to this file.",
  },
  pt: {
    impact: "Impacto",
    howItWorks: "Como funciona",
    why: "Por que",
    deepDive: "Pra aprofundar",
    risk: "Risco",
    riskNone: "Nenhum",
    riskLow: "Baixo",
    riskMedium: "M\u00e9dio",
    riskHigh: "Alto",
    samePatternFallback: "Mesmo padr\u00e3o anterior aplicado a este arquivo.",
  },
  es: {
    impact: "Impacto",
    howItWorks: "C\u00f3mo funciona",
    why: "Por qu\u00e9",
    deepDive: "Para profundizar",
    risk: "Riesgo",
    riskNone: "Ninguno",
    riskLow: "Bajo",
    riskMedium: "Medio",
    riskHigh: "Alto",
    samePatternFallback: "Mismo patr\u00f3n anterior aplicado a este archivo.",
  },
  fr: {
    impact: "Impact",
    howItWorks: "Comment \u00e7a marche",
    why: "Pourquoi",
    deepDive: "Pour approfondir",
    risk: "Risque",
    riskNone: "Aucun",
    riskLow: "Faible",
    riskMedium: "Moyen",
    riskHigh: "\u00c9lev\u00e9",
    samePatternFallback: "M\u00eame motif que pr\u00e9c\u00e9demment, appliqu\u00e9 \u00e0 ce fichier.",
  },
  de: {
    impact: "Auswirkung",
    howItWorks: "Wie es funktioniert",
    why: "Warum",
    deepDive: "Mehr lernen",
    risk: "Risiko",
    riskNone: "Keines",
    riskLow: "Gering",
    riskMedium: "Mittel",
    riskHigh: "Hoch",
    samePatternFallback: "Gleiches Muster wie zuvor auf diese Datei angewendet.",
  },
  it: {
    impact: "Impatto",
    howItWorks: "Come funziona",
    why: "Perch\u00e9",
    deepDive: "Per approfondire",
    risk: "Rischio",
    riskNone: "Nessuno",
    riskLow: "Basso",
    riskMedium: "Medio",
    riskHigh: "Alto",
    samePatternFallback: "Stesso schema applicato a questo file.",
  },
  zh: {
    impact: "\u5f71\u54cd",
    howItWorks: "\u5982\u4f55\u5de5\u4f5c",
    why: "\u4e3a\u4ec0\u4e48",
    deepDive: "\u6df1\u5165\u5b66\u4e60",
    risk: "\u98ce\u9669",
    riskNone: "\u65e0",
    riskLow: "\u4f4e",
    riskMedium: "\u4e2d",
    riskHigh: "\u9ad8",
    samePatternFallback: "\u540c\u6837\u7684\u6a21\u5f0f\u5e94\u7528\u5230\u6b64\u6587\u4ef6\u3002",
  },
  ja: {
    impact: "\u5f71\u97ff",
    howItWorks: "\u4ed5\u7d44\u307f",
    why: "\u306a\u305c",
    deepDive: "\u3055\u3089\u306b\u5b66\u3076",
    risk: "\u30ea\u30b9\u30af",
    riskNone: "\u306a\u3057",
    riskLow: "\u4f4e",
    riskMedium: "\u4e2d",
    riskHigh: "\u9ad8",
    samePatternFallback: "\u4ee5\u524d\u3068\u540c\u3058\u30d1\u30bf\u30fc\u30f3\u3092\u3053\u306e\u30d5\u30a1\u30a4\u30eb\u306b\u9069\u7528\u3002",
  },
  ko: {
    impact: "\uc601\ud5a5",
    howItWorks: "\uc791\ub3d9 \ubc29\uc2dd",
    why: "\uc774\uc720",
    deepDive: "\ub354 \uc54c\uc544\ubcf4\uae30",
    risk: "\uc704\ud5d8",
    riskNone: "\uc5c6\uc74c",
    riskLow: "\ub0ae\uc74c",
    riskMedium: "\ubcf4\ud1b5",
    riskHigh: "\ub192\uc74c",
    samePatternFallback: "\uc774\uc804\uacfc \ub3d9\uc77c\ud55c \ud328\ud134\uc774 \uc774 \ud30c\uc77c\uc5d0 \uc801\uc6a9\ub418\uc5c8\uc2b5\ub2c8\ub2e4.",
  },
};

function getLabels(language: Language): SectionLabels {
  return LABELS[language] ?? LABELS.en;
}

// ===========================================================================
// Color helpers — soft palette via truecolor (24-bit) escapes.
// Most modern terminals (Windows Terminal, iTerm2, VS Code, gnome-terminal)
// support truecolor. NO_COLOR and TERM=dumb still produce plain text.
// ===========================================================================

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";

// Project palette (softer than saturated ANSI)
const PALETTE = {
  blue: [91, 158, 245],      // #5B9EF5
  green: [91, 245, 160],     // #5BF5A0
  yellow: [245, 200, 91],    // #F5C85B
  red: [245, 91, 91],        // #F55B5B
  purple: [224, 91, 245],    // #E05BF5
  white: [255, 255, 255],    // #FFFFFF
} as const;

type PaletteKey = keyof typeof PALETTE;

function isNoColor(): boolean {
  return "NO_COLOR" in process.env || process.env.TERM === "dumb";
}

function rgb(name: PaletteKey, text: string): string {
  if (isNoColor()) return text;
  const [r, g, b] = PALETTE[name];
  return `\u001b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function bold(text: string): string {
  if (isNoColor()) return text;
  return `${BOLD}${text}${RESET}`;
}

function dim(text: string): string {
  if (isNoColor()) return text;
  return `${DIM}${text}${RESET}`;
}

function boldRgb(name: PaletteKey, text: string): string {
  if (isNoColor()) return text;
  const [r, g, b] = PALETTE[name];
  return `${BOLD}\u001b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function dimRgb(name: PaletteKey, text: string): string {
  if (isNoColor()) return text;
  const [r, g, b] = PALETTE[name];
  return `${DIM}\u001b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function getTerminalWidth(): number {
  return process.stderr.columns || 80;
}

// ===========================================================================
// Risk presentation
// ===========================================================================

function riskBorderColor(risk: RiskLevel): PaletteKey {
  switch (risk) {
    case "none": return "green";
    case "low": return "yellow";
    case "medium": return "yellow";
    case "high": return "red";
  }
}

function riskIcon(risk: RiskLevel): string {
  if (isNoColor()) {
    switch (risk) {
      case "none": return "[OK]";
      case "low": return "[!]";
      case "medium": return "[!!]";
      case "high": return "[!!!]";
    }
  }
  switch (risk) {
    case "none": return rgb("green", "\u2713");
    case "low": return rgb("yellow", "\u26a0");
    case "medium": return rgb("yellow", "\u26a0");
    case "high": return rgb("red", "\u{1F6A8}");
  }
}

function riskLabelText(risk: RiskLevel, labels: SectionLabels): string {
  switch (risk) {
    case "none": return labels.riskNone;
    case "low": return labels.riskLow;
    case "medium": return labels.riskMedium;
    case "high": return labels.riskHigh;
  }
}

function riskLabelColor(risk: RiskLevel): PaletteKey {
  switch (risk) {
    case "none": return "green";
    case "low": return "yellow";
    case "medium": return "yellow";
    case "high": return "red";
  }
}

// ===========================================================================
// Inline code highlighting (`backticks` -> soft blue)
// ===========================================================================

function highlightInlineCode(text: string): string {
  if (isNoColor()) return text;
  return text.replace(/`([^`]+)`/g, (_, code: string) => rgb("blue", code));
}

// ===========================================================================
// Word wrap that respects a content width (no ANSI awareness needed since
// we wrap BEFORE adding color)
// ===========================================================================

function wrapText(text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= maxWidth) {
      out.push(raw);
      continue;
    }
    let remaining = raw;
    while (remaining.length > maxWidth) {
      let breakAt = remaining.lastIndexOf(" ", maxWidth);
      if (breakAt <= 0) breakAt = maxWidth;
      out.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) out.push(remaining);
  }
  return out;
}

// ===========================================================================
// Box construction
// ===========================================================================

const BOX_TITLE = "vibe-code-explainer";
const PAD_LEFT = 2;
const PAD_RIGHT = 2;

interface BoxLine {
  text: string; // Already styled
  raw: string;  // Raw (uncolored) version, used for width calculation
}

function line(raw: string, styled?: string): BoxLine {
  return { text: styled ?? raw, raw };
}

function blankLine(): BoxLine {
  return line("");
}

function buildBoxOutput(
  contentLines: BoxLine[],
  borderColor: PaletteKey
): string {
  const width = Math.min(getTerminalWidth() - 2, 70);
  const innerWidth = width - 2; // chars between │ │

  const dashesRight = "\u2500".repeat(Math.max(0, innerWidth - BOX_TITLE.length - 4));
  const top =
    rgb(borderColor, `\u256d\u2500 `) +
    dim(BOX_TITLE) +
    rgb(borderColor, ` ${dashesRight}\u2500\u256e`);
  const bottom = rgb(borderColor, `\u2570${"\u2500".repeat(innerWidth)}\u256f`);

  const sideChar = rgb(borderColor, "\u2502");

  const middle = contentLines.map((bl) => {
    const padding = " ".repeat(Math.max(0, innerWidth - bl.raw.length - PAD_LEFT - PAD_RIGHT));
    return `${sideChar}${" ".repeat(PAD_LEFT)}${bl.text}${padding}${" ".repeat(PAD_RIGHT)}${sideChar}`;
  });

  return [top, ...middle, bottom].join("\n");
}

// ===========================================================================
// Section rendering
// ===========================================================================

interface SectionDef {
  header: string;
  headerColor: PaletteKey;
  body: string;
  innerWidth: number;
  dimHeader?: boolean;
}

function renderSection(def: SectionDef): BoxLine[] {
  const out: BoxLine[] = [];
  const headerRaw = `\u25b8 ${def.header}`;
  const headerStyled = def.dimHeader
    ? dimRgb(def.headerColor, headerRaw)
    : boldRgb(def.headerColor, headerRaw);
  out.push(line(headerRaw, headerStyled));

  const bodyMax = def.innerWidth - PAD_LEFT - PAD_RIGHT - 2; // 2 = body indent
  const wrapped = wrapText(def.body, bodyMax);
  for (const w of wrapped) {
    const indented = `  ${w}`;
    const styled = `  ${highlightInlineCode(w)}`;
    out.push(line(indented, styled));
  }

  return out;
}

// ===========================================================================
// Public API
// ===========================================================================

export interface BoxInputs {
  filePath: string;
  result: ExplanationResult;
  detailLevel: DetailLevel;
  language: Language;
}

export function formatExplanationBox(inputs: BoxInputs): string {
  const labels = getLabels(inputs.language);
  const result = inputs.result;
  const borderKey = riskBorderColor(result.risk);
  const lines: BoxLine[] = [];
  const innerWidth = Math.min(getTerminalWidth() - 2, 70) - 2;

  lines.push(blankLine());

  // File path with 📄 icon, soft blue + bold
  const filePathRaw = `\ud83d\udcc4  ${inputs.filePath}`;
  const filePathStyled = boldRgb("blue", filePathRaw);
  lines.push(line(filePathRaw, filePathStyled));

  // Same-pattern collapse: short note, no teaching sections
  if (result.isSamePattern) {
    lines.push(blankLine());
    const noteRaw = result.samePatternNote || labels.samePatternFallback;
    const noteWrapped = wrapText(noteRaw, innerWidth - PAD_LEFT - PAD_RIGHT);
    for (const w of noteWrapped) {
      lines.push(line(w, dim(w)));
    }
  } else {
    // Impact (always shown when not collapsed)
    if (result.impact) {
      lines.push(blankLine());
      if (inputs.detailLevel === "minimal") {
        // Minimal: no header, just the text
        const wrapped = wrapText(result.impact, innerWidth - PAD_LEFT - PAD_RIGHT);
        for (const w of wrapped) {
          lines.push(line(w, highlightInlineCode(w)));
        }
      } else {
        const sec = renderSection({
          header: labels.impact,
          headerColor: "blue",
          body: result.impact,
          innerWidth,
        });
        lines.push(...sec);
      }
    }

    // How it works (standard + verbose)
    if (inputs.detailLevel !== "minimal" && result.howItWorks) {
      lines.push(blankLine());
      const sec = renderSection({
        header: labels.howItWorks,
        headerColor: "green",
        body: result.howItWorks,
        innerWidth,
      });
      lines.push(...sec);
    }

    // Why (standard + verbose)
    if (inputs.detailLevel !== "minimal" && result.why) {
      lines.push(blankLine());
      const sec = renderSection({
        header: labels.why,
        headerColor: "purple",
        body: result.why,
        innerWidth,
      });
      lines.push(...sec);
    }

    // Deep dive (verbose only) — uses white-dim header to sit quieter
    if (
      inputs.detailLevel === "verbose" &&
      result.deepDive &&
      result.deepDive.length > 0
    ) {
      lines.push(blankLine());
      const headerRaw = `\u25b8 ${labels.deepDive}`;
      const headerStyled = dimRgb("white", headerRaw);
      lines.push(line(headerRaw, headerStyled));
      const itemMax = innerWidth - PAD_LEFT - PAD_RIGHT - 4;
      for (const item of result.deepDive) {
        const text = `${item.term}: ${item.explanation}`;
        const wrapped = wrapText(text, itemMax);
        for (let i = 0; i < wrapped.length; i++) {
          const prefix = i === 0 ? "  \u2014 " : "    ";
          const raw = `${prefix}${wrapped[i]}`;
          const styled = `${prefix}${highlightInlineCode(wrapped[i])}`;
          lines.push(line(raw, styled));
        }
      }
    }
  }

  // Divider before risk
  lines.push(blankLine());
  const dividerWidth = innerWidth - PAD_LEFT - PAD_RIGHT;
  const dividerRaw = "\u2504".repeat(dividerWidth);
  lines.push(line(dividerRaw, dim(dividerRaw)));
  lines.push(blankLine());

  // Risk row
  const riskKey = riskLabelColor(result.risk);
  const riskHeaderRaw = `${stripAnsi(riskIcon(result.risk))}  ${labels.risk}: ${riskLabelText(result.risk, labels)}`;
  const riskHeaderStyled = `${riskIcon(result.risk)}  ${boldRgb(riskKey, `${labels.risk}: ${riskLabelText(result.risk, labels)}`)}`;
  lines.push(line(riskHeaderRaw, riskHeaderStyled));

  if (result.risk !== "none" && result.riskReason) {
    const reasonMax = innerWidth - PAD_LEFT - PAD_RIGHT - 3;
    const wrapped = wrapText(result.riskReason, reasonMax);
    for (const w of wrapped) {
      const raw = `   ${w}`;
      const styled = `   ${dimRgb(riskKey, w)}`;
      lines.push(line(raw, styled));
    }
  }

  lines.push(blankLine());

  return buildBoxOutput(lines, borderKey);
}

// ===========================================================================
// Misc box variants (skip notice, error notice, drift alert)
// ===========================================================================

export function formatSkipNotice(reason: string): string {
  return dim(`[code-explainer] skipped: ${reason}`);
}

export function formatErrorNotice(problem: string, cause: string, fix: string): string {
  return rgb("yellow", `[code-explainer] ${problem}. ${cause}. Fix: ${fix}.`);
}

export function formatDriftAlert(
  totalFiles: number,
  unrelatedFiles: string[],
  userRequest?: string,
  language: Language = "en"
): string {
  const labels = getLabels(language);
  const lines: BoxLine[] = [];
  const innerWidth = Math.min(getTerminalWidth() - 2, 70) - 2;

  lines.push(blankLine());

  const headerRaw = `\u26a1 SESSION DRIFT`;
  const headerStyled = boldRgb("yellow", headerRaw);
  lines.push(line(headerRaw, headerStyled));

  lines.push(blankLine());

  const summaryRaw = `Claude has modified ${totalFiles} files this session.`;
  lines.push(line(summaryRaw));

  const unrelatedRaw = `${unrelatedFiles.length} may be unrelated:`;
  lines.push(line(unrelatedRaw));

  for (const file of unrelatedFiles) {
    const truncated = file.length > innerWidth - 8 ? file.slice(0, innerWidth - 11) + "..." : file;
    const raw = `  \u2022 ${truncated}`;
    const styled = `  ${rgb("yellow", "\u2022")} ${truncated}`;
    lines.push(line(raw, styled));
  }

  if (userRequest) {
    lines.push(blankLine());
    const requestLines = wrapText(`Your request: "${userRequest}"`, innerWidth - PAD_LEFT - PAD_RIGHT);
    for (const w of requestLines) {
      lines.push(line(w, dim(w)));
    }
  }

  lines.push(blankLine());
  const noticeRaw = `\u26a0  Consider reviewing these changes.`;
  lines.push(line(noticeRaw, boldRgb("yellow", noticeRaw)));
  lines.push(blankLine());

  return buildBoxOutput(lines, "yellow");
}

/**
 * Write directly to the controlling terminal — Claude Code captures stdio,
 * but for non-hook contexts (init, summary, warmup) we want output on the
 * actual terminal. Falls back to stderr.
 */
export function printToStderr(text: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const ttyPath = process.platform === "win32" ? "\\\\.\\CONOUT$" : "/dev/tty";
    const fd = fs.openSync(ttyPath, "w");
    fs.writeSync(fd, text + "\n");
    fs.closeSync(fd);
  } catch {
    process.stderr.write(text + "\n");
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}
