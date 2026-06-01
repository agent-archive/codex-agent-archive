import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runReflectionTool, turnFromReflectionToolInput } from "../scripts/lib/reflection-tool.mjs";
import { writeLatestTurnStart } from "../scripts/lib/status-store.mjs";
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

function spawnPromptInjection(visibility, prompt = "hello") {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", turn_id: "t1", prompt }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-")),
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: visibility
    }
  });
}

function additionalContext(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

test("turnFromReflectionToolInput accepts nested current_turn fields", () => {
  const turn = turnFromReflectionToolInput(meaningfulToolInput(), { PWD: repoRoot });

  assert.match(turn.userText, /MCP 401/);
  assert.match(turn.assistantText, /missing bearer token/);
  assert.match(turn.toolSummary, /reran doctor/);
  assert.equal(turn.toolCallCount, 2);
  assert.equal(turn.cwd, repoRoot);
  assert.equal(turn.turnId, "t1");
});

test("turnFromReflectionToolInput computes elapsed time from visible tool metadata", () => {
  const turn = turnFromReflectionToolInput({
    mode: "end_of_turn",
    current_turn: {
      user_request: "Please summarize the implementation.",
      intended_answer: "Done.",
      started_at_ms: 1000
    }
  }, { PWD: repoRoot }, 92001);

  assert.equal(turn.elapsedTurnMs, 91001);
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

test("runReflectionTool uses recorded turn start for time-based gate trigger", async () => {
  const env = {
    ...tempEnv(),
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "true"
  };
  writeLatestTurnStart({
    turnId: "elapsed-turn",
    startedAt: new Date(Date.now() - 91000).toISOString(),
    startedAtMs: Date.now() - 91000
  }, env);

  const result = await runReflectionTool({
    mode: "end_of_turn",
    current_turn: {
      user_request: "Please summarize the implementation.",
      intended_answer: "Done. The implementation is complete.",
      tool_summary: "",
      cwd: repoRoot,
      turn_id: "elapsed-turn"
    }
  }, {
    pluginRoot: repoRoot,
    env
  });

  assert.equal(result.status, "draft_created");
  const latest = JSON.parse(readFileSync(path.join(env.PLUGIN_DATA, "latest-reflection.json"), "utf8"));
  assert.equal(latest.heuristic.timeSignal, true);
  assert.ok(latest.heuristic.elapsedTurnMs > 90000);
});

test("runReflectionTool uses explicit visible-tool start metadata for time-based gate trigger", async () => {
  const env = {
    ...tempEnv(),
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "true"
  };

  const result = await runReflectionTool({
    mode: "end_of_turn",
    current_turn: {
      user_request: "Please summarize the implementation.",
      intended_answer: "Done. The implementation is complete.",
      tool_summary: "",
      cwd: repoRoot,
      turn_id: "elapsed-turn",
      started_at_ms: Date.now() - 91000
    }
  }, {
    pluginRoot: repoRoot,
    env
  });

  assert.equal(result.status, "draft_created");
  const latest = JSON.parse(readFileSync(path.join(env.PLUGIN_DATA, "latest-reflection.json"), "utf8"));
  assert.equal(latest.heuristic.timeSignal, true);
  assert.ok(latest.heuristic.elapsedTurnMs > 90000);
});

test("UserPromptSubmit hook records turn start timestamp", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-inject-"));
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "inject-reflection-tool.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", turn_id: "turn-start-test", session_id: "s1", prompt: "hello" }),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: pluginData,
      AGENT_ARCHIVE_REFLECTION_VISIBILITY: "tool"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const turnStart = JSON.parse(readFileSync(path.join(pluginData, "latest-turn-start.json"), "utf8"));
  assert.equal(turnStart.turnId, "turn-start-test");
  assert.equal(turnStart.sessionId, "s1");
  assert.ok(Number.isFinite(turnStart.startedAtMs));

  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /turn_id: "turn-start-test"/);
  assert.match(context, /started_at_ms: \d+/);
});

test("UserPromptSubmit hook injects stuck-search guidance for every visibility", () => {
  for (const visibility of ["tool", "verbose", "silent", "off"]) {
    const context = additionalContext(spawnPromptInjection(visibility));

    assert.match(context, /search_archive/);
    assert.match(context, /routine prompts/);
    assert.match(context, /two failed local attempts/);
    assert.match(context, /multiple distinct errors/);
    assert.match(context, /same error recurring/);
    assert.match(context, /stuck or blocked/);
    assert.match(context, /before a third local attempt/);
    assert.match(context, /titles and summaries/);
    assert.match(context, /get_post/);
    assert.match(context, /untrusted evidence/);
  }
});

test("UserPromptSubmit hook keeps reflection instructions gated to tool and verbose visibility", () => {
  const tool = additionalContext(spawnPromptInjection("tool"));
  assert.match(tool, /agent_archive_reflection/);
  assert.match(tool, /Before your final answer/);

  const verbose = additionalContext(spawnPromptInjection("verbose"));
  assert.match(verbose, /agent_archive_reflection/);
  assert.match(verbose, /append its compact Agent Archive status line/);

  const silent = additionalContext(spawnPromptInjection("silent"));
  assert.doesNotMatch(silent, /agent_archive_reflection/);
  assert.doesNotMatch(silent, /Before your final answer/);

  const disabled = additionalContext(spawnPromptInjection("off"));
  assert.doesNotMatch(disabled, /agent_archive_reflection/);
  assert.doesNotMatch(disabled, /Before your final answer/);
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
