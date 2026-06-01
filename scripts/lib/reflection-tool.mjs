import path from "node:path";
import { formatReflectionPostscript } from "./postscript.mjs";
import { runReflectionFlowSafe } from "./reflection-flow.mjs";
import { resolveReflectionSettings } from "./reflection-mode.mjs";

export const REFLECTION_TOOL_NAME = "agent_archive_reflection";

export const REFLECTION_TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    mode: {
      type: "string",
      enum: ["end_of_turn"],
      description: "Use end_of_turn when calling this after forming the response but before final answer."
    },
    user_request: {
      type: "string",
      description: "The user's current request, summarized or copied from the turn."
    },
    intended_answer: {
      type: "string",
      description: "The assistant answer you intend to give after this reflection tool call."
    },
    tool_summary: {
      type: "string",
      description: "Brief summary of important tools, files, errors, or decisions from this turn."
    },
    current_turn: {
      type: "object",
      additionalProperties: true,
      description: "Optional wrapper for current-turn fields."
    }
  }
};

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function combineToolSummary(input, currentTurn) {
  const notableActions = currentTurn.notable_actions || input.notable_actions;
  const parts = [
    firstString(currentTurn.tool_summary, currentTurn.toolSummary, input.tool_summary, input.toolSummary),
    Array.isArray(notableActions) ? notableActions.map(String).join("\n") : firstString(notableActions)
  ].filter(Boolean);
  return parts.join("\n");
}

function countToolEntries(value) {
  return String(value || "").split(/\n/).filter((line) => line.trim()).length;
}

function numberField(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function timestampField(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const direct = Number(value);
    if (Number.isFinite(direct)) return direct;
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function elapsedTurnMsFromInput(input, currentTurn, now = Date.now()) {
  const explicitElapsed = numberField(
    currentTurn.elapsed_turn_ms,
    currentTurn.elapsedTurnMs,
    input.elapsed_turn_ms,
    input.elapsedTurnMs
  );
  if (explicitElapsed !== null && explicitElapsed >= 0) return explicitElapsed;

  const startedAtMs = timestampField(
    currentTurn.started_at_ms,
    currentTurn.startedAtMs,
    currentTurn.turn_started_at_ms,
    currentTurn.turnStartedAtMs,
    currentTurn.started_at,
    currentTurn.startedAt,
    currentTurn.turn_started_at,
    currentTurn.turnStartedAt,
    input.started_at_ms,
    input.startedAtMs,
    input.turn_started_at_ms,
    input.turnStartedAtMs,
    input.started_at,
    input.startedAt,
    input.turn_started_at,
    input.turnStartedAt
  );
  if (startedAtMs === null) return undefined;

  const elapsedMs = now - startedAtMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return undefined;
  if (elapsedMs > 6 * 60 * 60 * 1000) return undefined;
  return elapsedMs;
}

export function turnFromReflectionToolInput(input = {}, env = process.env, now = Date.now()) {
  const currentTurn = input.current_turn && typeof input.current_turn === "object"
    ? input.current_turn
    : input;
  const toolSummary = combineToolSummary(input, currentTurn);
  const elapsedTurnMs = elapsedTurnMsFromInput(input, currentTurn, now);

  return {
    sessionId: firstString(currentTurn.session_id, currentTurn.sessionId, input.session_id, input.sessionId),
    turnId: firstString(currentTurn.turn_id, currentTurn.turnId, input.turn_id, input.turnId),
    cwd: firstString(currentTurn.cwd, input.cwd, env.PWD, process.cwd()),
    model: firstString(currentTurn.model, input.model),
    userText: firstString(
      currentTurn.user_request,
      currentTurn.userText,
      currentTurn.prompt,
      input.user_request,
      input.userText,
      input.prompt
    ),
    assistantText: firstString(
      currentTurn.intended_answer,
      currentTurn.assistant_response,
      currentTurn.assistantText,
      currentTurn.final_answer,
      input.intended_answer,
      input.assistant_response,
      input.assistantText,
      input.final_answer
    ),
    toolSummary,
    toolCallCount: countToolEntries(toolSummary),
    ...(elapsedTurnMs === undefined ? {} : { elapsedTurnMs }),
    rawEventCount: 0,
    source: REFLECTION_TOOL_NAME
  };
}

function compactQueue(queue) {
  const drafts = Array.isArray(queue?.untriaged) ? queue.untriaged.slice(0, 5) : [];
  return {
    total: Number(queue?.total || 0),
    untriaged: Number(queue?.pending || 0),
    drafts: drafts.map((draft) => ({
      id: draft.id || "",
      title: draft.title || "Untitled draft"
    }))
  };
}

export function compactReflectionResult(result) {
  return {
    status: result.status,
    reason: result.reason || result.error || result.queueError || "",
    line: formatReflectionPostscript(result),
    durationMs: result.durationMs || 0,
    queue: compactQueue(result.queue),
    created: result.created
      ? {
        id: result.created.id || "",
        title: result.created.title || "",
        filePath: result.created.filePath || ""
      }
      : null,
    recommendation: result.reflection?.draft
      ? {
        title: result.reflection.draft.title || "",
        summary: result.reflection.draft.summary || ""
      }
      : null,
    draftPreview: result.draftPreview || null,
    mode: result.mode,
    visibility: result.visibility,
    publishPolicy: result.publishPolicy,
    reflectionProvider: result.reflectionProvider,
    reflectionGateEnabled: result.reflectionGateEnabled,
    publish: result.publish || null,
    timestamp: result.timestamp
  };
}

export async function runReflectionTool(input = {}, options = {}) {
  const env = options.env || process.env;
  const pluginRoot = options.pluginRoot || env.PLUGIN_ROOT || path.resolve(process.cwd());
  const settings = options.settings || resolveReflectionSettings(env);
  const startedAt = Date.now();
  const result = await runReflectionFlowSafe({
    turn: turnFromReflectionToolInput(input, env),
    pluginRoot,
    env,
    mode: settings.visibility,
    modeSource: REFLECTION_TOOL_NAME,
    visibility: settings.visibility,
    publishPolicy: settings.publishPolicy,
    reflectionProvider: settings.reflectionProvider,
    reflectionGateEnabled: settings.reflectionGateEnabled,
    settings,
    startedAt
  });
  return compactReflectionResult(result);
}
