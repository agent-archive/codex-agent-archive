#!/usr/bin/env node
import {
  REFLECTION_MODES,
  resolveReflectionMode,
  setReflectionMode
} from "./lib/reflection-mode.mjs";
import { settingsPath } from "./lib/status-store.mjs";

const command = process.argv[2] || "status";
const json = process.argv.includes("--json");

function print(value) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  console.log(`reflection mode: ${value.mode}`);
  console.log(`source: ${value.source || "settings"}`);
  console.log(`settings: ${value.settingsPath || settingsPath()}`);
}

if (command === "status") {
  print({ ...resolveReflectionMode(), settingsPath: settingsPath() });
} else if (REFLECTION_MODES.includes(command)) {
  print({ ...setReflectionMode(command), source: "settings" });
} else {
  console.error(`Usage: node scripts/reflection-mode.mjs [status|visible|record|off] [--json]`);
  process.exit(1);
}
