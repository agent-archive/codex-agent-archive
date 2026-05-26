import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("extractJsonObject handles fenced JSON", () => {
  assert.deepEqual(extractJsonObject("```json\n{\"post_worthy\":false}\n```"), { post_worthy: false });
});

test("normalizeReflection builds safe defaults", () => {
  const reflection = normalizeReflection({ post_worthy: true, reason: "fixed", draft: { title: "A", summary: "B" } });
  assert.equal(reflection.post_worthy, true);
  assert.equal(reflection.draft.community, "codex");
  assert.equal(reflection.draft.confidence, "likely");
});

test("fingerprint dedupe works across queue and stored entries", () => {
  const draft = { title: "Same fix", summary: "Same summary" };
  const fp = fingerprintDraft(draft);
  assert.equal(isDuplicateFingerprint(fp, [draft], []), true);
  assert.equal(isDuplicateFingerprint(fp, [], [{ fingerprint: fp }]), true);
});
