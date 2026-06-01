#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReflectionSettings } from "./lib/reflection-mode.mjs";
import { errorMessage, runReflectionFlowSafe, writeReflectionStatus } from "./lib/reflection-flow.mjs";
import { queueSummary } from "./lib/toolkit.mjs";
import { ensurePluginDataDir } from "./lib/status-store.mjs";
import { readLatestTurn } from "./lib/transcript.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");
const startedAt = Date.now();

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function safeQueue() {
  try {
    return { queue: queueSummary(pluginRoot) };
  } catch (error) {
    return { queue: null, queueError: errorMessage(error) };
  }
}

async function main() {
  const hookInput = readStdinJson();
  if (hookInput.stop_hook_active === true) return;

  ensurePluginDataDir();

  const settings = resolveReflectionSettings();

  if (settings.visibility === "off") {
    writeReflectionStatus("disabled", {
      mode: settings.visibility,
      modeSource: settings.source,
      visibility: settings.visibility,
      publishPolicy: settings.publishPolicy,
      reflectionProvider: settings.reflectionProvider,
      reflectionGateEnabled: settings.reflectionGateEnabled,
      startedAt,
      extra: {
        reason: settings.reason || "reflection visibility is off",
        ...safeQueue()
      }
    });
    return;
  }

  // Tool and verbose modes are driven by a model-visible MCP tool call injected
  // by UserPromptSubmit. Stop stays quiet so it does not create duplicate drafts.
  if (settings.visibility === "tool" || settings.visibility === "verbose") return;

  if (settings.visibility !== "silent") return;

  await runReflectionFlowSafe({
    turn: readLatestTurn(hookInput),
    pluginRoot,
    env: process.env,
    mode: settings.visibility,
    modeSource: settings.source,
    visibility: settings.visibility,
    publishPolicy: settings.publishPolicy,
    reflectionProvider: settings.reflectionProvider,
    reflectionGateEnabled: settings.reflectionGateEnabled,
    settings,
    startedAt
  });
}

main().catch((error) => {
  try {
    writeReflectionStatus("error", {
      startedAt,
      extra: { error: errorMessage(error), ...safeQueue() }
    });
  } catch {
    // Stop hooks must never interrupt the user's workflow.
  }
  process.exit(0);
});
