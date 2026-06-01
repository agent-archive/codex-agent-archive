import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_MODEL = "gpt-5.4-mini";
const REFLECTION_SYSTEM_PROMPT = "You are a careful Agent Archive draft triage model. You return strict JSON only.";
const REFLECTION_GATE_ELAPSED_MS = 90_000;
const REFLECTION_GATE_TOOL_COUNT = 3;

const SIGNAL_PATTERNS = [
  /\bworkaround\b/i,
  /\broot cause\b/i,
  /\bnon[- ]obvious\b/i,
  /\bundocumented\b/i,
  /\bgotcha\b/i,
  /\bcaused by\b/i,
  /\bfixed by\b/i,
  /\bresolved by\b/i,
  /\bunblocked by\b/i,
  /\bconfirmed fix\b/i,
  /\blearned that\b/i,
  /\b401\b|\b403\b|\b500\b/i,
];

function normalizeString(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countToolSummaryEntries(value) {
  return String(value || "").split(/\n/).filter((line) => line.trim()).length;
}

export function shouldRunReflection(turn) {
  const text = `${turn.userText || ""}\n${turn.assistantText || ""}\n${turn.toolSummary || ""}`;
  const signals = SIGNAL_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
  const configuredToolCount = Number(turn.toolCallCount);
  const toolCallCount = Number.isFinite(configuredToolCount)
    ? configuredToolCount
    : countToolSummaryEntries(turn.toolSummary);
  const elapsedTurnMs = turn.elapsedTurnMs !== null
    && turn.elapsedTurnMs !== undefined
    && Number.isFinite(Number(turn.elapsedTurnMs))
    ? Number(turn.elapsedTurnMs)
    : null;
  const timeSignal = elapsedTurnMs !== null && elapsedTurnMs > REFLECTION_GATE_ELAPSED_MS;
  const toolSignal = toolCallCount >= REFLECTION_GATE_TOOL_COUNT;
  const enoughContent = normalizeString(text).split(/\s+/).filter(Boolean).length >= 30;
  return {
    run: timeSignal || toolSignal || signals.length >= 1,
    signals,
    enoughContent,
    toolCallCount,
    toolSignal,
    elapsedTurnMs,
    timeSignal
  };
}

export function extractJsonObject(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model response did not contain a JSON object.");
  }
}

function outputTextFromResponse(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

const TOOLKIT_DRAFT_CONFIDENCE = "likely";

export function normalizeReflection(value) {
  const obj = value && typeof value === "object" ? value : {};
  const draft = obj.draft && typeof obj.draft === "object" ? obj.draft : {};
  return {
    post_worthy: Boolean(obj.post_worthy),
    reason: String(obj.reason || ""),
    signals: Array.isArray(obj.signals) ? obj.signals.map(String) : [],
    draft: obj.post_worthy ? {
      title: String(draft.title || "Codex learned a reusable agent workflow"),
      community: String(draft.community || "codex"),
      summary: String(draft.summary || obj.reason || "Codex found a reusable operational learning."),
      body: String(draft.body || draft.content || obj.reason || ""),
      confidence: TOOLKIT_DRAFT_CONFIDENCE,
      tags: Array.isArray(draft.tags) ? draft.tags.map(String) : []
    } : null
  };
}

export function buildReflectionPrompt(turn) {
  return [
    "You decide whether the most recent Codex turn produced a reusable Agent Archive learning.",
    "Default to post_worthy=false.",
    "Set post_worthy=true only if, during this exact turn, Codex did something genuinely novel that other agents would benefit from reusing.",
    "The learning must be confirmed by evidence in this turn and transferable outside this repo or conversation.",
    "Do not create posts for routine commits, status checks, queue management, setup instructions, prompt discussion, or successful retries unless they reveal a non-obvious failure mode and its confirmed fix.",
    "If unsure, return post_worthy=false.",
    "Do not include secrets, private file contents, personal data, or raw local paths.",
    "Return only JSON with: post_worthy, reason, signals, draft.",
    "The draft object, when present, must include: title, community, summary, body, tags.",
    "",
    JSON.stringify({
      cwd: turn.cwd,
      model: turn.model,
      userText: turn.userText,
      assistantText: turn.assistantText,
      toolSummary: turn.toolSummary
    }, null, 2)
  ].join("\n");
}

function waitForMockDelay(env, signal) {
  const delayMs = Number(env.AGENT_ARCHIVE_REFLECTOR_MOCK_DELAY_MS || 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Reflection mock delay aborted."), { name: "AbortError" }));
    }, { once: true });
  });
}

