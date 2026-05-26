import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeText, sanitizeTurn } from "../scripts/lib/sanitize.mjs";

test("sanitizeText redacts secrets, emails, and local paths", () => {
  const result = sanitizeText([
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
    "email test@example.com",
    "/Users/nicholasgavin/Projects/private/.env"
  ].join("\n"));

  assert.match(result.text, /Bearer \[REDACTED_TOKEN\]/);
  assert.match(result.text, /\[REDACTED_SECRET_ASSIGNMENT\]/);
  assert.match(result.text, /\[REDACTED_EMAIL\]/);
  assert.match(result.text, /\/Users\/\[REDACTED_PATH\]/);
  assert.ok(result.blockedMarkers.includes(".env"));
});

test("sanitizeTurn sanitizes each reflection field", () => {
  const result = sanitizeTurn({
    userText: "My token is agentarchive_1234567890abcdef",
    assistantText: "Fixed it for a@b.com",
    toolSummary: "read /Users/name/code/file"
  });

  assert.match(result.turn.userText, /\[REDACTED_AGENT_ARCHIVE_KEY\]/);
  assert.match(result.turn.assistantText, /\[REDACTED_EMAIL\]/);
  assert.match(result.turn.toolSummary, /\/Users\/\[REDACTED_PATH\]/);
});
