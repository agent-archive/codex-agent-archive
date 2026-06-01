import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runReflectionTool, turnFromReflectionToolInput } from "../scripts/lib/reflection-tool.mjs";
import { fakeToolkitEnv } from "./helpers/fake-toolkit.mjs";

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
      tool_summary: [
        "read: inspected .mcp.json",
        "exec: reran doctor and verified the missing bearer token"
      ].join("\n"),
      cwd: repoRoot,
      session_id: "s1",
      turn_id: "t1"
    }
  };
}

function tempEnv() {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-tool-home-"));
  return {
    ...process.env,
    HOME: home,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    ...fakeToolkitEnv(home),
    AGENT_ARCHIVE_PUBLISH_POLICY: "queue",
    AGENT_ARCHIVE_REFLECTION_VISIBILITY: "tool",
    AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE: mockReflection()
  };
}

test("turnFromReflectionToolInput accepts nested current_turn fields", () => {
  const turn = turnFromReflectionToolInput(meaningfulToolInput(), { PWD: repoRoot });

  assert.match(turn.userText, /MCP 401/);
  assert.match(turn.assistantText, /missing bearer token/);
  assert.match(turn.toolSummary, /reran doctor/);
  assert.equal(turn.cwd, repoRoot);
  assert.equal(turn.turnId, "t1");
});

test("runReflectionTool writes latest status, queues drafts, and returns compact stats", async () => {
  const env = tempEnv();
  const result = await runReflectionTool(meaningfulToolInput(), {
    pluginRoot: repoRoot,
    env
  });

  assert.equal(result.status, "draft_created");
  assert.match(result.line, /Agent Archive: Draft queued/);
  assert.equal(result.queue.untriaged, 1);
  assert.equal(result.queue.drafts.length, 1);
  assert.match(result.created.title, /Codex MCP 401/);

  const latest = JSON.parse(readFileSync(path.join(env.PLUGIN_DATA, "latest-reflection.json"), "utf8"));
  assert.equal(latest.status, "draft_created");
  assert.equal(latest.modeSource, "agent_archive_reflection");
});

test("runReflectionTool bypasses the heuristic gate when configured off", async () => {
  const env = {
    ...tempEnv(),
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "false"
  };
  const result = await runReflectionTool({
    mode: "end_of_turn",
    current_turn: {
      user_request: "thanks",
      intended_answer: "done",
      tool_summary: "",
      cwd: repoRoot
    }
  }, {
    pluginRoot: repoRoot,
    env
  });

  assert.equal(result.status, "draft_created");
  assert.match(result.created.title, /Codex MCP 401/);
});

test("runReflectionTool skips low-signal turns when the heuristic gate is on", async () => {
  const env = {
    ...tempEnv(),
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "true"
  };
  const result = await runReflectionTool({
    mode: "end_of_turn",
    current_turn: {
      user_request: "thanks",
      intended_answer: "done",
      tool_summary: "",
      cwd: repoRoot
    }
  }, {
    pluginRoot: repoRoot,
    env
  });

  assert.equal(result.status, "skipped");
  assert.match(result.reason, /reflection gate/);
  assert.equal(result.created, null);
});

test("UserPromptSubmit hook injects reflection tool instructions for tool and verbose visibility", () => {
  const tool = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", turn_id: "t1", prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-")),
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "tool"
    }
  });

  assert.equal(tool.status, 0, tool.stderr);
  const output = JSON.parse(tool.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(output.hookSpecificOutput.additionalContext, /agent_archive_reflection/);
  assert.match(output.hookSpecificOutput.additionalContext, /Before your final answer/);

  const verbose = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-")),
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "verbose"
    }
  });

  assert.equal(verbose.status, 0, verbose.stderr);
  assert.match(JSON.parse(verbose.stdout).hookSpecificOutput.additionalContext, /append its compact Agent Archive status line/);

  const silent = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-")),
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "silent"
    }
  });

  assert.equal(silent.status, 0, silent.stderr);
  assert.equal(silent.stdout, "");
});

test("UserPromptSubmit hook emits no reflection instruction when visibility is off", () => {
  const disabled = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", turn_id: "t1", prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-")),
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "off"
    }
  });

  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(disabled.stdout, "");
});

function callMcp(messages, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "mcp-reflection-server.mjs")], {
      cwd: repoRoot,
      env: {
        ...env,
        PLUGIN_ROOT: repoRoot
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
      resolve(stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line)));
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

test("MCP reflection server lists and calls the reflection tool", async () => {
  const env = tempEnv();
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
        arguments: meaningfulToolInput()
      }
    }
  ], env);

  assert.equal(responses[0].result.serverInfo.name, "agent-archive-reflection");
  assert.equal(responses[1].result.tools[0].name, "agent_archive_reflection");
  assert.equal(responses[2].result.structuredContent.status, "draft_created");
  assert.match(responses[2].result.content[0].text, /Agent Archive: Draft queued/);
});
