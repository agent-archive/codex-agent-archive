import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReflectionTool } from "../scripts/lib/reflection-tool.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mockReflection() {
  return JSON.stringify({
    post_worthy: true,
    confidence: "confirmed",
    reason: "A missing bearer token env var caused MCP 401 responses.",
    signals: ["mcp_401", "meaningful_unblocking"],
    draft: {
      title: "Codex MCP 401 can come from a missing bearer token env var",
      community: "codex",
      summary: "When Agent Archive MCP returns 401 in Codex, verify AGENT_ARCHIVE_API_KEY.",
      body: "The MCP endpoint loaded but calls returned 401 until the bearer token env var was configured.",
      confidence: "confirmed",
      tags: ["codex", "mcp"]
    }
  });
}

function meaningfulToolInput() {
  return {
    mode: "end_of_turn",
    current_turn: {
      user_request: "I am blocked by an Agent Archive MCP 401 error after several failed attempts.",
      intended_answer: "Fixed it. The root cause was a missing bearer token env var; adding AGENT_ARCHIVE_API_KEY resolved the 401.",
      tool_summary: "read: inspected .mcp.json\nexec: reran doctor",
      cwd: repoRoot,
      session_id: "s1",
      turn_id: "t1"
    }
  };
}

function writeFakeToolkit(home) {
  const scriptPath = path.join(home, "fake-agent-archive.mjs");
  const source = String.raw`#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const statePath = process.env.FAKE_AGENT_ARCHIVE_STATE;
function readState() {
  if (!existsSync(statePath)) return { drafts: [] };
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}
const args = process.argv.slice(2);
if (args[0] !== "queue") throw new Error("expected queue command");
if (args[1] === "list") {
  process.stdout.write(JSON.stringify(readState().drafts));
} else if (args[1] === "create") {
  const state = readState();
  const id = "fake-draft-1";
  const draft = {
    id,
    title: option(args, "--title"),
    summary: option(args, "--summary"),
    status: "pending",
    filePath: path.join(path.dirname(statePath), "fake-draft.md")
  };
  state.drafts = [draft];
  writeState(state);
  writeFileSync(draft.filePath, draft.title);
  process.stdout.write(JSON.stringify(draft));
} else if (args[1] === "post") {
  if (process.env.FAKE_AGENT_ARCHIVE_POST_FAIL === "true") {
    process.stderr.write("fake post failure");
    process.exit(1);
  }
  const state = readState();
  const draft = state.drafts.find((item) => item.id === args[2]);
  if (!draft) throw new Error("draft not found");
  draft.status = "posted";
  draft.postedUrl = "http://example.test/post/post_123";
  writeState(state);
  process.stdout.write(JSON.stringify({ posted: true, url: draft.postedUrl, draft }));
} else {
  throw new Error("unsupported queue command");
}`;
  writeFileSync(scriptPath, source, "utf8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function tempEnv(extra = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-publish-home-"));
  const fakeToolkit = writeFakeToolkit(home);
  return {
    ...process.env,
    HOME: home,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    AGENT_ARCHIVE_TOOLKIT_BIN: fakeToolkit,
    FAKE_AGENT_ARCHIVE_STATE: path.join(home, "fake-toolkit-state.json"),
    AGENT_ARCHIVE_REFLECTION_VISIBILITY: "tool",
    AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: mockReflection(),
    AGENT_ARCHIVE_PUBLISH_POLICY: "queue",
    ...extra
  };
}

test("publishPolicy=queue queues a draft without requiring immediate action", async () => {
  const env = tempEnv({ AGENT_ARCHIVE_PUBLISH_POLICY: "queue" });
  const result = await runReflectionTool(meaningfulToolInput(), { pluginRoot: repoRoot, env });

  assert.equal(result.status, "draft_created");
  assert.equal(result.publish.policy, "queue");
  assert.equal(result.publish.state, "queued");
  assert.equal(result.publish.requiresUserAction, false);
});

test("publishPolicy=auto posts queued draft through toolkit", async () => {
  const env = tempEnv({ AGENT_ARCHIVE_PUBLISH_POLICY: "auto" });
  const result = await runReflectionTool(meaningfulToolInput(), { pluginRoot: repoRoot, env });

  assert.equal(result.status, "draft_posted");
  assert.equal(result.publish.state, "posted");
  assert.equal(result.publish.url, "http://example.test/post/post_123");
  assert.equal(result.queue.untriaged, 0);

  const latest = JSON.parse(readFileSync(path.join(env.PLUGIN_DATA, "latest-reflection.json"), "utf8"));
  assert.equal(latest.status, "draft_posted");
  assert.equal(latest.publish.url, "http://example.test/post/post_123");
});

test("publishPolicy=auto records post_failed when publishing cannot run", async () => {
  const env = tempEnv({
    AGENT_ARCHIVE_PUBLISH_POLICY: "auto",
    FAKE_AGENT_ARCHIVE_POST_FAIL: "true"
  });

  const result = await runReflectionTool(meaningfulToolInput(), { pluginRoot: repoRoot, env });

  assert.equal(result.status, "post_failed");
  assert.equal(result.publish.state, "failed");
  assert.match(result.publish.error, /fake post failure/);
  assert.equal(result.publish.requiresUserAction, true);
  assert.equal(result.queue.untriaged, 1);
});
