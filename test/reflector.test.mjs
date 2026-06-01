import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCodexExecArgs,
  buildCodexExecPrompt,
  buildReflectionPrompt,
  callReflectionModel,
  extractJsonObject,
  fingerprintDraft,
  isDuplicateFingerprint,
  normalizeReflection,
  shouldRunReflection
} from "../scripts/lib/reflector.mjs";

test("shouldRunReflection gates trivial turns", () => {
  const trivial = shouldRunReflection({ userText: "thanks", assistantText: "done", toolSummary: "" });
  assert.equal(trivial.run, false);
});

test("shouldRunReflection passes meaningful unblocking turns", () => {
  const meaningful = shouldRunReflection({
    userText: "The MCP server failed with 401 and I was blocked.",
    assistantText: "Fixed it. The root cause was a missing Authorization bearer header; adding it resolved the issue.",
    toolSummary: "read: config\nexec: test"
  });
  assert.equal(meaningful.run, true);
});

test("buildReflectionPrompt defaults to strict novel-learning criteria", () => {
  const prompt = buildReflectionPrompt({
    userText: "What changed?",
    assistantText: "Explained the current status.",
    toolSummary: ""
  });

  assert.match(prompt, /Default to post_worthy=false/);
  assert.match(prompt, /during this exact turn/);
  assert.match(prompt, /genuinely novel/);
  assert.match(prompt, /confirmed by evidence in this turn/);
  assert.match(prompt, /routine commits, status checks, queue management, setup instructions, prompt discussion, or successful retries/);
  assert.match(prompt, /If unsure, return post_worthy=false/);
});

test("extractJsonObject handles fenced JSON", () => {
  assert.deepEqual(extractJsonObject("```json\n{\"post_worthy\":false}\n```"), { post_worthy: false });
});

test("normalizeReflection builds safe defaults", () => {
  const reflection = normalizeReflection({ post_worthy: true, reason: "fixed", draft: { title: "A", summary: "B" } });
  assert.equal(reflection.post_worthy, true);
  assert.equal(reflection.draft.community, "codex");
  assert.equal(reflection.draft.confidence, "likely");
});

test("normalizeReflection ignores model confidence and uses fixed toolkit metadata", () => {
  assert.equal(normalizeReflection({ post_worthy: true, confidence: 0.9, draft: {} }).draft.confidence, "likely");
  assert.equal(normalizeReflection({ post_worthy: true, draft: { confidence: "confirmed" } }).draft.confidence, "likely");
});

function writeFakeCodex(scriptBody) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-fake-codex-"));
  const script = path.join(dir, "codex-fake.mjs");
  writeFileSync(script, `#!/usr/bin/env node\n${scriptBody}`, "utf8");
  chmodSync(script, 0o755);
  return script;
}

test("buildCodexExecPrompt and args isolate the child Codex reflection run", () => {
  const prompt = buildCodexExecPrompt({
    cwd: "/tmp/example",
    userText: "The tool failed with an error until we fixed the root cause.",
    assistantText: "The workaround resolved the issue.",
    toolSummary: "read config\nran tests"
  });
  assert.match(prompt, /isolated Codex reflection subtask/);
  assert.match(prompt, /post_worthy/);

  const args = buildCodexExecArgs("PROMPT", {});
  assert.deepEqual(args.slice(0, 7), ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never"]);
  assert.equal(args.at(-1), "PROMPT");
});

test("callReflectionModel uses codex provider without OpenAI API key", async () => {
  const fakeCodex = writeFakeCodex(`
const prompt = process.argv.at(-1) || "";
if (!prompt.includes("post_worthy")) process.exit(2);
if (process.env.AGENT_ARCHIVE_REFLECTION_VISIBILITY !== "off") process.exit(3);
process.stdout.write(JSON.stringify({
  post_worthy: true,
  reason: "Nested Codex found a reusable fix.",
  draft: {
    title: "Use nested Codex for Agent Archive reflection",
    summary: "A child Codex exec can produce strict reflection JSON without an OpenAI API key.",
    body: "Run a sandboxed child Codex process and parse its JSON.",
    tags: ["codex", "reflection"]
  }
}));
`);

  const reflection = await callReflectionModel({
    cwd: process.cwd(),
    userText: "The reflection provider was unavailable, causing reflection to fail.",
    assistantText: "Resolved it by using a nested Codex provider workaround.",
    toolSummary: "exec: tested fake codex\nexec: fixed provider"
  }, {
    ...process.env,
    AGENT_ARCHIVE_CODEX_BIN: fakeCodex
  }, { provider: "codex" });

  assert.equal(reflection.post_worthy, true);
  assert.match(reflection.draft.title, /nested Codex/);
});

test("callReflectionModel resolves configured codex binary names through PATH", async () => {
  const fakeCodex = writeFakeCodex(`
process.stdout.write(JSON.stringify({
  post_worthy: false,
  reason: "relative binary name resolved",
  signals: []
}));
`);

  const reflection = await callReflectionModel({
    cwd: process.cwd(),
    userText: "test",
    assistantText: "test",
    toolSummary: "test"
  }, {
    ...process.env,
    AGENT_ARCHIVE_CODEX_BIN: path.basename(fakeCodex),
    PATH: path.dirname(fakeCodex)
  }, { provider: "codex" });

  assert.equal(reflection.post_worthy, false);
  assert.equal(reflection.reason, "relative binary name resolved");
});

test("callReflectionModel reports unavailable and malformed codex provider output", async () => {
  await assert.rejects(
    () => callReflectionModel({ cwd: process.cwd() }, { ...process.env, AGENT_ARCHIVE_CODEX_BIN: "/no/such/codex" }, { provider: "codex" }),
    /Codex executable not found/
  );

  const fakeCodex = writeFakeCodex('process.stdout.write("not json");');
  await assert.rejects(
    () => callReflectionModel({ cwd: process.cwd() }, { ...process.env, AGENT_ARCHIVE_CODEX_BIN: fakeCodex }, { provider: "codex" }),
    /Model response did not contain a JSON object/
  );
});

test("fingerprint dedupe works across queue and stored entries", () => {
  const draft = { title: "Same fix", summary: "Same summary" };
  const fp = fingerprintDraft(draft);
  assert.equal(isDuplicateFingerprint(fp, [draft], []), true);
  assert.equal(isDuplicateFingerprint(fp, [], [{ fingerprint: fp }]), true);
});
