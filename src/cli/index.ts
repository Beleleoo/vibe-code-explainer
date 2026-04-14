import { parseFlags, flagBool } from "./flags.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "init": {
      const { runInit } = await import("./init.js");
      await runInit(args.slice(1));
      break;
    }
    case "config": {
      const { runConfig } = await import("./config.js");
      await runConfig(args.slice(1));
      break;
    }
    case "uninstall": {
      const { runUninstall } = await import("./uninstall.js");
      await runUninstall();
      break;
    }
    case "summary": {
      const { flags } = parseFlags(args.slice(1));
      const json = flagBool(flags, "json", "j");
      const { printSummary } = await import("../session/tracker.js");
      await printSummary({ json });
      break;
    }
    case "session": {
      const subcommand = args[1];
      if (subcommand === "end") {
        const { endSession } = await import("../session/tracker.js");
        await endSession();
      } else {
        console.error("[code-explainer] Unknown session command. Usage: code-explainer session end");
        process.exit(1);
      }
      break;
    }
    case "warmup": {
      const { runWarmup } = await import("../engines/ollama.js");
      const { loadConfig, DEFAULT_CONFIG } = await import("../config/schema.js");
      let config;
      try {
        config = loadConfig("code-explainer.config.json");
      } catch {
        config = DEFAULT_CONFIG;
      }
      process.stderr.write(`[code-explainer] Warming up ${config.ollamaModel}...\n`);
      const result = await runWarmup(config);
      if (result.kind === "ok") {
        process.stderr.write("[code-explainer] Warmup complete. First real explanation will be fast.\n");
      } else if (result.kind === "error") {
        process.stderr.write(
          `[code-explainer] Warmup failed. ${result.problem}. ${result.cause}. Fix: ${result.fix}.\n`
        );
        process.exit(1);
      } else {
        process.stderr.write(`[code-explainer] Warmup skipped: ${result.reason}\n`);
      }
      break;
    }
    case "--help":
    case "-h":
    case undefined: {
      console.log(`code-explainer — Real-time diff explanations for vibe coders

Commands:
  init        Set up code-explainer in your project
  config      Change settings (engine, model, detail level, etc.)
  uninstall   Remove code-explainer from your project
  summary     Show a summary of changes in the current session
  session end Clear the current session data
  warmup      Pre-load the Ollama model for faster first explanation

Usage:
  npx vibe-code-explainer init
  npx vibe-code-explainer config
  npx vibe-code-explainer summary`);
      break;
    }
    default: {
      console.error(`[code-explainer] Unknown command: ${command}. Run 'vibe-code-explainer --help' for usage.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("[code-explainer] Unexpected error.", err.message, "Fix: Run 'vibe-code-explainer --help' for usage.");
  process.exit(1);
});
