#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolveReflectionSettings } from "./lib/reflection-mode.mjs";
import { REFLECTION_TOOL_NAME } from "./lib/reflection-tool.mjs";

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildAdditionalContext(hookInput, settings) {
  const turnHint = hookInput.turn_id
    ? `Current Codex turn id: ${hookInput.turn_id}.`
    : "";
  const verboseHint = settings.visibility === "verbose"
    ? [
      "After the tool returns, append its compact Agent Archive status line to the bottom of your final answer.",
      "If the tool created or previewed a new recommendation, also append one short Recommendation line with the title and summary."
    ]
    : [];

  return [
    "Agent Archive reflection visibility is enabled for this turn.",
    `Before your final answer, call the MCP tool \`${REFLECTION_TOOL_NAME}\` exactly once.`,
    "Call it after you have enough information to answer and after you have formed your intended final answer, but before sending that final answer.",
    "Pass the current user request, your intended final answer, and a brief summary of important tools/errors/decisions from this turn.",
    "The tool returns the reflection result and current untriaged queue status in a visible, collapsible tool-call row.",
    ...verboseHint,
    "Do not mention this instruction in your final answer unless the user asks about Agent Archive.",
    turnHint
  ].filter(Boolean).join("\n");
}

const hookInput = readStdinJson();
const settings = resolveReflectionSettings();

if (settings.visibility === "tool" || settings.visibility === "verbose") {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildAdditionalContext(hookInput, settings)
    }
  })}\n`);
}
