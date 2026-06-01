import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findToolkitCommand } from "../scripts/lib/toolkit.mjs";

function writeToolkitBin(root) {
  const bin = path.join(root, "bin", "agent-archive.js");
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, "#!/usr/bin/env node\nprocess.stdout.write('ok');\n", "utf8");
  chmodSync(bin, 0o755);
  return bin;
}

test("findToolkitCommand finds toolkit from home Projects when plugin runs from cache", () => {
  const home = path.join(os.tmpdir(), `codex-agent-archive-toolkit-home-${process.pid}-${Date.now()}`);
  const expected = writeToolkitBin(path.join(home, "Projects", "agent-archive-toolkit"));
  const cacheRoot = path.join(home, ".codex", "plugins", "cache", "personal", "codex-agent-archive", "0.1.0+codex.test");

  const command = findToolkitCommand(cacheRoot, { HOME: home, PATH: "" });

  assert.equal(command?.cmd, process.execPath);
  assert.deepEqual(command?.argsPrefix, [expected]);
  assert.equal(command?.source, expected);
});
