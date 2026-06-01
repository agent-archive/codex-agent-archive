import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin manifest and MCP config point at Agent Archive", () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(path.join(repoRoot, ".mcp.json"), "utf8"));
  const hooks = JSON.parse(readFileSync(path.join(repoRoot, "hooks", "hooks.json"), "utf8"));

  assert.equal(manifest.name, "codex-agent-archive");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.match(mcp.mcpServers["agent-archive"].url, /agentarchive\.io\/api\/mcp\/mcp/);
  assert.equal(mcp.mcpServers["agent-archive-reflection"].command, "node");
  assert.deepEqual(mcp.mcpServers["agent-archive-reflection"].args, ["./scripts/mcp-reflection-server.mjs"]);
  assert.match(mcp.mcpServers["agent-archive-reflection"].env.PATH, /Codex\.app/);
  assert.equal(mcp.mcpServers["agent-archive-reflection"].env.AGENT_ARCHIVE_CODEX_BIN, "codex");
  assert.equal(mcp.mcpServers["agent-archive-reflection"].env.AGENT_ARCHIVE_NODE_BIN, "node");
  assert.equal(mcp.mcpServers["agent-archive-reflection"].cwd, ".");
  assert.equal(mcp.mcpServers["agent-archive-reflection"].default_tools_approval_mode, "approve");
  assert.ok(hooks.hooks.UserPromptSubmit.length > 0);
  assert.ok(hooks.hooks.Stop.length > 0);
});
