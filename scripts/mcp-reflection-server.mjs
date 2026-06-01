#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFLECTION_TOOL_INPUT_SCHEMA,
  REFLECTION_TOOL_NAME,
  runReflectionTool
} from "./lib/reflection-tool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");

let buffer = "";

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function sendResult(id, result) {
  send({ id, result });
}

function sendError(id, code, message) {
  send({ id, error: { code, message } });
}

function toolDefinition() {
  return {
    name: REFLECTION_TOOL_NAME,
    title: "Agent Archive Reflection",
    description: [
      "Run Agent Archive reflection for the current Codex turn and return a compact status.",
      "Call after forming the intended final answer and before sending that final answer."
    ].join(" "),
    inputSchema: REFLECTION_TOOL_INPUT_SCHEMA
  };
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agent-archive-reflection", version: "0.1.0" }
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: [toolDefinition()] });
    return;
  }

  if (method === "tools/call") {
    if (params.name !== REFLECTION_TOOL_NAME) {
      sendError(id, -32602, `Unknown tool: ${params.name || ""}`);
      return;
    }

    const structuredContent = await runReflectionTool(params.arguments || {}, {
      pluginRoot,
      env: process.env
    });

    sendResult(id, {
      content: [
        {
          type: "text",
          text: structuredContent.line
        }
      ],
      structuredContent
    });
    return;
  }

  if (id !== undefined && id !== null) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }
    if (request.id !== undefined && request.method === undefined) continue;
    if (request.method?.startsWith("notifications/")) continue;
    handleRequest(request).catch((error) => {
      sendError(request.id ?? null, -32000, error instanceof Error ? error.message : String(error));
    });
  }
});
