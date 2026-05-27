import { readSettings, settingsPath, writeSettings } from "./status-store.mjs";

export const REFLECTION_MODES = ["visible", "record", "off"];
export const DEFAULT_REFLECTION_MODE = "visible";

export function normalizeReflectionMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return REFLECTION_MODES.includes(mode) ? mode : null;
}

export function resolveReflectionMode(env = process.env) {
  if (env.AGENT_ARCHIVE_REFLECTION_DISABLED === "true") {
    return {
      mode: "off",
      source: "AGENT_ARCHIVE_REFLECTION_DISABLED",
      reason: "AGENT_ARCHIVE_REFLECTION_DISABLED=true"
    };
  }

  const envMode = normalizeReflectionMode(env.AGENT_ARCHIVE_REFLECTION_MODE);
  if (envMode) {
    return {
      mode: envMode,
      source: "AGENT_ARCHIVE_REFLECTION_MODE"
    };
  }

  const settings = readSettings(env);
  const settingsMode = normalizeReflectionMode(settings.reflectionMode || settings.mode);
  if (settingsMode) {
    return {
      mode: settingsMode,
      source: "settings",
      settings
    };
  }

  return {
    mode: DEFAULT_REFLECTION_MODE,
    source: "default"
  };
}

export function setReflectionMode(mode, env = process.env) {
  const normalized = normalizeReflectionMode(mode);
  if (!normalized) {
    throw new Error(`Invalid reflection mode "${mode}". Use visible, record, or off.`);
  }

  const settings = {
    ...readSettings(env),
    reflectionMode: normalized,
    updatedAt: new Date().toISOString()
  };
  writeSettings(settings, env);
  return {
    mode: normalized,
    settings,
    settingsPath: settingsPath(env)
  };
}
