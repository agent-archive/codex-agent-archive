import { readFileSync } from "node:fs";
import path from "node:path";

function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractText(value, depth = 0) {
  if (value == null || depth > 4) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => extractText(entry, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.output === "string") return value.output;
    if (typeof value.result === "string") return value.result;
    if (value.message) return extractText(value.message, depth + 1);
    if (value.content) return extractText(value.content, depth + 1);
    if (value.delta) return extractText(value.delta, depth + 1);
  }
  return "";
}

function extractRole(entry) {
  const role = entry?.role || entry?.message?.role || entry?.payload?.role;
  if (role === "user" || role === "assistant" || role === "tool") return role;
  const type = String(entry?.type || entry?.event || "").toLowerCase();
  if (type.includes("user")) return "user";
  if (type.includes("assistant") || type.includes("agent")) return "assistant";
  if (type.includes("tool") || type.includes("function")) return "tool";
  return null;
}

function extractToolName(entry) {
  return entry?.tool_name || entry?.toolName || entry?.name || entry?.function?.name || entry?.call?.name || "";
}

function eventFromEntry(entry) {
  const role = extractRole(entry);
  const toolName = extractToolName(entry);
  const text = extractText(entry);
  if (!role && !toolName && !text) return null;
  return {
    role: role || (toolName ? "tool" : "unknown"),
    toolName,
    text: compactWhitespace(text).slice(0, 4000)
  };
}

export function parseJsonlTranscript(raw) {
  const events = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const event = eventFromEntry(parsed);
      if (event) events.push(event);
    } catch {
      continue;
    }
  }
  return events;
}

function summarizeTools(events) {
  const tools = events
    .filter((event) => event.role === "tool" || event.toolName)
    .map((event) => {
      const label = event.toolName || "tool";
      const detail = event.text ? `: ${event.text.slice(0, 240)}` : "";
      return `${label}${detail}`;
    });
  return tools.slice(-12).join("\n");
}

export function latestTurnFromEvents(events, hookInput = {}) {
  const lastUserIndex = events.map((event) => event.role).lastIndexOf("user");
  const turnEvents = lastUserIndex >= 0 ? events.slice(lastUserIndex) : events.slice(-12);
  const userText = turnEvents.find((event) => event.role === "user")?.text || hookInput.prompt || "";
  const assistantEvents = turnEvents.filter((event) => event.role === "assistant" && event.text);
  const assistantText = assistantEvents.at(-1)?.text || hookInput.last_assistant_message || "";
  const toolCallCount = turnEvents.filter((event) => event.role === "tool" || event.toolName).length;

  return {
    sessionId: hookInput.session_id || hookInput.sessionId || "",
    turnId: hookInput.turn_id || hookInput.turnId || "",
    cwd: hookInput.cwd || hookInput.workspace || process.cwd(),
    model: hookInput.model || "",
    userText,
    assistantText,
    toolSummary: summarizeTools(turnEvents),
    toolCallCount,
    rawEventCount: events.length,
    source: hookInput.transcript_path || hookInput.transcriptPath || ""
  };
}

export function readLatestTurn(hookInput = {}) {
  const transcriptPath = hookInput.transcript_path || hookInput.transcriptPath;
  if (!transcriptPath) {
    return latestTurnFromEvents([], hookInput);
  }

  try {
    const raw = readFileSync(path.resolve(transcriptPath), "utf8");
    return latestTurnFromEvents(parseJsonlTranscript(raw), hookInput);
  } catch (error) {
    return {
      ...latestTurnFromEvents([], hookInput),
      transcriptError: error instanceof Error ? error.message : String(error)
    };
  }
}
