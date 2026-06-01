#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReflectionSettings } from "./lib/reflection-mode.mjs";
import { findToolkitCommand, queueSummary, runToolkit } from "./lib/toolkit.mjs";
import { pluginDataDir, readLatestReflection } from "./lib/status-store.mjs";
import { agentArchiveKeyStatus } from "./lib/agent-archive-key.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const json = process.argv.includes("--json");

function check(name, ok, detail = "") {
  return { name, ok: Boolean(ok), detail };
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
const mcpServers = mcp?.mcpServers || mcp || {};
const hooks = readJson(path.join(pluginRoot, "hooks", "hooks.json"));
const toolkit = findToolkitCommand(pluginRoot);
const keyStatus = agentArchiveKeyStatus();

let toolkitDoctor = null;
let queue = null;
try {
  if (toolkit) toolkitDoctor = runToolkit(pluginRoot, ["queue", "doctor", "--json"]);
  if (toolkit) queue = queueSummary(pluginRoot);
} catch (error) {
  toolkitDoctor = error instanceof Error ? error.message : String(error);
}

const checks = [
  check("plugin manifest", manifest?.name === "codex-agent-archive", ".codex-plugin/plugin.json"),
  check("skill", existsSync(path.join(pluginRoot, "skills", "agent-archive", "SKILL.md")), "skills/agent-archive/SKILL.md"),
  check("mcp config", Boolean(mcpServers?.["agent-archive"]?.url), ".mcp.json uses existing Agent Archive MCP"),
  check("stop hook", Boolean(hooks?.hooks?.Stop?.length), "hooks/hooks.json"),
  check("toolkit", Boolean(toolkit), toolkit?.source || "not found"),
  check("queue", Boolean(queue), queue ? `${queue.pending} pending / ${queue.total} total` : "unavailable"),
  check("reflection provider", Boolean(resolveReflectionSettings().reflectionProvider), "codex is default; OpenAI key is only needed for provider=api"),
  check(
    "Agent Archive key",
    keyStatus.processEnvConfigured,
    keyStatus.processEnvConfigured
      ? "available in current process"
      : `missing in current process; launchctl ${keyStatus.launchctlConfigured ? "set" : "missing"}, Keychain ${keyStatus.keychainConfigured ? "found" : "missing"}${keyStatus.readyForRestartedCodex ? ", ready after Codex restart" : ""}`
  )
];

const result = {
  ok: checks.every((item) => item.ok || item.name === "Agent Archive key"),
  pluginRoot,
  pluginData: pluginDataDir(),
  reflectionSettings: resolveReflectionSettings(),
  agentArchiveKey: keyStatus,
  checks,
  toolkitDoctor,
  queue,
  latestReflection: readLatestReflection()
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log("Agent Archive Codex connector doctor");
  for (const item of checks) {
    console.log(`${item.ok ? "ok" : "warn"}  ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
  }
  if (result.latestReflection) {
    console.log(`latest reflection: ${result.latestReflection.status} at ${result.latestReflection.timestamp}`);
  }
  console.log(`reflection visibility: ${result.reflectionSettings.visibility} (${result.reflectionSettings.source})`);
  console.log(`reflection gate enabled: ${result.reflectionSettings.reflectionGateEnabled} (${result.reflectionSettings.reflectionGateSource})`);
  console.log(`reflection provider: ${result.reflectionSettings.reflectionProvider} (${result.reflectionSettings.reflectionProviderSource})`);
  console.log(`publish policy: ${result.reflectionSettings.publishPolicy} (${result.reflectionSettings.publishPolicySource})`);
  console.log(`Agent Archive key: process ${result.agentArchiveKey.processEnvConfigured ? "set" : "missing"}, launchctl ${result.agentArchiveKey.launchctlConfigured ? "set" : "missing"}, Keychain ${result.agentArchiveKey.keychainConfigured ? "found" : "missing"}`);
  if (result.agentArchiveKey.readyForRestartedCodex && !result.agentArchiveKey.processEnvConfigured) {
    console.log("Agent Archive key: ready for restarted Codex, but not this already-running process");
  }
}

process.exit(result.ok ? 0 : 1);
