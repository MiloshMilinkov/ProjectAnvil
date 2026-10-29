import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  releaseConfigurationReport,
  accountMailTransport,
  resolveAccountConfiguration,
} from "../app/lib/release-config.ts";
import { runReleaseRehearsal } from "../scripts/release-readiness.mjs";

const secret = "fixture-account-secret-not-for-use-123456789";
const online = {
  PROJECTANVIL_MODE: "online",
  BETTER_AUTH_URL: "https://app.example.test",
  BETTER_AUTH_SECRET: secret,
  PROJECTANVIL_ALLOWED_EMAILS: "owner@example.test",
  PROJECTANVIL_DIAGNOSTICS_TOKEN:
    "fixture-diagnostics-token-not-for-use-123456789",
  PROJECTANVIL_MAIL_PROVIDER: "resend",
  PROJECTANVIL_MAIL_FROM: "ProjectAnvil <accounts@example.test>",
  RESEND_API_KEY: "re_fixture_not_a_real_provider_key",
};

test("release configuration is redacted, offline, explicit, and fail-closed", () => {
  assert.equal(
    releaseConfigurationReport({ BETTER_AUTH_SECRET: secret }).passed,
    true,
  );
  assert.equal(releaseConfigurationReport({}).passed, false);
  assert.equal(accountMailTransport(online), "resend");
  const report = releaseConfigurationReport(online);
  assert.equal(report.passed, true);
  assert.equal(report.remoteResourcesVerified, false);
  for (const value of [
    secret,
    online.RESEND_API_KEY,
    online.PROJECTANVIL_DIAGNOSTICS_TOKEN,
    online.PROJECTANVIL_ALLOWED_EMAILS,
    online.PROJECTANVIL_MAIL_FROM,
    online.BETTER_AUTH_URL,
  ])
    assert(!JSON.stringify(report).includes(value));
  for (const key of [
    "BETTER_AUTH_URL",
    "PROJECTANVIL_ALLOWED_EMAILS",
    "BETTER_AUTH_SECRET",
    "PROJECTANVIL_DIAGNOSTICS_TOKEN",
    "PROJECTANVIL_MAIL_FROM",
    "RESEND_API_KEY",
  ]) {
    const incomplete = { ...online };
    delete incomplete[key];
    assert.equal(releaseConfigurationReport(incomplete).passed, false, key);
  }
  for (const update of [
    { PROJECTANVIL_MODE: "public" },
    { BETTER_AUTH_URL: "http://app.example.test" },
    { BETTER_AUTH_URL: "https://app.example.test/path" },
    { BETTER_AUTH_URL: "https://user:secret@app.example.test" },
    { PROJECTANVIL_DIAGNOSTICS_TOKEN: secret },
    { PROJECTANVIL_MAIL_PROVIDER: "unknown" },
    {
      PROJECTANVIL_MAIL_FROM:
        "accounts@example.test\r\nBcc: other@example.test",
    },
    { PROJECTANVIL_MAIL_FROM: "ProjectAnvil <accounts@example.test" },
    { PROJECTANVIL_MAIL_FROM: "accounts@example.test>" },
    { RESEND_API_KEY: "key with spaces" },
    { ACCOUNT_MAILER: { fetch } },
  ])
    assert.equal(
      releaseConfigurationReport({ ...online, ...update }).passed,
      false,
      JSON.stringify(update),
    );
  assert.throws(
    () => resolveAccountConfiguration(online, "https://other.example.test"),
    (error) => error.status === 403,
  );
});

test("release rehearsal migrates, restores, and rolls back only disposable synthetic state", async () => {
  const report = await runReleaseRehearsal();
  assert.equal(report.passed, true);
  assert.deepEqual(report.checks, {
    backupVerified: true,
    migrationPreservedData: true,
    failedMigrationRolledBack: true,
    releaseRollbackRestoredAllState: true,
    previousStateRecoveryVerified: true,
  });
  assert(report.migrationVersion >= 8);
});

test("release CLI rejects live-path options and never prints environment secrets", () => {
  const invalid = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/release-readiness.mjs",
      "--project",
      ".",
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalid.status, 1);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/release-readiness.mjs"],
    {
      encoding: "utf8",
      // Simulate Node versions where TypeScript stripping is not on by default.
      env: {
        ...process.env,
        ...online,
        NODE_OPTIONS: "--no-experimental-strip-types",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
  assert(!result.stdout.includes(secret));
  assert(!result.stdout.includes(online.RESEND_API_KEY));
});
