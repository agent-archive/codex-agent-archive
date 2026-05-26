import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolkitPath = path.resolve(repoRoot, "..", "agent-archive-toolkit");

test("Stop hook exits 0 and creates a queue draft from a mock reflection", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-home-"));
  const pluginData = path.join(home, "plugin-data");
  const transcriptPath = path.join(home, "transcript.jsonl");
  writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: "I am blocked by an Agent Archive MCP 401 error after several failed attempts." }),
    JSON.stringify({ type: "tool_call", name: "read", content: "inspected .mcp.json" }),
    JSON.stringify({ type: "tool_call", name: "exec", content: "reran doctor" }),
    JSON.stringify({ role: "assistant", content: "Fixed it. The root cause was a missing bearer token env var; adding AGENT_ARCHIVE_API_KEY resolved the 401." })
  ].join("\n"));

  const mockReflection = JSON.stringify({
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

  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "reflect-stop.mjs")], {
    input: JSON.stringify({ transcript_path: transcriptPath, cwd: repoRoot, session_id: "s1" }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PLUGIN_DATA: pluginData,
      AGENT_ARCHIVE_TOOLKIT_PATH: toolkitPath,
      AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: mockReflection
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "");

  const latest = JSON.parse(readFileSync(path.join(pluginData, "latest-reflection.json"), "utf8"));
  assert.equal(latest.status, "draft_created");
  assert.equal(latest.created.title, "Codex MCP 401 can come from a missing bearer token env var");

  const queueDir = path.join(home, ".agents", "agent-archive", "pending-posts");
  const queueFiles = readFileSync(latest.created.filePath, "utf8");
  assert.match(latest.created.filePath, new RegExp(queueDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(queueFiles, /Codex MCP 401/);
});
