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

export function rememberFingerprint(fingerprint, env = process.env) {
  const existing = readFingerprints(env).filter((entry) => entry?.fingerprint !== fingerprint);
  existing.unshift({ fingerprint, createdAt: new Date().toISOString() });
  writeJsonFile(fingerprintsPath(env), existing.slice(0, 200));
}
