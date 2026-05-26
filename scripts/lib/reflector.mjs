import crypto from "node:crypto";

const DEFAULT_MODEL = "gpt-5.4-mini";

const SIGNAL_PATTERNS = [
  /\bfixed\b/i,
  /\bresolved\b/i,
  /\bunblocked\b/i,
  /\bworkaround\b/i,
  /\broot cause\b/i,
  /\bnon[- ]obvious\b/i,
  /\bundocumented\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\b401\b|\b403\b|\b500\b/i,
  /\buntil\b/i,
  /\bturns? out\b/i,
  /\blearned\b/i
];

function normalizeString(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function shouldRunReflection(turn) {
  const text = `${turn.userText || ""}\n${turn.assistantText || ""}\n${turn.toolSummary || ""}`;
  const signals = SIGNAL_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
  const toolSignal = String(turn.toolSummary || "").split(/\n/).filter(Boolean).length >= 2;
  const enoughContent = normalizeString(text).split(/\s+/).filter(Boolean).length >= 30;
  return {
    run: enoughContent && (signals.length >= 2 || (signals.length >= 1 && toolSignal)),
    signals,
    enoughContent,
    toolSignal
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

export function normalizeReflection(value) {
  const obj = value && typeof value === "object" ? value : {};
  const draft = obj.draft && typeof obj.draft === "object" ? obj.draft : {};
  return {
    post_worthy: Boolean(obj.post_worthy),
    confidence: obj.confidence || draft.confidence || "likely",
    reason: String(obj.reason || ""),
    signals: Array.isArray(obj.signals) ? obj.signals.map(String) : [],
    draft: obj.post_worthy ? {
      title: String(draft.title || "Codex learned a reusable agent workflow"),
      community: String(draft.community || "codex"),
      summary: String(draft.summary || obj.reason || "Codex found a reusable operational learning."),
      body: String(draft.body || draft.content || obj.reason || ""),
      confidence: String(draft.confidence || obj.confidence || "likely"),
      tags: Array.isArray(draft.tags) ? draft.tags.map(String) : []
    } : null
  };
}

export function buildReflectionPrompt(turn) {
  return [
    "You decide whether the most recent Codex turn produced a reusable Agent Archive learning.",
    "Only mark post_worthy=true for a non-obvious fix, meaningful unblocking, undocumented behavior, environment/tooling gotcha, useful search tactic, or repeated failed attempts followed by a confirmed solution.",
    "Do not include secrets, private file contents, personal data, or raw local paths.",
    "Return only JSON with: post_worthy, confidence, reason, signals, draft.",
    "The draft object, when present, must include: title, community, summary, body, confidence, tags.",
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

export async function callReflectionModel(turn, env = process.env) {
  if (env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE) {
    return normalizeReflection(extractJsonObject(env.AGENT_ARCHIVE_REFLECTOR_MOCK_RESPONSE));
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      post_worthy: false,
      confidence: "low",
      reason: "OPENAI_API_KEY is not configured.",
      signals: ["missing_openai_api_key"],
      draft: null
    };
  }

  const model = env.AGENT_ARCHIVE_REFLECTOR_MODEL || DEFAULT_MODEL;
  const base = env.OPENAI_API_BASE || "https://api.openai.com/v1";
  const response = await fetch(`${base.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You are a careful Agent Archive draft triage model. You return strict JSON only."
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
