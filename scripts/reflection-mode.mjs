#!/usr/bin/env node
import {
  PUBLISH_POLICIES,
  REFLECTION_PROVIDERS,
  REFLECTION_VISIBILITIES,
  resolveReflectionSettings,
  setReflectionGateEnabled,
  setPublishPolicy,
  setReflectionProvider,
  setReflectionVisibility
} from "./lib/reflection-mode.mjs";
import { settingsPath } from "./lib/status-store.mjs";

const command = process.argv[2] || "status";
const value = process.argv[3];
const json = process.argv.includes("--json");

function print(value) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (value.visibility) console.log(`reflection visibility: ${value.visibility}`);
  if (typeof value.reflectionGateEnabled === "boolean") console.log(`reflection gate enabled: ${value.reflectionGateEnabled}`);
  if (value.publishPolicy) console.log(`publish policy: ${value.publishPolicy}`);
  if (value.reflectionProvider) console.log(`reflection provider: ${value.reflectionProvider}`);
  console.log(`source: ${value.source || "settings"}`);
  console.log(`settings: ${value.settingsPath || settingsPath()}`);
}

if (command === "status") {
  print({ ...resolveReflectionSettings(), settingsPath: settingsPath() });
} else if (command === "gate") {
  print({ ...setReflectionGateEnabled(value), source: "settings" });
} else if (command === "visibility") {
  print({ ...setReflectionVisibility(value), source: "settings" });
} else if (command === "publish") {
  print({ ...setPublishPolicy(value), source: "settings" });
} else if (command === "provider") {
  print({ ...setReflectionProvider(value), source: "settings" });
} else if (REFLECTION_VISIBILITIES.includes(command)) {
  print({ ...setReflectionVisibility(command), source: "settings" });
} else if (PUBLISH_POLICIES.includes(command)) {
  print({ ...setPublishPolicy(command), source: "settings" });
} else if (REFLECTION_PROVIDERS.includes(command)) {
  print({ ...setReflectionProvider(command), source: "settings" });
} else {
  console.error([
    "Usage:",
    "  node scripts/reflection-mode.mjs status [--json]",
    "  node scripts/reflection-mode.mjs gate <true|false>",
    "  node scripts/reflection-mode.mjs visibility <verbose|tool|silent|off>",
    "  node scripts/reflection-mode.mjs publish <queue|auto>",
    "  node scripts/reflection-mode.mjs provider <codex|api>",
    "  node scripts/reflection-mode.mjs <verbose|tool|silent|off|queue|auto|codex|api>"
  ].join("\n"));
  process.exit(1);
}
