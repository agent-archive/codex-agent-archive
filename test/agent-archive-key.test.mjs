import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ARCHIVE_KEY_ENV,
  AGENT_ARCHIVE_KEYCHAIN_SERVICE,
  agentArchiveKeyStatus,
  isSupportedAgentArchiveApiKey,
  storeAgentArchiveKeyInKeychain,
  keychainAccount
} from "../scripts/lib/agent-archive-key.mjs";

test("agentArchiveKeyStatus reports process env without exposing the key", () => {
  const status = agentArchiveKeyStatus({
    USER: "codex-test",
    AGENT_ARCHIVE_API_KEY: "agentarchive_live_testvalue1234567890"
  });

  assert.equal(status.envVar, AGENT_ARCHIVE_KEY_ENV);
  assert.equal(status.processEnvConfigured, true);
  assert.equal(status.processEnvLooksValid, true);
  assert.equal(status.availableToCurrentProcess, true);
  assert.equal(status.readyForRestartedCodex, status.launchctlValueLooksValid);
  assert.equal(status.currentProcessNeedsExport, false);
  assert.equal(status.keychainService, AGENT_ARCHIVE_KEYCHAIN_SERVICE);
  assert.equal(status.keychainAccount, "codex-test");
  assert.equal(JSON.stringify(status).includes("agentarchive_live_testvalue1234567890"), false);
});

test("agentArchiveKeyStatus reports invalid current process key", () => {
  const status = agentArchiveKeyStatus({
    USER: "codex-test",
    AGENT_ARCHIVE_API_KEY: "not-the-api-key"
  });

  assert.equal(status.processEnvConfigured, true);
  assert.equal(status.processEnvLooksValid, false);
  assert.equal(status.availableToCurrentProcess, false);
});

test("storeAgentArchiveKeyInKeychain rejects non-Agent-Archive-looking values before writing", () => {
  assert.throws(
    () => storeAgentArchiveKeyInKeychain("not-the-api-key", { USER: "codex-test" }),
    /must start with "agentarchive_"/
  );
});

test("isSupportedAgentArchiveApiKey validates expected Agent Archive shape", () => {
  assert.equal(isSupportedAgentArchiveApiKey("agentarchive_live_testvalue1234567890"), true);
  assert.equal(isSupportedAgentArchiveApiKey("not-the-api-key"), false);
});

test("keychainAccount falls back to USER env", () => {
  assert.equal(keychainAccount({ USER: "agent-archive-user" }), "agent-archive-user");
});
