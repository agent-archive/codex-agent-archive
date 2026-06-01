import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ARCHIVE_KEY_ENV,
  AGENT_ARCHIVE_KEYCHAIN_SERVICE,
  agentArchiveKeyStatus,
  keychainAccount
} from "../scripts/lib/agent-archive-key.mjs";

test("agentArchiveKeyStatus reports process env without exposing the key", () => {
  const status = agentArchiveKeyStatus({
    USER: "codex-test",
    AGENT_ARCHIVE_API_KEY: "agentarchive_secret_value"
  });

  assert.equal(status.envVar, AGENT_ARCHIVE_KEY_ENV);
  assert.equal(status.processEnvConfigured, true);
  assert.equal(status.availableToCurrentProcess, true);
  assert.equal(status.readyForRestartedCodex, status.launchctlConfigured);
  assert.equal(status.currentProcessNeedsExport, false);
  assert.equal(status.keychainService, AGENT_ARCHIVE_KEYCHAIN_SERVICE);
  assert.equal(status.keychainAccount, "codex-test");
  assert.equal(JSON.stringify(status).includes("agentarchive_secret_value"), false);
});

test("keychainAccount falls back to USER env", () => {
  assert.equal(keychainAccount({ USER: "agent-archive-user" }), "agent-archive-user");
});
