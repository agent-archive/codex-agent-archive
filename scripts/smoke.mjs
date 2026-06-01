#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { queueSummary } from "./lib/toolkit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const json = process.argv.includes("--json");

function ok(name, detail = "") {
  return { name, status: "ok", detail };
}

function fail(name, error) {
  return { name, status: "error", detail: error instanceof Error ? error.message : String(error) };
}

function runHookSmoke(env = process.env) {
  const pluginData = mkdtempSync(path.join(tmpdir(), "agent-archive-smoke-hook-"));
  const result = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "inject-reflection-tool.mjs")], {
    cwd: pluginRoot,
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      turn_id: "smoke-turn",
      session_id: "smoke-session",
      prompt: "smoke"
    }),
    encoding: "utf8",
    env: {
      ...env,
      PLUGIN_DATA: pluginData,
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "tool"
    }
  });
  if (result.status !== 0) throw new Error(result.stderr || `hook exited ${result.status}`);
  const parsed = JSON.parse(result.stdout);
  const context = parsed.hookSpecificOutput?.additionalContext || "";
  for (const pattern of [/search_archive/, /agent_archive_reflection/, /started_at_ms: \d+/, /turn_id: "smoke-turn"/]) {
    if (!pattern.test(context)) throw new Error(`hook output missing ${pattern}`);
  }
  return ok("hook injection", "stuck-search and reflection metadata present");
}

function callMcp(messages, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, "scripts", "mcp-reflection-server.mjs")], {
      cwd: pluginRoot,
      env: {
        ...env,
        PLUGIN_ROOT: pluginRoot
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `MCP server exited ${code}`));
        return;
      }
      try {
        resolve(stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

async function runReflectionSmoke(env = process.env) {
  const pluginData = mkdtempSync(path.join(tmpdir(), "agent-archive-smoke-reflection-"));
  const responses = await callMcp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "agent_archive_reflection",
        arguments: {
          mode: "end_of_turn",
          current_turn: {
            user_request: "smoke test",
            intended_answer: "smoke test complete",
            tool_summary: "",
            cwd: pluginRoot,
            started_at_ms: Date.now()
          }
        }
      }
    }
  ], {
    ...env,
    PLUGIN_DATA: pluginData,
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "false",
    AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: JSON.stringify({
      post_worthy: false,
      reason: "smoke test only",
      signals: [],
      draft: null
    })
  });

  const listed = responses.find((item) => item.id === 2);
  const called = responses.find((item) => item.id === 3);
  if (listed?.result?.tools?.[0]?.name !== "agent_archive_reflection") throw new Error("reflection tool was not listed");
  if (called?.result?.structuredContent?.status !== "not_post_worthy") {
    throw new Error(`unexpected reflection status: ${called?.result?.structuredContent?.status || "missing"}`);
  }
  if (called.result.structuredContent.created) throw new Error("smoke test created a draft");
  return ok("reflection MCP", "listed and called without creating a draft");
}

function runQueueSmoke(env = process.env) {
  const before = queueSummary(pluginRoot, { env });
  const after = queueSummary(pluginRoot, { env });
  if (after.total !== before.total || after.pending !== before.pending) {
    throw new Error("queue summary changed while smoke test was reading it");
  }
  return ok("queue summary", `${after.pending} pending / ${after.total} total`);
}

const checks = [];
try {
  checks.push(runHookSmoke());
} catch (error) {
  checks.push(fail("hook injection", error));
}
try {
  checks.push(await runReflectionSmoke());
} catch (error) {
  checks.push(fail("reflection MCP", error));
}
try {
  checks.push(runQueueSmoke());
} catch (error) {
  checks.push(fail("queue summary", error));
}

const result = {
  ok: checks.every((item) => item.status === "ok"),
  checks
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log("Agent Archive Codex connector smoke");
  for (const item of checks) console.log(`${item.status.padEnd(5)} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
}

process.exit(result.ok ? 0 : 1);
