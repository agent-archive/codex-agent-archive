import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const AGENT_ARCHIVE_TOOLKIT_REPO_URL = "https://github.com/agent-archive/agent-archive-toolkit.git";

export function managedToolkitRoot(env = process.env) {
  const home = env.HOME || homedir();
  return path.join(home, ".agents", "agent-archive", "toolkit");
}

function executableOnPath(name, env = process.env) {
  const result = spawnSync("/usr/bin/env", ["which", name], { encoding: "utf8", env });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}

function resolveNodeBin(env = process.env) {
  if (env.AGENT_ARCHIVE_NODE_BIN) {
    if (path.isAbsolute(env.AGENT_ARCHIVE_NODE_BIN) && existsSync(env.AGENT_ARCHIVE_NODE_BIN)) return env.AGENT_ARCHIVE_NODE_BIN;
    const configuredBinary = executableOnPath(env.AGENT_ARCHIVE_NODE_BIN, env);
    if (configuredBinary) return configuredBinary;
  }
  if (process.execPath && existsSync(process.execPath)) return process.execPath;
  const appNode = "/Applications/Codex.app/Contents/Resources/node";
  if (process.platform === "darwin" && existsSync(appNode)) return appNode;
  return executableOnPath("node", env) || "node";
}

function nodeScriptCommand(scriptPath, env = process.env) {
  return { cmd: resolveNodeBin(env), argsPrefix: [scriptPath], source: scriptPath };
}

function toolkitScriptFromPath(toolkitPath) {
  if (!toolkitPath) return null;
  const packageBin = path.join(toolkitPath, "bin", "agent-archive.js");
  if (existsSync(packageBin)) return packageBin;
  if (existsSync(toolkitPath)) return toolkitPath;
  return null;
}

function candidateToolkitRoots(pluginRoot, env) {
  const home = env.HOME || process.env.HOME || "";
  return [
    path.join(pluginRoot, "node_modules", "@agent-archive", "toolkit"),
    managedToolkitRoot(env),
    path.join(pluginRoot, "..", "agent-archive-toolkit"),
    home ? path.join(home, "Projects", "agent-archive-toolkit") : "",
    home ? path.join(home, "projects", "agent-archive-toolkit") : ""
  ].filter(Boolean);
}

export function findToolkitCommand(pluginRoot = process.cwd(), env = process.env) {
  if (env.AGENT_ARCHIVE_TOOLKIT_BIN) {
    return { cmd: env.AGENT_ARCHIVE_TOOLKIT_BIN, argsPrefix: [], source: "AGENT_ARCHIVE_TOOLKIT_BIN" };
  }

  if (env.AGENT_ARCHIVE_TOOLKIT_PATH) {
    const candidate = toolkitScriptFromPath(env.AGENT_ARCHIVE_TOOLKIT_PATH);
    if (candidate) return nodeScriptCommand(candidate, env);
  }

  for (const root of candidateToolkitRoots(pluginRoot, env)) {
    const candidate = toolkitScriptFromPath(root);
    if (candidate) return nodeScriptCommand(candidate, env);
  }

  const pathBinary = executableOnPath("agent-archive", env);
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

export function summarizeQueueDrafts(drafts = []) {
  const counts = drafts.reduce((acc, draft) => {
    const status = draft.status || "pending";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const untriaged = drafts
    .filter((draft) => (draft.status || "pending") === "pending")
    .map((draft) => ({
      id: draft.id || "",
      title: draft.title || "Untitled draft",
      filePath: draft.filePath || draft.file_path || ""
    }));
  return { total: drafts.length, pending: counts.pending || 0, untriaged, counts };
}

export function queueSummary(pluginRoot, options = {}) {
  return summarizeQueueDrafts(listQueue(pluginRoot, options));
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

export function postQueueDraft(pluginRoot, id, options = {}) {
  const raw = runToolkit(pluginRoot, ["queue", "post", id, "--yes", "--json"], options);
  return JSON.parse(raw);
}
