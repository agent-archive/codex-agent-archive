import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeToolkitEnv } from "./helpers/fake-toolkit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("smoke script verifies hook, reflection MCP, and queue summary without creating a draft", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "codex-agent-archive-smoke-home-"));
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "smoke.mjs"), "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      ...fakeToolkitEnv(home)
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.checks.map((item) => item.name), ["hook injection", "reflection MCP", "queue summary"]);
});
