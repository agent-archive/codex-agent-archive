import os from "node:os";
import { spawnSync } from "node:child_process";

export const AGENT_ARCHIVE_KEY_ENV = "AGENT_ARCHIVE_API_KEY";
export const AGENT_ARCHIVE_KEYCHAIN_SERVICE = "agent-archive-api-key";

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    input: options.input
  });
}

function isMac() {
  return process.platform === "darwin";
}

export function keychainAccount(env = process.env) {
  return env.USER || os.userInfo().username;
}

export function launchctlKeyConfigured() {
  if (!isMac()) return false;
  const result = runCommand("launchctl", ["getenv", AGENT_ARCHIVE_KEY_ENV]);
  return result.status === 0 && Boolean(result.stdout.trim());
}

export function keychainHasAgentArchiveKey(env = process.env) {
  if (!isMac()) return false;
  const result = runCommand("security", [
    "find-generic-password",
    "-a",
    keychainAccount(env),
    "-s",
    AGENT_ARCHIVE_KEYCHAIN_SERVICE
  ]);
  return result.status === 0;
}

export function readAgentArchiveKeyFromKeychain(env = process.env) {
  if (!isMac()) {
    throw new Error("macOS Keychain is only available on darwin.");
  }

  const result = runCommand("security", [
    "find-generic-password",
    "-a",
    keychainAccount(env),
    "-s",
    AGENT_ARCHIVE_KEYCHAIN_SERVICE,
    "-w"
  ]);
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Agent Archive API key not found in Keychain service "${AGENT_ARCHIVE_KEYCHAIN_SERVICE}".`);
  }
  return result.stdout.trim();
}

export function storeAgentArchiveKeyInKeychain(apiKey, env = process.env) {
  if (!isMac()) {
    throw new Error("macOS Keychain is only available on darwin.");
  }
  if (!String(apiKey || "").trim()) {
    throw new Error("Agent Archive API key cannot be empty.");
  }

  const result = runCommand("security", [
    "add-generic-password",
    "-a",
    keychainAccount(env),
    "-s",
    AGENT_ARCHIVE_KEYCHAIN_SERVICE,
    "-U",
    "-w"
  ], { input: `${String(apiKey).trim()}\n${String(apiKey).trim()}\n` });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "security add-generic-password failed.").trim());
  }
  return agentArchiveKeyStatus(env);
}

export function hydrateLaunchctlFromKeychain(env = process.env) {
  const apiKey = readAgentArchiveKeyFromKeychain(env);
  const result = runCommand("launchctl", ["setenv", AGENT_ARCHIVE_KEY_ENV, apiKey]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "launchctl setenv failed.").trim());
  }
  return agentArchiveKeyStatus(env);
}

export function agentArchiveKeyStatus(env = process.env) {
  const processEnvConfigured = Boolean(env[AGENT_ARCHIVE_KEY_ENV]);
  const launchctlConfigured = launchctlKeyConfigured();
  const keychainConfigured = keychainHasAgentArchiveKey(env);
  return {
    envVar: AGENT_ARCHIVE_KEY_ENV,
    processEnvConfigured,
    launchctlConfigured,
    keychainConfigured,
    availableToCurrentProcess: processEnvConfigured,
    readyForRestartedCodex: launchctlConfigured,
    currentProcessNeedsExport: !processEnvConfigured && (launchctlConfigured || keychainConfigured),
    keychainService: AGENT_ARCHIVE_KEYCHAIN_SERVICE,
    keychainAccount: keychainAccount(env)
  };
}
