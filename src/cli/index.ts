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
      await runConfig();
      break;
    }
    case "uninstall": {
      const { runUninstall } = await import("./uninstall.js");
      await runUninstall();
      break;
    }
    case "summary": {
      const { printSummary } = await import("../session/tracker.js");
      await printSummary();
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
      await runWarmup();
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
