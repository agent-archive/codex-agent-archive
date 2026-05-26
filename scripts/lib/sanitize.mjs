const SECRET_PATTERNS = [
  {
    name: "private_key_block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY_BLOCK]"
  },
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: "Bearer [REDACTED_TOKEN]"
  },
  {
    name: "agent_archive_key",
    pattern: /\bagentarchive_[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_AGENT_ARCHIVE_KEY]"
  },
  {
    name: "openai_key",
    pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED_API_KEY]"
  },
  {
    name: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]"
  },
  {
    name: "env_secret_assignment",
    pattern: /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*\s*=\s*["']?[^"'\s]+/g,
    replacement: "[REDACTED_SECRET_ASSIGNMENT]"
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]"
  },
  {
    name: "mac_home_path",
    pattern: /\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>)]*)?/g,
    replacement: "/Users/[REDACTED_PATH]"
  },
  {
    name: "unix_home_path",
    pattern: /\/home\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>)]*)?/g,
    replacement: "/home/[REDACTED_PATH]"
  }
];

const BLOCKED_FILE_MARKERS = [
  ".env",
  "id_rsa",
  "id_ed25519",
  "SOUL.md",
  "IDENTITY.md",
  "openclaw.json"
];

export function truncateText(value, maxChars = 12000) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[TRUNCATED ${text.length - maxChars} chars]`;
}

export function sanitizeText(value, options = {}) {
  const maxChars = options.maxChars ?? 12000;
  let text = truncateText(value, maxChars);
  const replacements = [];
  const blockedMarkers = [];

  for (const marker of BLOCKED_FILE_MARKERS) {
    if (text.includes(marker)) blockedMarkers.push(marker);
  }

  for (const item of SECRET_PATTERNS) {
    let count = 0;
    text = text.replace(item.pattern, () => {
      count += 1;
      return item.replacement;
    });
    if (count > 0) replacements.push({ name: item.name, count });
  }

  return { text, replacements, blockedMarkers };
}

export function sanitizeTurn(turn, options = {}) {
  const maxChars = options.maxChars ?? 12000;
  const fields = ["userText", "assistantText", "toolSummary"];
  const sanitized = { ...turn };
  const replacements = [];
  const blockedMarkers = new Set();

  for (const field of fields) {
    const result = sanitizeText(turn[field] || "", { maxChars });
    sanitized[field] = result.text;
    replacements.push(...result.replacements.map((item) => ({ ...item, field })));
    result.blockedMarkers.forEach((marker) => blockedMarkers.add(marker));
  }

  return {
    turn: sanitized,
    replacements,
    blockedMarkers: Array.from(blockedMarkers)
  };
}
