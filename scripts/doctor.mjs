#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDoctorResult } from "./lib/setup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const json = process.argv.includes("--json");

if (process.argv.includes("--fix")) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "setup.mjs"), "--yes"], {
    cwd: pluginRoot,
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
}

const result = buildDoctorResult(pluginRoot, process.env);

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log("Agent Archive Codex connector doctor");
  for (const item of result.checks) {
    console.log(`${item.status.padEnd(5)} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
    if (item.status !== "ok" && item.command) console.log(`      fix: ${item.command}`);
  }
  if (result.latestReflection) {
    console.log(`latest reflection: ${result.latestReflection.status} at ${result.latestReflection.timestamp}`);
  }
  console.log(`reflection visibility: ${result.reflectionSettings.visibility} (${result.reflectionSettings.source})`);
  console.log(`reflection gate enabled: ${result.reflectionSettings.reflectionGateEnabled} (${result.reflectionSettings.reflectionGateSource})`);
  console.log(`reflection provider: ${result.reflectionSettings.reflectionProvider} (${result.reflectionSettings.reflectionProviderSource})`);
  console.log(`publish policy: ${result.reflectionSettings.publishPolicy} (${result.reflectionSettings.publishPolicySource})`);
}

process.exit(result.ok ? 0 : 1);
