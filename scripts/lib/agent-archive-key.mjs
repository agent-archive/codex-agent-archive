import os from "node:os";
import { spawnSync } from "node:child_process";

export const AGENT_ARCHIVE_KEY_ENV = "AGENT_ARCHIVE_API_KEY";
export const AGENT_ARCHIVE_KEYCHAIN_SERVICE = "agent-archive-api-key";
const AGENT_ARCHIVE_KEY_PATTERN = /^agentarchive_[a-zA-Z0-9_-]{20,}$/;

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

function normalizeApiKey(apiKey) {
  return String(apiKey || "").trim();
}

export function isSupportedAgentArchiveApiKey(apiKey) {
  return AGENT_ARCHIVE_KEY_PATTERN.test(normalizeApiKey(apiKey));
}

export function readLaunchctlAgentArchiveKey() {
  if (!isMac()) return false;
  const result = runCommand("launchctl", ["getenv", AGENT_ARCHIVE_KEY_ENV]);
  return result.status === 0 ? result.stdout.trim() : "";
}

export function launchctlKeyConfigured() {
  return Boolean(readLaunchctlAgentArchiveKey());
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
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    throw new Error("Agent Archive API key cannot be empty.");
  }
  if (!isSupportedAgentArchiveApiKey(normalizedApiKey)) {
    throw new Error('Agent Archive API key must start with "agentarchive_" and contain the full key. The value was not stored.');
  }
  if (!isMac()) {
    throw new Error("macOS Keychain is only available on darwin.");
  }

  // Passing the validated value as an argv avoids macOS security's confusing
  // second "password data" prompt. spawnSync is not a shell, so this does not
  // put the key in shell history.
  const result = runCommand("security", [
    "add-generic-password",
    "-a",
    keychainAccount(env),
    "-s",
    AGENT_ARCHIVE_KEYCHAIN_SERVICE,
    "-U",
    "-w",
    normalizedApiKey
  ]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "security add-generic-password failed.").trim());
  }
  return agentArchiveKeyStatus(env);
}

export function hydrateLaunchctlFromKeychain(env = process.env) {
  const apiKey = readAgentArchiveKeyFromKeychain(env);
  if (!isSupportedAgentArchiveApiKey(apiKey)) {
    throw new Error(`Stored ${AGENT_ARCHIVE_KEY_ENV} does not look like an Agent Archive API key. Run store again with the full key.`);
  }
  const result = runCommand("launchctl", ["setenv", AGENT_ARCHIVE_KEY_ENV, apiKey]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "launchctl setenv failed.").trim());
  }
  return agentArchiveKeyStatus(env);
}

export function agentArchiveKeyStatus(env = process.env) {
  const processEnvValue = normalizeApiKey(env[AGENT_ARCHIVE_KEY_ENV]);
  const launchctlValue = readLaunchctlAgentArchiveKey();
  const keychainConfigured = keychainHasAgentArchiveKey(env);
  let keychainValueLooksValid = false;
  if (keychainConfigured) {
    try {
      keychainValueLooksValid = isSupportedAgentArchiveApiKey(readAgentArchiveKeyFromKeychain(env));
    } catch {
      keychainValueLooksValid = false;
    }
  }
  const processEnvConfigured = Boolean(processEnvValue);
  const processEnvLooksValid = isSupportedAgentArchiveApiKey(processEnvValue);
  const launchctlConfigured = Boolean(launchctlValue);
  const launchctlValueLooksValid = isSupportedAgentArchiveApiKey(launchctlValue);
  return {
    envVar: AGENT_ARCHIVE_KEY_ENV,
    processEnvConfigured,
    processEnvLooksValid,
    launchctlConfigured,
    launchctlValueLooksValid,
    keychainConfigured,
    keychainValueLooksValid,
    availableToCurrentProcess: processEnvLooksValid,
    readyForRestartedCodex: launchctlValueLooksValid,
    currentProcessNeedsExport: !processEnvLooksValid && (launchctlValueLooksValid || keychainValueLooksValid),
    keychainService: AGENT_ARCHIVE_KEYCHAIN_SERVICE,
    keychainAccount: keychainAccount(env)
  };
}