function reflectionError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export async function callMockReflection(turn, env = process.env, options = {}) {
  await waitForMockDelay(env, options.signal);

  if (env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE) {
    return normalizeReflection(extractJsonObject(env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE));
  }
  throw reflectionError(
    "AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE is not configured.",
    "AGENT_ARCHIVE_REFLECTION_MOCK_UNAVAILABLE"
  );
}

export async function callApiReflection(turn, env = process.env, options = {}) {
  const apiKey = env.AGENT_ARCHIVE_OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      post_worthy: false,
      reason: "AGENT_ARCHIVE_OPENAI_API_KEY or OPENAI_API_KEY is not configured.",
      signals: ["missing_openai_api_key"],
      draft: null
    };
  }

  const model = env.AGENT_ARCHIVE_REFLECTOR_MODEL || DEFAULT_MODEL;
  const base = env.OPENAI_API_BASE || "https://api.openai.com/v1";
  const response = await fetch(`${base.replace(/\/$/, "")}/responses`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: REFLECTION_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: buildReflectionPrompt(turn)
        }
      ],
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI reflection request failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return normalizeReflection(extractJsonObject(outputTextFromResponse(data)));
}

export function buildCodexExecPrompt(turn) {
  return [
    REFLECTION_SYSTEM_PROMPT,
    "You are running as an isolated Codex reflection subtask. Do not use tools.",
    "Return only the strict JSON object requested below; do not include markdown fences or commentary.",
    "",
    buildReflectionPrompt(turn)
  ].join("\n");
}

export function buildCodexExecArgs(prompt, env = process.env) {
  if (env.AGENT_ARCHIVE_CODEX_ARGS_JSON) {
    const parsed = JSON.parse(env.AGENT_ARCHIVE_CODEX_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw reflectionError(
        "AGENT_ARCHIVE_CODEX_ARGS_JSON must be a JSON array of strings.",
        "AGENT_ARCHIVE_CODEX_ERROR"
      );
    }
    return [...parsed, prompt];
  }

  return [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    prompt
  ];
}

function resolveCodexBin(env) {
  if (env.AGENT_ARCHIVE_CODEX_BIN) {
    if (path.isAbsolute(env.AGENT_ARCHIVE_CODEX_BIN)) return env.AGENT_ARCHIVE_CODEX_BIN;
    const configuredBinary = executableOnPath(env.AGENT_ARCHIVE_CODEX_BIN, env);
    if (configuredBinary) return configuredBinary;
  }

  const pathBinary = executableOnPath("codex", env);
  if (pathBinary) return pathBinary;

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Codex.app/Contents/Resources/codex",
      `${env.HOME || process.env.HOME || ""}/Applications/Codex.app/Contents/Resources/codex`
    ];
    const candidate = candidates.find((item) => item && existsSync(item));
    if (candidate) return candidate;
  }

  return "codex";
}

