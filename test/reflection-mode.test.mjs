import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveReflectionMode,
  setReflectionMode
} from "../scripts/lib/reflection-mode.mjs";

function envForTempData() {
  return {
    PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-mode-"))
  };
}

test("resolveReflectionMode defaults to visible", () => {
  const resolved = resolveReflectionMode(envForTempData());
  assert.equal(resolved.mode, "visible");
  assert.equal(resolved.source, "default");
});

test("resolveReflectionMode prefers disabled env over mode env", () => {
  const resolved = resolveReflectionMode({
    ...envForTempData(),
    AGENT_ARCHIVE_REFLECTION_DISABLED: "true",
    AGENT_ARCHIVE_REFLECTION_MODE: "visible"
  });
  assert.equal(resolved.mode, "off");
  assert.equal(resolved.source, "AGENT_ARCHIVE_REFLECTION_DISABLED");
});

test("resolveReflectionMode prefers env mode over settings", () => {
  const env = envForTempData();
  setReflectionMode("off", env);
  const resolved = resolveReflectionMode({
    ...env,
    AGENT_ARCHIVE_REFLECTION_MODE: "record"
  });
  assert.equal(resolved.mode, "record");
  assert.equal(resolved.source, "AGENT_ARCHIVE_REFLECTION_MODE");
});

test("setReflectionMode persists valid modes and rejects invalid modes", () => {
  const env = envForTempData();
  setReflectionMode("record", env);
  assert.equal(resolveReflectionMode(env).mode, "record");
  assert.throws(() => setReflectionMode("loud", env), /Invalid reflection mode/);
});
