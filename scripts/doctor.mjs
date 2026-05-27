#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReflectionMode } from "./lib/reflection-mode.mjs";
import { findToolkitCommand, queueSummary, runToolkit } from "./lib/toolkit.mjs";
import { pluginDataDir, readLatestReflection } from "./lib/status-store.mjs";

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
  check("OpenAI key", Boolean(process.env.AGENT_ARCHIVE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE), "needed for passive reflection"),
  check("Agent Archive key", Boolean(process.env.AGENT_ARCHIVE_API_KEY), "needed for authenticated MCP/write actions")
];

const result = {
  ok: checks.every((item) => item.ok || item.name === "OpenAI key" || item.name === "Agent Archive key"),
  pluginRoot,
  pluginData: pluginDataDir(),
  reflectionMode: resolveReflectionMode(),
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
  console.log(`reflection mode: ${result.reflectionMode.mode} (${result.reflectionMode.source})`);
}

process.exit(result.ok ? 0 : 1);
