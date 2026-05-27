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
import { buildStopContinuation } from "./lib/postscript.mjs";
import { resolveReflectionMode } from "./lib/reflection-mode.mjs";
import { createQueueDraft, listQueue, queueSummary, summarizeQueueDrafts } from "./lib/toolkit.mjs";
import {
  ensurePluginDataDir,
  readFingerprints,
  rememberFingerprint,
  writeLatestReflection
} from "./lib/status-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");
const startedAt = Date.now();
let activeMode = "visible";
let activeModeSource = "default";

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function parseTimeoutMs(env = process.env) {
  const value = Number(env.AGENT_ARCHIVE_REFLECTION_TIMEOUT_MS || 90000);
  return Number.isFinite(value) && value > 0 ? value : 90000;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeQueue(extraDrafts = null) {
  try {
    const queue = extraDrafts ? summarizeQueueDrafts(extraDrafts) : queueSummary(pluginRoot);
    return { queue };
  } catch (error) {
    return { queue: null, queueError: errorMessage(error) };
  }
}

function save(status, extra = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    status,
    mode: activeMode,
    modeSource: activeModeSource,
    durationMs: Date.now() - startedAt,
    ...extra
  };
  writeLatestReflection(result);
  return result;
}

function maybeContinueWithPostscript(result) {
  if (activeMode !== "visible") return;
  process.stdout.write(`${JSON.stringify(buildStopContinuation(result))}\n`);
}

async function withReflectionTimeout(fn, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`Reflection exceeded ${timeoutMs}ms.`);
      error.code = "AGENT_ARCHIVE_REFLECTION_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const hookInput = readStdinJson();
  if (hookInput.stop_hook_active === true) return;

  ensurePluginDataDir();

  const mode = resolveReflectionMode();
  activeMode = mode.mode;
  activeModeSource = mode.source;

  if (activeMode === "off") {
    save("disabled", {
      reason: mode.reason || "reflection mode is off",
      ...safeQueue()
    });
    return;
  }

  const rawTurn = readLatestTurn(hookInput);
  const sanitized = sanitizeTurn(rawTurn, { maxChars: 12000 });
  const turn = sanitized.turn;
  const heuristic = shouldRunReflection(turn);

  if (!heuristic.run) {
    const result = save("skipped", {
      reason: "latest turn did not cross the reflection gate",
      heuristic,
      ...safeQueue(),
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
    maybeContinueWithPostscript(result);
    return;
  }

  let reflection;
  const timeoutMs = parseTimeoutMs();
  try {
    reflection = await withReflectionTimeout(
      (signal) => callReflectionModel(turn, process.env, { signal }),
      timeoutMs
    );
  } catch (error) {
    if (error?.code === "AGENT_ARCHIVE_REFLECTION_TIMEOUT") {
      const result = save("timeout", {
        reason: error.message,
        timeoutMs,
        heuristic,
        ...safeQueue(),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
      maybeContinueWithPostscript(result);
      return;
    }
    throw error;
  }

  if (!reflection.post_worthy || !reflection.draft) {
    const result = save("not_post_worthy", {
      reason: reflection.reason || "reflector returned post_worthy=false",
      heuristic,
      reflection,
      ...safeQueue(),
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
    maybeContinueWithPostscript(result);
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
      ...safeQueue(queueDrafts),
      draftPreview: { title: draft.title, summary: draft.summary }
    });
    maybeContinueWithPostscript(result);
    return;
  }

  const created = createQueueDraft(pluginRoot, draft);
  rememberFingerprint(fingerprint);
  const result = save("draft_created", {
    fingerprint,
    heuristic,
    reflection,
    created: {
      id: created.id,
      title: created.title,
      filePath: created.filePath
    },
    ...safeQueue(),
    replacements: sanitized.replacements,
    blockedMarkers: sanitized.blockedMarkers
  });
  maybeContinueWithPostscript(result);
}

main().catch((error) => {
  const message = errorMessage(error);
  try {
    const result = save("error", { error: message, ...safeQueue() });
    maybeContinueWithPostscript(result);
  } catch {
    // Stop hooks must never interrupt the user's workflow.
  }
  process.exit(0);
});
