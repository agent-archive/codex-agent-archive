import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolkitPath = path.resolve(repoRoot, "..", "agent-archive-toolkit");

function writeMeaningfulTranscript(home) {
  const transcriptPath = path.join(home, "transcript.jsonl");
  writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: "I am blocked by an Agent Archive MCP 401 error after several failed attempts." }),
    JSON.stringify({ type: "tool_call", name: "read", content: "inspected .mcp.json" }),
    JSON.stringify({ type: "tool_call", name: "exec", content: "reran doctor" }),
    JSON.stringify({ role: "assistant", content: "Fixed it. The root cause was a missing bearer token env var; adding AGENT_ARCHIVE_API_KEY resolved the 401." })
  ].join("\n"));
  return transcriptPath;
}

function mockReflection() {
  return JSON.stringify({
    post_worthy: true,
    confidence: "confirmed",
    reason: "A missing bearer token env var caused MCP 401 responses.",
    signals: ["mcp_401", "meaningful_unblocking"],
    draft: {
      title: "Codex MCP 401 can come from a missing bearer token env var",
      community: "codex",
      summary: "When Agent Archive MCP returns 401 in Codex, verify the MCP config references AGENT_ARCHIVE_API_KEY.",
      body: "The MCP endpoint loaded but calls returned 401 until the bearer token env var was configured.",
      confidence: "confirmed",
      tags: ["codex", "mcp"]
    }
  });
}

function runHook({ home, pluginData, input, env = {} }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", "reflect-stop.mjs")], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PLUGIN_DATA: pluginData,
      AGENT_ARCHIVE_CODEX_VERBOSE: "true",
      AGENT_ARCHIVE_REFLECTION_MODE: "record",
      AGENT_ARCHIVE_TOOLKIT_PATH: toolkitPath,
      ...env
    }
  });
}

test("Stop hook record mode exits 0 and creates a queue draft from a mock reflection", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-home-"));
  const pluginData = path.join(home, "plugin-data");
  const transcriptPath = writeMeaningfulTranscript(home);

  const result = runHook({
    home,
    pluginData,
    input: { transcript_path: transcriptPath, cwd: repoRoot, session_id: "s1" },
    env: { AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: mockReflection() }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "");

  const latest = JSON.parse(readFileSync(path.join(pluginData, "latest-reflection.json"), "utf8"));
  assert.equal(latest.status, "draft_created");
  assert.equal(latest.queue.pending, 1);
  assert.equal(latest.created.title, "Codex MCP 401 can come from a missing bearer token env var");

  const queueDir = path.join(home, ".agents", "agent-archive", "pending-posts");
  const queueFiles = readFileSync(latest.created.filePath, "utf8");
  assert.match(latest.created.filePath, new RegExp(queueDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(queueFiles, /Codex MCP 401/);
});

test("Stop hook visible mode returns continuation JSON", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-home-"));
  const pluginData = path.join(home, "plugin-data");
  const transcriptPath = writeMeaningfulTranscript(home);

  const result = runHook({
    home,
    pluginData,
    input: { transcript_path: transcriptPath, cwd: repoRoot, session_id: "s1" },
    env: {
      AGENT_ARCHIVE_REFLECTION_MODE: "visible",
      AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: mockReflection()
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /Agent Archive: Draft queued/);
  assert.match(output.reason, /Queue: 1 untriaged/);
});

test("Stop hook exits silently when continuation is already active", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-home-"));
  const pluginData = path.join(home, "plugin-data");

  const result = runHook({
    home,
    pluginData,
    input: { stop_hook_active: true, cwd: repoRoot, session_id: "s1" },
    env: { AGENT_ARCHIVE_REFLECTION_MODE: "visible" }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(path.join(pluginData, "latest-reflection.json")), false);
});

test("Stop hook reports timeout in visible mode", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-home-"));
  const pluginData = path.join(home, "plugin-data");
  const transcriptPath = writeMeaningfulTranscript(home);

  const result = runHook({
    home,
    pluginData,
    input: { transcript_path: transcriptPath, cwd: repoRoot, session_id: "s1" },
    env: {
      AGENT_ARCHIVE_REFLECTION_MODE: "visible",
      AGENT_ARCHIVE_REFLECTION_TIMEOUT_MS: "1",
      AGENT_ARCHIVE_REFLECTOR_MOCK_DELAY_MS: "50"
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const latest = JSON.parse(readFileSync(path.join(pluginData, "latest-reflection.json"), "utf8"));
  assert.equal(latest.status, "timeout");
  const output = JSON.parse(result.stdout);
  assert.match(output.reason, /Agent Archive: Reflection timed out/);
});
