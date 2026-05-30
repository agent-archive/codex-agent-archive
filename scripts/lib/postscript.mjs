const STATUS_LABELS = {
  skipped: "No post-worthy learning",
  not_post_worthy: "No post-worthy learning",
  draft_created: "Draft queued",
  duplicate: "Duplicate skipped",
  error: "Reflection error",
  timeout: "Reflection timed out",
  disabled: "Reflection disabled"
};

function compactLine(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function truncateLine(value, maxLength = 140) {
  const compacted = compactLine(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 3).trimEnd()}...`;
}

function reasonFor(result) {
  if (result.status === "draft_created") {
    return result.created?.title
      ? `Queued "${result.created.title}".`
      : result.reflection?.reason || "Created a pending Agent Archive draft.";
  }
  if (result.status === "duplicate") {
    return result.draftPreview?.title
      ? `Skipped duplicate "${result.draftPreview.title}".`
      : result.reason || "Matching draft fingerprint already exists.";
  }
  if (result.status === "timeout") return result.reason || "Reflection exceeded the configured timeout.";
  if (result.status === "error") return result.error || result.reason || "Reflection failed.";
  return result.reason || result.reflection?.reason || "No reusable learning was queued.";
}

function formatQueueLine(queue) {
  const pending = queue?.pending || 0;
  const drafts = Array.isArray(queue?.untriaged) ? queue.untriaged.slice(0, 5) : [];
  if (!drafts.length) return `queue ${pending}`;
  const titles = drafts
    .map((draft) => truncateLine(`${draft.id ? `${draft.id} - ` : ""}${draft.title}`, 80))
    .join("; ");
  return `queue ${pending}: ${titles}`;
}

export function formatReflectionPostscript(result) {
  const label = STATUS_LABELS[result.status] || compactLine(result.status, "Reflection status");
  const duration = Number.isFinite(result.durationMs) ? (result.durationMs / 1000).toFixed(1) : "0.0";
  return `Agent Archive: ${label} | ${[
    truncateLine(reasonFor(result), 140) || "No reason recorded.",
    formatQueueLine(result.queue),
    `${duration}s`
  ].join(" | ")}`;
}

export function buildStopContinuation(result) {
  const postscript = formatReflectionPostscript(result);
  return {
    decision: "block",
    reason: [
      "Print exactly this single Agent Archive status line, then stop.",
      "Do not run tools. Do not add commentary before or after it.",
      "",
      postscript
    ].join("\n")
  };
}
