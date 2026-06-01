import { readSettings, settingsPath, writeSettings } from "./status-store.mjs";

export const REFLECTION_VISIBILITIES = ["verbose", "tool", "silent", "off"];
export const PUBLISH_POLICIES = ["queue", "auto"];
export const REFLECTION_PROVIDERS = ["codex", "api"];
export const DEFAULT_REFLECTION_VISIBILITY = "tool";
export const DEFAULT_REFLECTION_GATE_ENABLED = true;
export const DEFAULT_PUBLISH_POLICY = "queue";
export const DEFAULT_REFLECTION_PROVIDER = "codex";

export function normalizeReflectionVisibility(value) {
  const visibility = String(value || "").trim().toLowerCase();
  return REFLECTION_VISIBILITIES.includes(visibility) ? visibility : null;
}

export function normalizePublishPolicy(value) {
  const policy = String(value || "").trim().toLowerCase();
  return PUBLISH_POLICIES.includes(policy) ? policy : null;
}

export function normalizeReflectionProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return REFLECTION_PROVIDERS.includes(provider) ? provider : null;
}

function normalizeBooleanFlag(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return null;
}

function resolveVisibility(env, settings) {
  const envVisibility = normalizeReflectionVisibility(env.AGENT_ARCHIVE_REFLECTION_VISIBILITY);
  if (envVisibility) {
    return {
      visibility: envVisibility,
      source: "AGENT_ARCHIVE_REFLECTION_VISIBILITY"
    };
  }

  const settingsVisibility = normalizeReflectionVisibility(settings.reflectionVisibility);
  if (settingsVisibility) return { visibility: settingsVisibility, source: "settings" };

  return { visibility: DEFAULT_REFLECTION_VISIBILITY, source: "default" };
}

function resolveReflectionGate(env, settings) {
  const envGate = normalizeBooleanFlag(env.AGENT_ARCHIVE_REFLECTION_GATE_ENABLED);
  if (envGate !== null) {
    return {
      reflectionGateEnabled: envGate,
      reflectionGateSource: "AGENT_ARCHIVE_REFLECTION_GATE_ENABLED"
    };
  }

  if (typeof settings.reflectionGateEnabled === "boolean") {
    return {
      reflectionGateEnabled: settings.reflectionGateEnabled,
      reflectionGateSource: "settings"
    };
  }

  return {
    reflectionGateEnabled: DEFAULT_REFLECTION_GATE_ENABLED,
    reflectionGateSource: "default"
  };
}

function resolvePublishPolicy(env, settings) {
  const envPolicy = normalizePublishPolicy(env.AGENT_ARCHIVE_PUBLISH_POLICY);
  if (envPolicy) return { publishPolicy: envPolicy, publishPolicySource: "AGENT_ARCHIVE_PUBLISH_POLICY" };

  const settingsPolicy = normalizePublishPolicy(settings.publishPolicy);
  if (settingsPolicy) return { publishPolicy: settingsPolicy, publishPolicySource: "settings" };

  return { publishPolicy: DEFAULT_PUBLISH_POLICY, publishPolicySource: "default" };
}

function resolveProvider(env, settings) {
  const envProvider = normalizeReflectionProvider(env.AGENT_ARCHIVE_REFLECTION_PROVIDER);
  if (envProvider) return { reflectionProvider: envProvider, reflectionProviderSource: "AGENT_ARCHIVE_REFLECTION_PROVIDER" };

  if (env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE) {
    return { reflectionProvider: "mock", reflectionProviderSource: "AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE" };
  }

  const settingsProvider = normalizeReflectionProvider(settings.reflectionProvider);
  if (settingsProvider) return { reflectionProvider: settingsProvider, reflectionProviderSource: "settings" };

  return {
    reflectionProvider: DEFAULT_REFLECTION_PROVIDER,
    reflectionProviderSource: "default"
  };
}

export function resolveReflectionSettings(env = process.env) {
  const settings = readSettings(env);
  const visibility = resolveVisibility(env, settings);
  const gate = resolveReflectionGate(env, settings);
  const publish = resolvePublishPolicy(env, settings);
  const provider = resolveProvider(env, settings);

  return {
    ...visibility,
    ...gate,
    ...publish,
    ...provider,
    settings
  };
}

export function setReflectionVisibility(visibility, env = process.env) {
  const normalized = normalizeReflectionVisibility(visibility);
  if (!normalized) {
    throw new Error(`Invalid reflection visibility "${visibility}". Use verbose, tool, silent, or off.`);
  }

  const settings = {
    ...readSettings(env),
    reflectionVisibility: normalized,
    updatedAt: new Date().toISOString()
  };
  writeSettings(settings, env);
  return {
    visibility: normalized,
    settings,
    settingsPath: settingsPath(env)
  };
}

export function setReflectionGateEnabled(enabled, env = process.env) {
  const normalized = normalizeBooleanFlag(enabled);
  if (normalized === null) {
    throw new Error(`Invalid reflection gate value "${enabled}". Use true or false.`);
  }

  const settings = {
    ...readSettings(env),
    reflectionGateEnabled: normalized,
    updatedAt: new Date().toISOString()
  };
  writeSettings(settings, env);
  return {
    reflectionGateEnabled: normalized,
    reflectionGateSource: "settings",
    settings,
    settingsPath: settingsPath(env)
  };
}

export function setPublishPolicy(policy, env = process.env) {
  const normalized = normalizePublishPolicy(policy);
  if (!normalized) {
    throw new Error(`Invalid publish policy "${policy}". Use queue or auto.`);
  }

  const settings = {
    ...readSettings(env),
    publishPolicy: normalized,
    updatedAt: new Date().toISOString()
  };
  writeSettings(settings, env);
  return {
    publishPolicy: normalized,
    settings,
    settingsPath: settingsPath(env)
  };
}

export function setReflectionProvider(provider, env = process.env) {
  const normalized = normalizeReflectionProvider(provider);
  if (!normalized) {
    throw new Error(`Invalid reflection provider "${provider}". Use codex or api.`);
  }

  const settings = {
    ...readSettings(env),
    reflectionProvider: normalized,
    updatedAt: new Date().toISOString()
  };
  writeSettings(settings, env);
  return {
    reflectionProvider: normalized,
    settings,
    settingsPath: settingsPath(env)
  };
}
