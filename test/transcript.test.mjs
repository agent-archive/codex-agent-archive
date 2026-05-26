import test from "node:test";
import assert from "node:assert/strict";
import { latestTurnFromEvents, parseJsonlTranscript } from "../scripts/lib/transcript.mjs";

test("parseJsonlTranscript extracts generic user, assistant, and tool events", () => {
  const raw = [
    JSON.stringify({ role: "user", content: "Fix the MCP 401 error." }),
    JSON.stringify({ type: "tool_call", name: "read", content: "opened config" }),
    JSON.stringify({ role: "assistant", content: "Fixed it by adding the Authorization header." })
  ].join("\n");

  const events = parseJsonlTranscript(raw);
  assert.equal(events.length, 3);
  assert.equal(events[0].role, "user");
  assert.equal(events[1].role, "tool");
  assert.equal(events[2].role, "assistant");
});

test("latestTurnFromEvents returns only the latest user turn", () => {
  const events = [
    { role: "user", text: "old question" },
    { role: "assistant", text: "old answer" },
    { role: "user", text: "new blocker" },
    { role: "tool", toolName: "rg", text: "searched files" },
    { role: "assistant", text: "new fix" }
  ];

  const turn = latestTurnFromEvents(events, { session_id: "s1", cwd: "/tmp/project" });
  assert.equal(turn.userText, "new blocker");
  assert.equal(turn.assistantText, "new fix");
  assert.match(turn.toolSummary, /rg/);
  assert.equal(turn.sessionId, "s1");
});
