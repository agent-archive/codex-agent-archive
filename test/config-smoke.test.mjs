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
  assert.ok(hooks.hooks.Stop.length > 0);
});
