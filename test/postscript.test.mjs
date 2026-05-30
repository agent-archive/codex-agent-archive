import test from "node:test";
import assert from "node:assert/strict";
import { buildStopContinuation, formatReflectionPostscript } from "../scripts/lib/postscript.mjs";
import { summarizeQueueDrafts } from "../scripts/lib/toolkit.mjs";

test("summarizeQueueDrafts treats pending drafts as untriaged", () => {
  const summary = summarizeQueueDrafts([
    { id: "p1", title: "Pending one", status: "pending" },
    { id: "d1", title: "Dismissed", status: "dismissed" },
    { id: "i1", title: "Ignored", status: "ignored" },
    { id: "posted1", title: "Posted", status: "posted" }
  ]);

  assert.equal(summary.pending, 1);
  assert.equal(summary.untriaged.length, 1);
  assert.equal(summary.untriaged[0].id, "p1");
});

test("formatReflectionPostscript renders draft and queue status", () => {
  const postscript = formatReflectionPostscript({
    status: "draft_created",
    durationMs: 1234,
    created: { title: "Useful Codex learning" },
    queue: summarizeQueueDrafts([{ id: "p1", title: "Pending one", status: "pending" }])
  });

  assert.match(postscript, /Agent Archive: Draft queued/);
  assert.match(postscript, /Queued "Useful Codex learning"\./);
  assert.match(postscript, /queue 1: p1 - Pending one/);
  assert.match(postscript, /1\.2s/);
  assert.equal(postscript.includes("\n"), false);
});

test("formatReflectionPostscript labels each reflection status", () => {
  const cases = [
    ["skipped", "No post-worthy learning"],
    ["not_post_worthy", "No post-worthy learning"],
    ["draft_created", "Draft queued"],
    ["duplicate", "Duplicate skipped"],
    ["error", "Reflection error"],
    ["timeout", "Reflection timed out"],
    ["disabled", "Reflection disabled"]
  ];

  for (const [status, label] of cases) {
    const postscript = formatReflectionPostscript({
      status,
      reason: "Short reason.",
      durationMs: 0,
      queue: summarizeQueueDrafts([])
    });

    assert.match(postscript, new RegExp(`Agent Archive: ${label}`));
    assert.match(postscript, /\| .+ \| queue 0/);
    assert.match(postscript, /queue 0/);
    assert.equal(postscript.includes("\n"), false);
  }
});

test("buildStopContinuation returns Stop-hook continuation JSON", () => {
  const output = buildStopContinuation({
    status: "timeout",
    reason: "Reflection exceeded 10ms.",
    durationMs: 10,
    queue: summarizeQueueDrafts([])
  });

  assert.equal(output.decision, "block");
  assert.match(output.reason, /Print exactly this single Agent Archive status line/);
  assert.match(output.reason, /Agent Archive: Reflection timed out/);
});
