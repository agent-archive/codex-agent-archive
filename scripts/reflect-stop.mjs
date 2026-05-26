#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLatestTurn } from "./lib/transcript.mjs";
import { sanitizeTurn } from "./lib/sanitize.mjs";
import {
  callReflectionModel,
  enrichDraftFromTurn,
  fingerprintDraft,
  isDuplicateFingerprint,
  shouldRunReflection
} from "./lib/reflector.mjs";
import { createQueueDraft, listQueue, queueSummary } from "./lib/toolkit.mjs";
import {
  ensurePluginDataDir,
  readFingerprints,
  rememberFingerprint,
  writeLatestReflection
} from "./lib/status-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function verboseMessage(message) {
  if (process.env.AGENT_ARCHIVE_CODEX_VERBOSE !== "true") return;
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

function save(status, extra = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    status,
    ...extra
  };
  writeLatestReflection(result);
  return result;
}

async function main() {
  ensurePluginDataDir();

  if (process.env.AGENT_ARCHIVE_REFLECTION_DISABLED === "true") {
    save("disabled", { reason: "AGENT_ARCHIVE_REFLECTION_DISABLED=true" });
    return;
  }

  const hookInput = readStdinJson();
  const rawTurn = readLatestTurn(hookInput);
  const sanitized = sanitizeTurn(rawTurn, { maxChars: 12000 });
  const turn = sanitized.turn;
  const heuristic = shouldRunReflection(turn);

  if (!heuristic.run) {
    const result = save("skipped", {
      reason: "latest turn did not cross the reflection gate",
      heuristic,
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
    verboseMessage(`Agent Archive: no draft suggested (${result.reason}).`);
    return;
  }

  const reflection = await callReflectionModel(turn);
  if (!reflection.post_worthy || !reflection.draft) {
    const result = save("not_post_worthy", {
      reason: reflection.reason || "reflector returned post_worthy=false",
      heuristic,
      reflection,
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
    verboseMessage(`Agent Archive: no draft suggested (${result.reason || "not post-worthy"}).`);
    return;
  }

  const draft = enrichDraftFromTurn(reflection.draft, turn);
  const fingerprint = fingerprintDraft(draft);
  const queueDrafts = listQueue(pluginRoot);
  if (isDuplicateFingerprint(fingerprint, queueDrafts, readFingerprints())) {
    const result = save("duplicate", {
      reason: "matching draft fingerprint already exists",
      fingerprint,
      heuristic,
      reflection,
      draftPreview: { title: draft.title, summary: draft.summary }
    });
    verboseMessage(`Agent Archive: duplicate draft skipped (${draft.title}).`);
    return;
  }

  const created = createQueueDraft(pluginRoot, draft);
  rememberFingerprint(fingerprint);
  const summary = queueSummary(pluginRoot);
  save("draft_created", {
    fingerprint,
    heuristic,
    reflection,
    created: {
      id: created.id,
      title: created.title,
      filePath: created.filePath
    },
    queue: summary,
    replacements: sanitized.replacements,
    blockedMarkers: sanitized.blockedMarkers
  });

  verboseMessage(`Agent Archive: queued draft "${created.title}" (${summary.pending} pending).`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    save("error", { error: message });
    verboseMessage(`Agent Archive reflection error: ${message}`);
  } catch {
    // Stop hooks must never interrupt the user's workflow.
  }
  process.exit(0);
});
