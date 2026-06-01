import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeToolkitEnv } from "./helpers/fake-toolkit.mjs";
import {
  PLUGIN_NAME,
  buildDoctorResult,
  doctorChecksFromInspection,
  ensurePersonalMarketplaceEntry,
  expectedPluginCachePath,
  inspectSetup,
  personalMarketplacePath,
  runSetup
} from "../scripts/lib/setup.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempHome() {
  return mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-setup-home-"));
}

function writeExecutable(dir, name, body = "process.stdout.write('ok')") {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

function writePluginSkeleton(root) {
  mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(path.join(root, "hooks"), { recursive: true });
  writeFileSync(path.join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: PLUGIN_NAME,
    version: "0.1.0+codex.test",
    mcpServers: "./.mcp.json"
  }, null, 2));
  writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "agent-archive": { url: "https://www.agentarchive.io/api/mcp/mcp" },
      "agent-archive-reflection": { args: ["./scripts/mcp-reflection-server.mjs"] }
    }
  }, null, 2));
  writeFileSync(path.join(root, "hooks", "hooks.json"), JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [] }],
      Stop: [{ hooks: [] }]
    }
  }, null, 2));
}

function marketplaceFor(home, sourcePath) {
  const marketplacePath = personalMarketplacePath({ HOME: home });
  mkdirSync(path.dirname(marketplacePath), { recursive: true });
  writeFileSync(marketplacePath, JSON.stringify({
    name: "personal",
    interface: { displayName: "Personal" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "local", path: sourcePath },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }
    ]
  }, null, 2));
}

function prepareHealthyPluginFixture() {
  const home = tempHome();
  const pluginRoot = path.join(home, "Projects", "codex-agent-archive");
  writePluginSkeleton(pluginRoot);
  marketplaceFor(home, "./Projects/codex-agent-archive");
  mkdirSync(expectedPluginCachePath(pluginRoot, { HOME: home }), { recursive: true });
  return { home, pluginRoot };
}

test("inspectSetup recognizes a healthy walk-up environment with fake Codex, toolkit, marketplace, and cache", () => {
  const home = tempHome();
  const fakeBin = path.join(home, "bin");
  writeExecutable(fakeBin, "codex");
  const sourcePath = repoRoot;
  marketplaceFor(home, sourcePath);
  mkdirSync(expectedPluginCachePath(repoRoot, { HOME: home }), { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH}`,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    AGENT_ARCHIVE_API_KEY: "agentarchive_12345678901234567890",
    ...fakeToolkitEnv(home)
  };

  const inspection = inspectSetup(repoRoot, env);
  const checks = doctorChecksFromInspection(inspection);
  const doctor = buildDoctorResult(repoRoot, env);

  assert.equal(inspection.codex.path.endsWith("/codex"), true);
  assert.equal(inspection.toolkit.found, true);
  assert.equal(inspection.marketplace.entryCurrent, true);
  assert.equal(inspection.pluginCache.installed, true);
  assert.equal(checks.some((item) => item.status === "error"), false);
  assert.equal(doctor.status, "ok");
});

test("ensurePersonalMarketplaceEntry creates the personal marketplace entry", () => {
  const home = tempHome();
  const pluginRoot = path.join(home, "Projects", "codex-agent-archive");
  mkdirSync(pluginRoot, { recursive: true });
  const env = { HOME: home };

  const result = ensurePersonalMarketplaceEntry(pluginRoot, env);
  const marketplace = JSON.parse(readFileSync(personalMarketplacePath(env), "utf8"));

  assert.equal(result.action, "updated_marketplace");
  assert.equal(marketplace.name, "personal");
  assert.equal(marketplace.plugins[0].name, PLUGIN_NAME);
  assert.equal(marketplace.plugins[0].source.path, "./Projects/codex-agent-archive");
});

test("runSetup dry-run plans managed toolkit clone and plugin install without mutating", () => {
  const home = tempHome();
  const pluginRoot = path.join(home, "Projects", "codex-agent-archive");
  writePluginSkeleton(pluginRoot);
  const fakeBin = path.join(home, "bin");
  writeExecutable(fakeBin, "codex");
  const env = {
    ...process.env,
    HOME: home,
    PATH: fakeBin,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    AGENT_ARCHIVE_TOOLKIT_BIN: "",
    AGENT_ARCHIVE_TOOLKIT_PATH: ""
  };

  const result = runSetup(pluginRoot, env, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.ok(result.actions.some((item) => item.action === "would_clone_toolkit"));
  assert.ok(result.actions.some((item) => item.action === "would_update_marketplace"));
  assert.ok(result.actions.some((item) => item.action === "would_install_plugin"));
});

test("doctor result marks missing toolkit and stale plugin cache as actionable errors", () => {
  const home = tempHome();
  const pluginRoot = path.join(home, "Projects", "codex-agent-archive");
  writePluginSkeleton(pluginRoot);
  const fakeBin = path.join(home, "bin");
  writeExecutable(fakeBin, "codex");
  const env = {
    ...process.env,
    HOME: home,
    PATH: fakeBin,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    AGENT_ARCHIVE_TOOLKIT_BIN: "",
    AGENT_ARCHIVE_TOOLKIT_PATH: ""
  };

  const result = buildDoctorResult(pluginRoot, env);
  const codes = result.checks.filter((item) => item.status === "error").map((item) => item.code);

  assert.equal(result.status, "error");
  assert.ok(codes.includes("toolkit_missing"));
  assert.ok(codes.includes("marketplace_missing_or_stale"));
  assert.ok(codes.includes("plugin_cache_missing_or_stale"));
});

test("doctor result warns when the API key is not inherited by the current process", () => {
  const { home, pluginRoot } = prepareHealthyPluginFixture();
  const fakeBin = path.join(home, "bin");
  writeExecutable(fakeBin, "codex");
  const env = {
    HOME: home,
    USER: "test-user",
    PATH: `${fakeBin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    ...fakeToolkitEnv(home)
  };

  const result = buildDoctorResult(pluginRoot, env);
  const keyCheck = result.checks.find((item) => item.name === "Agent Archive key");

  assert.equal(result.status, "warn");
  assert.equal(keyCheck.status, "warn");
  assert.equal(keyCheck.code, "agent_archive_key_missing_or_not_inherited");
});

test("doctor result reports missing Codex CLI as an actionable error", () => {
  const { home, pluginRoot } = prepareHealthyPluginFixture();
  const env = {
    HOME: home,
    USER: "test-user",
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    PLUGIN_DATA: path.join(home, "plugin-data"),
    AGENT_ARCHIVE_API_KEY: "agentarchive_12345678901234567890",
    ...fakeToolkitEnv(home)
  };

  const result = buildDoctorResult(pluginRoot, env);
  const codexCheck = result.checks.find((item) => item.name === "Codex CLI");

  assert.equal(result.status, "error");
  assert.equal(codexCheck.status, "error");
  assert.equal(codexCheck.code, "codex_missing");
  assert.equal(codexCheck.command, "Install or open Codex Desktop/App so the codex CLI is available.");
});