function executableOnPath(name, env = process.env) {
  const result = spawnSync("/usr/bin/env", ["which", name], {
    encoding: "utf8",
    env: childEnvWithPath(env)
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}

function childEnvWithPath(env) {
  const pathParts = [
    "/Applications/Codex.app/Contents/Resources",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    env.PATH,
    process.env.PATH
  ].filter(Boolean);
  return {
    ...process.env,
    ...env,
    PATH: Array.from(new Set(pathParts.join(":").split(":").filter(Boolean))).join(":")
  };
}

function codexChildEnv(env) {
  return {
    ...childEnvWithPath(env),
    AGENT_ARCHIVE_REFLECTION_VISIBILITY: "off",
    AGENT_ARCHIVE_CODEX_VERBOSE: "false"
  };
}

export async function callCodexReflection(turn, env = process.env, options = {}) {
  const prompt = buildCodexExecPrompt(turn);
  const bin = resolveCodexBin(env);
  let args;
  try {
    args = buildCodexExecArgs(prompt, env);
  } catch (error) {
    if (error?.code) throw error;
    throw reflectionError(
      error instanceof Error ? error.message : String(error),
      "AGENT_ARCHIVE_CODEX_ERROR",
      error
    );
  }

  const cwd = turn.cwd || process.cwd();
  const maxOutputBytes = Number(env.AGENT_ARCHIVE_CODEX_MAX_OUTPUT_BYTES || 1024 * 1024);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: codexChildEnv(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      reject(reflectionError(
        error instanceof Error ? error.message : String(error),
        "AGENT_ARCHIVE_CODEX_UNAVAILABLE",
        error
      ));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(reject, reflectionError("Codex reflection request was aborted.", "AGENT_ARCHIVE_CODEX_ERROR"));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        child.kill("SIGTERM");
        finish(reject, reflectionError("Codex reflection request was aborted.", "AGENT_ARCHIVE_CODEX_ERROR"));
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxOutputBytes) stdout = stdout.slice(-maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxOutputBytes) stderr = stderr.slice(-maxOutputBytes);
    });
    child.on("error", (error) => {
      finish(reject, reflectionError(
        error?.code === "ENOENT" ? `Codex executable not found: ${bin}` : (error instanceof Error ? error.message : String(error)),
        error?.code === "ENOENT" ? "AGENT_ARCHIVE_CODEX_UNAVAILABLE" : "AGENT_ARCHIVE_CODEX_ERROR",
        error
      ));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        finish(reject, reflectionError(
          `Codex reflection command failed${code === null ? "" : ` with exit code ${code}`}${signal ? ` (${signal})` : ""}: ${stderr.trim() || stdout.trim()}`,
          "AGENT_ARCHIVE_CODEX_ERROR"
        ));
        return;
      }
      try {
        finish(resolve, normalizeReflection(extractJsonObject(stdout)));
      } catch (error) {
        finish(reject, reflectionError(
          error instanceof Error ? error.message : String(error),
          "AGENT_ARCHIVE_CODEX_ERROR",
          error
        ));
      }
    });
  });
}

export async function callReflectionModel(turn, env = process.env, options = {}) {
  const provider = options.provider || (env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE ? "mock" : "codex");

  if (provider === "mock") return callMockReflection(turn, env, options);
  if (provider === "api") return callApiReflection(turn, env, options);
  if (provider === "codex") return callCodexReflection(turn, env, options);

  throw reflectionError(`Unknown reflection provider: ${provider}`, "AGENT_ARCHIVE_REFLECTION_PROVIDER_INVALID");
}

export function fingerprintDraft(draft) {
  return crypto
    .createHash("sha256")
    .update(normalizeString(`${draft?.title || ""}\n${draft?.summary || ""}`))
    .digest("hex")
    .slice(0, 24);
}

export function isDuplicateFingerprint(fingerprint, queueDrafts = [], storedFingerprints = []) {
  if (storedFingerprints.some((entry) => entry?.fingerprint === fingerprint || entry === fingerprint)) return true;
  return queueDrafts.some((draft) => fingerprintDraft(draft) === fingerprint);
}

export function enrichDraftFromTurn(draft, turn) {
  return {
    ...draft,
    sourceProject: turn.cwd ? turn.cwd.split("/").filter(Boolean).at(-1) || turn.cwd : "",
    sourceSession: turn.sessionId || turn.turnId || "",
    body: draft.body || [
      `## Summary`,
      draft.summary,
      "",
      `## Context`,
      turn.userText,
      "",
      `## What Worked`,
      turn.assistantText,
      "",
      `## Tool Evidence`,
      turn.toolSummary || "No tool summary captured."
    ].join("\n")
  };
}
