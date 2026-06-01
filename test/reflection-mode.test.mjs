import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveReflectionSettings,
  setReflectionGateEnabled,
  setPublishPolicy,
  setReflectionProvider,
  setReflectionVisibility
} from "../scripts/lib/reflection-mode.mjs";

function envForTempData() {
  return {
    PLUGIN_DATA: mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-mode-"))
  };
}

test("resolveReflectionSettings defaults to tool visibility with the reflection gate on", () => {
  const resolved = resolveReflectionSettings(envForTempData());
  assert.equal(resolved.visibility, "tool");
  assert.equal(resolved.reflectionGateEnabled, true);
  assert.equal(resolved.publishPolicy, "queue");
  assert.equal(resolved.reflectionProvider, "codex");
  assert.equal(resolved.source, "default");
});

test("AGENT_ARCHIVE_REFLECTION_GATE_ENABLED controls heuristic gating", () => {
  const resolved = resolveReflectionSettings({
    ...envForTempData(),
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "true"
  });
  assert.equal(resolved.visibility, "tool");
  assert.equal(resolved.reflectionGateEnabled, true);
  assert.equal(resolved.reflectionGateSource, "AGENT_ARCHIVE_REFLECTION_GATE_ENABLED");
});

test("AGENT_ARCHIVE_REFLECTION_VISIBILITY controls disabling", () => {
  const resolved = resolveReflectionSettings({
    ...envForTempData(),
    AGENT_ARCHIVE_REFLECTION_VISIBILITY: "off"
  });
  assert.equal(resolved.visibility, "off");
  assert.equal(resolved.source, "AGENT_ARCHIVE_REFLECTION_VISIBILITY");
});

test("setters persist visibility, publish policy, and provider", () => {
  const env = envForTempData();
  setReflectionGateEnabled(true, env);
  assert.equal(resolveReflectionSettings(env).reflectionGateEnabled, true);
  setReflectionVisibility("verbose", env);
  assert.equal(resolveReflectionSettings(env).visibility, "verbose");
  setPublishPolicy("auto", env);
  assert.equal(resolveReflectionSettings(env).publishPolicy, "auto");
  setReflectionProvider("codex", env);
  assert.equal(resolveReflectionSettings(env).reflectionProvider, "codex");
  assert.throws(() => setReflectionGateEnabled("maybe", env), /Invalid reflection gate value/);
  assert.throws(() => setReflectionVisibility("chatty", env), /Invalid reflection visibility/);
  assert.throws(() => setReflectionVisibility("record", env), /Invalid reflection visibility/);
  assert.throws(() => setPublishPolicy("reckless", env), /Invalid publish policy/);
  assert.throws(() => setReflectionProvider("mock", env), /Invalid reflection provider/);
  assert.throws(() => setReflectionProvider("local-magic", env), /Invalid reflection provider/);
});

test("new env vars override settings", () => {
  const env = envForTempData();
  setReflectionGateEnabled(true, env);
  setReflectionVisibility("silent", env);
  setPublishPolicy("queue", env);
  setReflectionProvider("api", env);
  const resolved = resolveReflectionSettings({
    ...env,
    AGENT_ARCHIVE_REFLECTION_GATE_ENABLED: "false",
    AGENT_ARCHIVE_REFLECTION_VISIBILITY: "verbose",
    AGENT_ARCHIVE_PUBLISH_POLICY: "auto",
    AGENT_ARCHIVE_REFLECTION_PROVIDER: "codex"
  });
  assert.equal(resolved.reflectionGateEnabled, false);
  assert.equal(resolved.visibility, "verbose");
  assert.equal(resolved.publishPolicy, "auto");
  assert.equal(resolved.reflectionProvider, "codex");
});
