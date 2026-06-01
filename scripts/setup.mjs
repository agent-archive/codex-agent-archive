#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_ARCHIVE_KEY_ENV,
  agentArchiveKeyStatus,
  hydrateLaunchctlFromKeychain,
  storeAgentArchiveKeyInKeychain
} from "./lib/agent-archive-key.mjs";
import { runSetup } from "./lib/setup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const dryRun = args.has("--dry-run");
const yes = args.has("--yes");
const skipKey = args.has("--skip-key");

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char) => {
      if (char === "\u0003") {
        stdout.write("\n");
        process.exit(130);
      }
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(value.trim());
        return;
      }
      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.on("data", onData);
  });
}

function printResult(result) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log("Agent Archive Codex connector setup");
  for (const action of result.actions) {
    console.log(`- ${action.action}${action.root ? `: ${action.root}` : ""}${action.command ? ` (${action.command})` : ""}`);
  }
  for (const item of result.checks) {
    console.log(`${item.status.padEnd(5)} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
    if (item.status !== "ok" && item.command) console.log(`      fix: ${item.command}`);
  }
  if (result.keyAction) console.log(`key: ${result.keyAction}`);
  if (result.restartCodex) console.log("Restart Codex so the app picks up plugin/key changes.");
}

async function handleKey(result) {
  if (skipKey || dryRun) return { ...result, keyAction: skipKey ? "skipped" : "not changed in dry-run" };

  const status = agentArchiveKeyStatus();
  if (status.availableToCurrentProcess) return { ...result, keyAction: "already available in current process" };

  if (process.platform !== "darwin") {
    return {
      ...result,
      keyAction: `set ${AGENT_ARCHIVE_KEY_ENV} in your shell environment on this platform`
    };
  }

  if (status.keychainValueLooksValid) {
    hydrateLaunchctlFromKeychain();
    return {
      ...result,
      keyAction: `hydrated launchctl ${AGENT_ARCHIVE_KEY_ENV} from Keychain`,
      restartCodex: true
    };
  }

  if (yes || json || !process.stdin.isTTY) {
    return {
      ...result,
      keyAction: `missing; run node scripts/agent-archive-key.mjs store or rerun setup without --yes`
    };
  }

  const apiKey = await readSecret(`Paste ${AGENT_ARCHIVE_KEY_ENV} (leave blank to skip): `);
  if (!apiKey) return { ...result, keyAction: "skipped" };

  storeAgentArchiveKeyInKeychain(apiKey);
  hydrateLaunchctlFromKeychain();
  return {
    ...result,
    keyAction: `stored key in Keychain and set launchctl ${AGENT_ARCHIVE_KEY_ENV}`,
    restartCodex: true
  };
}

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage:",
    "  node scripts/setup.mjs [--dry-run] [--json] [--yes] [--skip-key]",
    "",
    "Sets up local Codex plugin registration, managed Agent Archive toolkit discovery, and optional macOS key hydration."
  ].join("\n"));
  process.exit(0);
}

try {
  const result = runSetup(pluginRoot, process.env, { dryRun, yes });
  printResult(await handleKey(result));
} catch (error) {
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
