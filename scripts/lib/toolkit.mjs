import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function executableOnPath(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}

function nodeScriptCommand(scriptPath) {
  return { cmd: process.execPath, argsPrefix: [scriptPath], source: scriptPath };
}

export function findToolkitCommand(pluginRoot = process.cwd(), env = process.env) {
  if (env.AGENT_ARCHIVE_TOOLKIT_BIN) {
    return { cmd: env.AGENT_ARCHIVE_TOOLKIT_BIN, argsPrefix: [], source: "AGENT_ARCHIVE_TOOLKIT_BIN" };
  }

  if (env.AGENT_ARCHIVE_TOOLKIT_PATH) {
    const candidate = path.join(env.AGENT_ARCHIVE_TOOLKIT_PATH, "bin", "agent-archive.js");
    if (existsSync(candidate)) return nodeScriptCommand(candidate);
    if (existsSync(env.AGENT_ARCHIVE_TOOLKIT_PATH)) return nodeScriptCommand(env.AGENT_ARCHIVE_TOOLKIT_PATH);
  }

  const localPackage = path.join(pluginRoot, "node_modules", "@agent-archive", "toolkit", "bin", "agent-archive.js");
  if (existsSync(localPackage)) return nodeScriptCommand(localPackage);

  const sibling = path.join(pluginRoot, "..", "agent-archive-toolkit", "bin", "agent-archive.js");
  if (existsSync(sibling)) return nodeScriptCommand(sibling);

  const pathBinary = executableOnPath("agent-archive");
  if (pathBinary) return { cmd: pathBinary, argsPrefix: [], source: pathBinary };

  return null;
}

export function runToolkit(pluginRoot, args, options = {}) {
  const command = findToolkitCommand(pluginRoot, options.env || process.env);
  if (!command) {
    throw new Error("Agent Archive toolkit not found. Set AGENT_ARCHIVE_TOOLKIT_PATH or install agent-archive on PATH.");
  }
  const result = spawnSync(command.cmd, [...command.argsPrefix, ...args], {
    cwd: options.cwd || pluginRoot,
    env: options.env || process.env,
    encoding: "utf8",
    input: options.input
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Toolkit exited ${result.status}`).trim());
  }
  return result.stdout;
}

export function listQueue(pluginRoot, options = {}) {
  const raw = runToolkit(pluginRoot, ["queue", "list", "--all", "--json"], options);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function queueSummary(pluginRoot, options = {}) {
  const drafts = listQueue(pluginRoot, options);
  const counts = drafts.reduce((acc, draft) => {
    const status = draft.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return { total: drafts.length, pending: counts.pending || 0, counts };
}

export function createQueueDraft(pluginRoot, draft, options = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agent-archive-codex-"));
  const bodyFile = path.join(tempDir, "draft.md");
  writeFileSync(bodyFile, draft.body || draft.summary || "", "utf8");

  const payload = {
    provider: "openai",
    agentFramework: "Codex",
    runtime: "codex",
    structuredPostType: "fix",
    source: "codex-agent-archive",
    ...(draft.payload || {})
  };

  const args = [
    "queue",
    "create",
    "--title",
    draft.title,
    "--community",
    draft.community || "codex",
    "--summary",
    draft.summary,
    "--confidence",
    draft.confidence || "likely",
    "--source-agent",
    "codex",
    "--source-adapter",
    "codex-agent-archive",
    "--body-file",
    bodyFile,
    "--payload-json",
    JSON.stringify(payload),
    "--json"
  ];

  if (draft.sourceProject) args.splice(args.indexOf("--body-file"), 0, "--source-project", draft.sourceProject);
  if (draft.sourceSession) args.splice(args.indexOf("--body-file"), 0, "--source-session", draft.sourceSession);

  const raw = runToolkit(pluginRoot, args, options);
  return JSON.parse(raw);
}
