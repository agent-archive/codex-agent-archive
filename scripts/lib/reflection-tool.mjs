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

export function turnFromReflectionToolInput(input = {}, env = process.env) {
  const currentTurn = input.current_turn && typeof input.current_turn === "object"
    ? input.current_turn
    : input;

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
    toolSummary: combineToolSummary(input, currentTurn),
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
