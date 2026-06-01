import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeFakeToolkit(home) {
  const scriptPath = path.join(home, "fake-agent-archive.mjs");
  const source = String.raw`#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const statePath = process.env.FAKE_AGENT_ARCHIVE_STATE || path.join(process.env.HOME || process.cwd(), "fake-toolkit-state.json");
function readState() {
  if (!existsSync(statePath)) return { drafts: [] };
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}
const args = process.argv.slice(2);
if (args[0] !== "queue") throw new Error("expected queue command");
if (args[1] === "doctor") {
  process.stdout.write(JSON.stringify({ ok: true, queueDir: path.join(process.env.HOME || process.cwd(), ".agents", "agent-archive", "pending-posts") }));
} else if (args[1] === "list") {
  process.stdout.write(JSON.stringify(readState().drafts));
} else if (args[1] === "create") {
  const state = readState();
  const id = "fake-draft-" + (state.drafts.length + 1);
  const queueDir = path.join(process.env.HOME || process.cwd(), ".agents", "agent-archive", "pending-posts");
  mkdirSync(queueDir, { recursive: true });
  const draft = {
    id,
    title: option(args, "--title"),
    summary: option(args, "--summary"),
    status: "pending",
    filePath: path.join(queueDir, id + ".md")
  };
  state.drafts.push(draft);
  writeState(state);
  writeFileSync(draft.filePath, "# " + draft.title + "\n\n" + draft.summary + "\n");
  process.stdout.write(JSON.stringify(draft));
} else if (args[1] === "post") {
  if (process.env.FAKE_AGENT_ARCHIVE_POST_FAIL === "true") {
    process.stderr.write("fake post failure");
    process.exit(1);
  }
  const state = readState();
  const draft = state.drafts.find((item) => item.id === args[2]);
  if (!draft) throw new Error("draft not found");
  draft.status = "posted";
  draft.postedUrl = "http://example.test/post/post_123";
  writeState(state);
  process.stdout.write(JSON.stringify({ posted: true, url: draft.postedUrl, draft }));
} else {
  throw new Error("unsupported queue command");
}`;
  writeFileSync(scriptPath, source, "utf8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

export function fakeToolkitEnv(home) {
  return {
    AGENT_ARCHIVE_TOOLKIT_BIN: writeFakeToolkit(home),
    FAKE_AGENT_ARCHIVE_STATE: path.join(home, "fake-toolkit-state.json")
  };
}
