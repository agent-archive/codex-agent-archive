#!/usr/bin/env node
import {
  AGENT_ARCHIVE_KEY_ENV,
  AGENT_ARCHIVE_KEYCHAIN_SERVICE,
  agentArchiveKeyStatus,
  hydrateLaunchctlFromKeychain,
  storeAgentArchiveKeyInKeychain
} from "./lib/agent-archive-key.mjs";

const command = process.argv[2] || "status";
const json = process.argv.includes("--json");

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return new Promise((resolve, reject) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => resolve(input.trim()));
      process.stdin.on("error", reject);
    });
  }

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

function print(value) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  console.log(`process env ${AGENT_ARCHIVE_KEY_ENV}: ${value.processEnvConfigured ? "set" : "missing"}`);
  console.log(`launchctl ${AGENT_ARCHIVE_KEY_ENV}: ${value.launchctlConfigured ? "set" : "missing"}`);
  console.log(`Keychain ${AGENT_ARCHIVE_KEYCHAIN_SERVICE}: ${value.keychainConfigured ? "found" : "missing"}`);
  if (value.currentProcessNeedsExport) {
    console.log("current shell/Codex process has not inherited the key yet.");
  }
  if (value.readyForRestartedCodex && !value.processEnvConfigured) {
    console.log("ready for restarted Codex: yes");
  }
  if (value.action) console.log(`action: ${value.action}`);
  if (value.restartCodex) console.log("restart Codex so GUI-launched processes inherit the updated launch environment.");
}

try {
  if (command === "status") {
    print(agentArchiveKeyStatus());
  } else if (command === "store") {
    const apiKey = await readSecret(`Paste ${AGENT_ARCHIVE_KEY_ENV}: `);
    storeAgentArchiveKeyInKeychain(apiKey);
    const status = hydrateLaunchctlFromKeychain();
    print({
      ...status,
      action: `stored key in Keychain and set launchctl ${AGENT_ARCHIVE_KEY_ENV}`,
      restartCodex: true
    });
  } else if (command === "hydrate") {
    const status = hydrateLaunchctlFromKeychain();
    print({
      ...status,
      action: `set launchctl ${AGENT_ARCHIVE_KEY_ENV} from Keychain`,
      restartCodex: true
    });
  } else {
    console.error([
      "Usage:",
      "  node scripts/agent-archive-key.mjs status [--json]",
      "  node scripts/agent-archive-key.mjs store [--json]",
      "  node scripts/agent-archive-key.mjs hydrate [--json]",
      "",
      "Store the key in Keychain without putting it in chat, shell history, or git:",
      "  node scripts/agent-archive-key.mjs store",
      "",
      "Hydrate Codex's launch environment from an existing Keychain item:",
      "  node scripts/agent-archive-key.mjs hydrate"
    ].join("\n"));
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
