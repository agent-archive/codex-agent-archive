import { sanitizeTurn } from "./sanitize.mjs";
import {
  callReflectionModel,
  enrichDraftFromTurn,
  fingerprintDraft,
  isDuplicateFingerprint,
  shouldRunReflection
} from "./reflector.mjs";
import { resolveReflectionSettings } from "./reflection-mode.mjs";
import { createQueueDraft, listQueue, postQueueDraft, queueSummary, summarizeQueueDrafts } from "./toolkit.mjs";
import {
  ensurePluginDataDir,
  elapsedTurnMsFromStart,
  readFingerprints,
  rememberFingerprint,
  writeLatestReflection
} from "./status-store.mjs";

export function parseReflectionTimeoutMs(env = process.env) {
  const value = Number(env.AGENT_ARCHIVE_REFLECTION_TIMEOUT_MS || 90000);
  return Number.isFinite(value) && value > 0 ? value : 90000;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeQueue(pluginRoot, env, extraDrafts = null) {
  try {
    const queue = extraDrafts
      ? summarizeQueueDrafts(extraDrafts)
      : queueSummary(pluginRoot, { env });
    return { queue };
  } catch (error) {
    return { queue: null, queueError: errorMessage(error) };
  }
}

export function writeReflectionStatus(status, options = {}) {
  const {
    env = process.env,
    mode = "silent",
    modeSource = "unspecified",
    visibility = mode,
    publishPolicy = "queue",
    reflectionProvider = "codex",
    reflectionGateEnabled = false,
    startedAt = Date.now(),
    extra = {}
  } = options;

  const result = {
    timestamp: new Date().toISOString(),
    status,
    mode,
    modeSource,
    visibility,
    publishPolicy,
    reflectionProvider,
    reflectionGateEnabled,
    durationMs: Date.now() - startedAt,
    ...extra
  };
  writeLatestReflection(result, env);
  return result;
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

export async function runReflectionFlow(options = {}) {
  const {
    turn = {},
    pluginRoot = process.cwd(),
    env = process.env,
    mode = "silent",
    modeSource = "unspecified",
    startedAt = Date.now()
  } = options;
  const settings = options.settings || resolveReflectionSettings(env);
  const visibility = options.visibility || settings.visibility || mode;
  const publishPolicy = options.publishPolicy || settings.publishPolicy || "queue";
  const reflectionProvider = options.reflectionProvider || settings.reflectionProvider || "codex";
  const reflectionGateEnabled = options.reflectionGateEnabled ?? settings.reflectionGateEnabled ?? false;

  ensurePluginDataDir(env);

  const save = (status, extra = {}) => writeReflectionStatus(status, {
    env,
    mode,
    modeSource,
    visibility,
    publishPolicy,
    reflectionProvider,
    reflectionGateEnabled,
    startedAt,
    extra
  });

  if (visibility === "off") {
    return save("disabled", {
      reason: settings.reason || "reflection visibility is off",
      ...safeQueue(pluginRoot, env)
    });
  }

  const elapsedTurnMs = turn.elapsedTurnMs !== null
    && turn.elapsedTurnMs !== undefined
    && Number.isFinite(Number(turn.elapsedTurnMs))
    ? Number(turn.elapsedTurnMs)
    : elapsedTurnMsFromStart(turn, env);
  const turnWithGateMetadata = elapsedTurnMs === null
    ? turn
    : { ...turn, elapsedTurnMs };
  const sanitized = sanitizeTurn(turnWithGateMetadata, { maxChars: 12000 });
  const sanitizedTurn = sanitized.turn;
  const heuristic = shouldRunReflection(sanitizedTurn);

  if (reflectionGateEnabled && !heuristic.run) {
    return save("skipped", {
      reason: "latest turn did not cross the reflection gate",
      heuristic,
      ...safeQueue(pluginRoot, env),
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
  }

  let reflection;
  const timeoutMs = parseReflectionTimeoutMs(env);
  try {
    reflection = await withReflectionTimeout(
      (signal) => callReflectionModel(sanitizedTurn, env, {
        signal,
        provider: reflectionProvider
      }),
      timeoutMs
    );
  } catch (error) {
    if (error?.code === "AGENT_ARCHIVE_REFLECTION_TIMEOUT") {
      return save("reflection_timeout", {
        reason: error.message,
        timeoutMs,
        heuristic,
        ...safeQueue(pluginRoot, env),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
    }
    if (error?.code === "AGENT_ARCHIVE_CODEX_UNAVAILABLE") {
      return save("codex_unavailable", {
        reason: error.message,
        heuristic,
        ...safeQueue(pluginRoot, env),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
    }
    if (error?.code === "AGENT_ARCHIVE_CODEX_ERROR") {
      return save("codex_error", {
        reason: error.message,
        heuristic,
        ...safeQueue(pluginRoot, env),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
    }
    throw error;
  }

  if (!reflection.post_worthy || !reflection.draft) {
    return save("not_post_worthy", {
      reason: reflection.reason || "reflector returned post_worthy=false",
      heuristic,
      reflection,
      ...safeQueue(pluginRoot, env),
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
  }

  const draft = enrichDraftFromTurn(reflection.draft, sanitizedTurn);
  const fingerprint = fingerprintDraft(draft);
  const queueDrafts = listQueue(pluginRoot, { env });
  if (isDuplicateFingerprint(fingerprint, queueDrafts, readFingerprints(env))) {
    return save("duplicate", {
      reason: "matching draft fingerprint already exists",
      fingerprint,
      heuristic,
      reflection,
      ...safeQueue(pluginRoot, env, queueDrafts),
      draftPreview: { title: draft.title, summary: draft.summary },
      replacements: sanitized.replacements,
      blockedMarkers: sanitized.blockedMarkers
    });
  }

  const created = createQueueDraft(pluginRoot, draft, { env });
  rememberFingerprint(fingerprint, env);
  const createdDraft = {
    id: created.id,
    title: created.title,
    filePath: created.filePath
  };
  const publish = {
    policy: publishPolicy,
    state: "queued",
    draftId: created.id,
    title: created.title,
    requiresUserAction: false
  };

  if (publishPolicy === "auto") {
    try {
      const posted = postQueueDraft(pluginRoot, created.id, { env });
      return save("draft_posted", {
        fingerprint,
        heuristic,
        reflection,
        created: createdDraft,
        publish: {
          ...publish,
          state: "posted",
          url: posted.url || posted.draft?.postedUrl || "",
          requiresUserAction: false
        },
        ...safeQueue(pluginRoot, env),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
    } catch (error) {
      return save("post_failed", {
        reason: errorMessage(error),
        fingerprint,
        heuristic,
        reflection,
        created: createdDraft,
        publish: {
          ...publish,
          state: "failed",
          error: errorMessage(error),
          requiresUserAction: true
        },
        ...safeQueue(pluginRoot, env),
        replacements: sanitized.replacements,
        blockedMarkers: sanitized.blockedMarkers
      });
    }
  }

  return save("draft_created", {
    fingerprint,
    heuristic,
    reflection,
    created: createdDraft,
    publish,
    ...safeQueue(pluginRoot, env),
    replacements: sanitized.replacements,
    blockedMarkers: sanitized.blockedMarkers
  });
}

export async function runReflectionFlowSafe(options = {}) {
  try {
    return await runReflectionFlow(options);
  } catch (error) {
    const {
      pluginRoot = process.cwd(),
      env = process.env,
      mode = "silent",
      modeSource = "unspecified",
      visibility = mode,
      publishPolicy = "queue",
      reflectionProvider = "codex",
      reflectionGateEnabled = false,
      startedAt = Date.now()
    } = options;
    return writeReflectionStatus("error", {
      env,
      mode,
      modeSource,
      visibility,
      publishPolicy,
      reflectionProvider,
      reflectionGateEnabled,
      startedAt,
      extra: {
        error: errorMessage(error),
        ...safeQueue(pluginRoot, env)
      }
    });
  }
}
