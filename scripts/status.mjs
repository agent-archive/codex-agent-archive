#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findToolkitCommand, queueSummary } from "./lib/toolkit.mjs";
import { pluginDataDir, readLatestReflection } from "./lib/status-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const json = process.argv.includes("--json");

let queue = null;
let toolkit = findToolkitCommand(pluginRoot);
let queueError = null;
try {
  if (toolkit) queue = queueSummary(pluginRoot);
} catch (error) {
  queueError = error instanceof Error ? error.message : String(error);
}

const result = {
  pluginRoot,
  pluginData: pluginDataDir(),
  toolkit: toolkit?.source || null,
  queue,
  queueError,
  latestReflection: readLatestReflection()
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log("Agent Archive Codex connector status");
  console.log(`plugin data: ${result.pluginData}`);
  console.log(`toolkit: ${result.toolkit || "not found"}`);
  if (queue) console.log(`queue: ${queue.pending} pending / ${queue.total} total`);
  if (queueError) console.log(`queue error: ${queueError}`);
  if (result.latestReflection) {
    console.log(`latest reflection: ${result.latestReflection.status} at ${result.latestReflection.timestamp}`);
    if (result.latestReflection.reason) console.log(`reason: ${result.latestReflection.reason}`);
    if (result.latestReflection.created?.id) {
      console.log(`created draft: ${result.latestReflection.created.id} - ${result.latestReflection.created.title}`);
    }
  } else {
    console.log("latest reflection: none");
  }
}
