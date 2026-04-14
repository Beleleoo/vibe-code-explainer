/**
 * Hand-rolled CLI flag parser — no library dependency.
 *
 * Supports:
 *   --flag          boolean flag (value: true)
 *   --flag=value    string flag
 *   --flag value    string flag (next positional arg is consumed as value)
 *
 * Returns:
 *   flags    — Record of flag name → string | true
 *   positional — remaining args that are not flags or flag values
 */
export interface ParsedFlags {
  flags: Record<string, string | true>;
  positional: string[];
}

export function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --flag=value
        const name = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[name] = value;
      } else {
        const name = arg.slice(2);
        // Peek ahead: if next token is a non-flag, treat as value.
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flags: -j, -y
      const name = arg.slice(1);
      flags[name] = true;
    } else {
      positional.push(arg);
    }

    i++;
  }

  return { flags, positional };
}

export function flagBool(flags: Record<string, string | true>, ...names: string[]): boolean {
  return names.some((n) => flags[n] === true || flags[n] !== undefined);
}

export function flagString(
  flags: Record<string, string | true>,
  name: string
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}
