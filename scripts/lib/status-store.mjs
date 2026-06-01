import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function pluginDataDir(env = process.env) {
  return env.PLUGIN_DATA || path.join(os.homedir(), ".agents", "agent-archive", "codex-agent-archive");
}

export function ensurePluginDataDir(env = process.env) {
  const dir = pluginDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJsonFile(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, filePath);
}

export function latestReflectionPath(env = process.env) {
  return path.join(pluginDataDir(env), "latest-reflection.json");
}

export function fingerprintsPath(env = process.env) {
  return path.join(pluginDataDir(env), "draft-fingerprints.json");
}

export function settingsPath(env = process.env) {
  return path.join(pluginDataDir(env), "settings.json");
}

export function latestTurnStartPath(env = process.env) {
  return path.join(pluginDataDir(env), "latest-turn-start.json");
}

export function readLatestReflection(env = process.env) {
  return readJsonFile(latestReflectionPath(env), null);
}

export function writeLatestReflection(result, env = process.env) {
  ensurePluginDataDir(env);
  writeJsonFile(latestReflectionPath(env), result);
}

export function readFingerprints(env = process.env) {
  return readJsonFile(fingerprintsPath(env), []);
}

export function readSettings(env = process.env) {
  return readJsonFile(settingsPath(env), {});
}

export function writeSettings(settings, env = process.env) {
  ensurePluginDataDir(env);
  writeJsonFile(settingsPath(env), settings);
}

export function readLatestTurnStart(env = process.env) {
  return readJsonFile(latestTurnStartPath(env), null);
}

export function writeLatestTurnStart(start, env = process.env) {
  ensurePluginDataDir(env);
  writeJsonFile(latestTurnStartPath(env), start);
}

export function elapsedTurnMsFromStart(turn = {}, env = process.env, now = Date.now()) {
  const start = readLatestTurnStart(env);
  const startedAtMs = Number(start?.startedAtMs);
  if (!Number.isFinite(startedAtMs)) return null;

  const turnId = String(turn.turnId || turn.turn_id || "").trim();
  const startTurnId = String(start.turnId || "").trim();
  if (turnId && startTurnId && turnId !== startTurnId) return null;

  const elapsedMs = now - startedAtMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  if (elapsedMs > 6 * 60 * 60 * 1000) return null;
  return elapsedMs;
}

export function rememberFingerprint(fingerprint, env = process.env) {
  const existing = readFingerprints(env).filter((entry) => entry?.fingerprint !== fingerprint);
  existing.unshift({ fingerprint, createdAt: new Date().toISOString() });
  writeJsonFile(fingerprintsPath(env), existing.slice(0, 200));
}
