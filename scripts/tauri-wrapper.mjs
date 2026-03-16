import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const tauriBinary = resolve(
  process.cwd(),
  process.platform === "win32" ? "node_modules/.bin/tauri.cmd" : "node_modules/.bin/tauri"
);

if (!existsSync(tauriBinary)) {
  console.error("Tauri CLI binary not found. Run npm install first.");
  process.exit(1);
}

if (args[0] === "dev") {
  const devArgs = args.slice(1);
  const { cliArgs, tailArgs } = splitDevArgs(devArgs);

  const isInfoOnly =
    cliArgs.includes("--help") ||
    cliArgs.includes("-h") ||
    cliArgs.includes("--version") ||
    cliArgs.includes("-V");
  const hasUserConfigOption = hasConfigOption(cliArgs);
  const shouldAutoPort =
    !isInfoOnly &&
    !hasUserConfigOption &&
    !cliArgs.includes("--no-dev-server");

  if (!shouldAutoPort) {
    runTauri(args);
  } else {
    const port = await getFreePort();
    const configOverride = {
      build: {
        beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        devPath: `http://127.0.0.1:${port}`
      }
    };

    console.log(`[tauri-wrapper] Using Vite dev server port: ${port}`);
    runTauri(["dev", ...cliArgs, "--config", JSON.stringify(configOverride), ...tailArgs]);
  }
} else {
  runTauri(args);
}

function runTauri(runArgs) {
  const child = spawn(tauriBinary, runArgs, {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`Failed to start Tauri CLI: ${error.message}`);
    process.exit(1);
  });
}

function splitDevArgs(devArgs) {
  const firstSeparatorIndex = devArgs.indexOf("--");
  if (firstSeparatorIndex < 0) {
    return { cliArgs: devArgs, tailArgs: [] };
  }

  return {
    cliArgs: devArgs.slice(0, firstSeparatorIndex),
    tailArgs: devArgs.slice(firstSeparatorIndex)
  };
}

function hasConfigOption(argsToCheck) {
  return argsToCheck.some((arg) => {
    if (arg === "--config" || arg === "-c") {
      return true;
    }

    if (arg.startsWith("--config=") || arg.startsWith("-c=")) {
      return true;
    }

    return /^-c.+/.test(arg);
  });
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();

    server.once("error", (error) => {
      reject(error);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine free port.")));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolvePort(port);
      });
    });
  });
}
