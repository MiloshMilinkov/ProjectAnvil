const assert = require("node:assert/strict");
const Module = require("node:module");
const { accountPolicy } = require("./compiled/app/lib/account-policy");
const { deliverAccountMail } = require("./compiled/app/lib/account-mail");

const origin = "https://app.example.test";
const configuration = {
  PROJECTANVIL_MODE: "online",
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "fixture-account-secret-not-for-use-123456789",
  PROJECTANVIL_ALLOWED_EMAILS: "owner@example.test",
  PROJECTANVIL_DIAGNOSTICS_TOKEN:
    "fixture-diagnostics-token-not-for-use-123456789",
  PROJECTANVIL_MAIL_PROVIDER: "resend",
  PROJECTANVIL_MAIL_FROM: "ProjectAnvil <accounts@example.test>",
  RESEND_API_KEY: "re_fixture_not_a_real_provider_key",
};

async function run() {
  const policy = accountPolicy(configuration, origin);
  const noDatabase = {
    async batch() {
      throw new Error("External delivery must not write local recovery links.");
    },
  };
  const mail = {
    email: "OWNER@EXAMPLE.TEST",
    kind: "reset",
    url: `${origin}/api/auth/reset-password/private-token`,
  };
  let request;
  const send = async (url, options) => {
    request = { url, options };
    return Response.json({ id: "provider-receipt" });
  };
  await deliverAccountMail(noDatabase, configuration, policy, mail, send);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.method, "POST");
  assert.equal(
    request.options.headers.Authorization,
    `Bearer ${configuration.RESEND_API_KEY}`,
  );
  assert(request.options.signal instanceof AbortSignal);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["owner@example.test"]);
  assert.equal(body.from, configuration.PROJECTANVIL_MAIL_FROM);
  assert.equal(body.subject, "Reset your ProjectAnvil password");
  assert(body.text.includes(mail.url));
  assert(body.text.includes("30 minutes"));
  assert.equal(
    body.html,
    undefined,
    "Recovery messages use plain text rather than injecting URL markup",
  );
  await deliverAccountMail(
    noDatabase,
    configuration,
    policy,
    { ...mail, kind: "verification" },
    send,
  );
  assert.equal(
    JSON.parse(request.options.body).subject,
    "Verify your ProjectAnvil email",
  );
  for (const fetcher of [
    async () => new Response("private-provider-error", { status: 429 }),
    async () => {
      throw new Error(`Network error with ${mail.url}`);
    },
    async () => new Response("not-json", { status: 200 }),
    async () => Response.json({}),
  ])
    await assert.rejects(
      deliverAccountMail(noDatabase, configuration, policy, mail, fetcher),
      (error) =>
        error.status === 503 &&
        !error.message.includes(mail.url) &&
        !error.message.includes("private-provider-error"),
    );
  await assert.rejects(
    deliverAccountMail(
      noDatabase,
      configuration,
      policy,
      { ...mail, email: "owner@example.test\r\nBcc:other@example.test" },
      send,
    ),
    (error) => error.status === 503,
  );
  let localWrites = 0;
  let externalCalls = 0;
  const statement = {
    bind() {
      return this;
    },
  };
  await deliverAccountMail(
    {
      prepare() {
        return statement;
      },
      async batch() {
        localWrites++;
      },
    },
    configuration,
    accountPolicy({}, "http://127.0.0.1:5173"),
    {
      ...mail,
      url: "http://127.0.0.1:5173/api/auth/reset-password/private-token",
    },
    async () => {
      externalCalls++;
      throw new Error("Must not send");
    },
  );
  assert.equal(localWrites, 1);
  assert.equal(
    externalCalls,
    0,
    "Local mode must never use external provider credentials",
  );

  const environment = { ...configuration };
  const originalLoad = Module._load;
  let databaseReads = 0,
    bucketReads = 0,
    migrationChecks = 0;
  let schemaMatches = true;
  Module._load = function (name, parent, ...args) {
    if (name === "cloudflare:workers") return { env: environment };
    if (name.endsWith("/lib/auth") || name === "./auth")
      return {
        async verifyDatabaseRelease(database) {
          assert.equal(database, environment.DB);
          migrationChecks++;
          if (!schemaMatches) throw new Error("private-schema-checksum-drift");
        },
      };
    return originalLoad.call(this, name, parent, ...args);
  };
  try {
    const { GET } = require("./compiled/app/api/health/route");
    const health = (token) =>
      GET(
        new Request(`${origin}/api/health`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
      );
    for (const token of [undefined, "incorrect", "x".repeat(1100)]) {
      const result = await health(token);
      assert.equal(result.status, 404);
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await result.json(), { message: "Not found." });
    }
    const validToken = environment.PROJECTANVIL_DIAGNOSTICS_TOKEN;
    delete environment.PROJECTANVIL_DIAGNOSTICS_TOKEN;
    assert.equal(
      (await health(validToken)).status,
      404,
      "Diagnostics are disabled unless explicitly configured",
    );
    environment.PROJECTANVIL_DIAGNOSTICS_TOKEN = validToken;
    environment.DB = {
      prepare() {
        databaseReads++;
        return {
          async first() {
            return { available: 1 };
          },
        };
      },
    };
    environment.BUCKET = {
      async list(options) {
        bucketReads++;
        assert.deepEqual(options, { prefix: "projectanvil-health/", limit: 1 });
        return { objects: [{ key: "private-file-name" }] };
      },
    };
    const healthy = await health(validToken);
    assert.equal(healthy.status, 200);
    const report = await healthy.json();
    assert.deepEqual(report, {
      status: "ready",
      checks: {
        configuration: true,
        database: true,
        migrations: true,
        uploads: true,
      },
    });
    assert(databaseReads > 0 && bucketReads === 1 && migrationChecks === 1);
    for (const value of [
      configuration.BETTER_AUTH_SECRET,
      configuration.RESEND_API_KEY,
      "private-file-name",
      configuration.PROJECTANVIL_ALLOWED_EMAILS,
    ])
      assert(!JSON.stringify(report).includes(value));
    schemaMatches = false;
    const drift = await health(validToken);
    assert.equal(drift.status, 503);
    assert.deepEqual((await drift.json()).checks, {
      configuration: true,
      database: true,
      migrations: false,
      uploads: true,
    });
    environment.DB = {
      prepare() {
        throw new Error("private-database-path");
      },
    };
    environment.BUCKET = {
      async list() {
        throw new Error("private-bucket-error");
      },
    };
    const unavailable = await health(validToken);
    assert.equal(unavailable.status, 503);
    const failed = await unavailable.text();
    assert(
      !failed.includes("private-database-path") &&
        !failed.includes("private-bucket-error"),
    );
    assert.equal(JSON.parse(failed).checks.database, false);

    const { routeError } = require("./compiled/app/lib/workspace-store");
    const originalConsoleError = console.error;
    const logs = [];
    console.error = (...values) => logs.push(values);
    try {
      assert.equal(
        routeError(new Error("no such table: private-records")).status,
        503,
      );
      for (let index = 0; index < 10; index++)
        assert.equal(
          routeError(
            new Error(`private-message-${configuration.BETTER_AUTH_SECRET}`),
          ).status,
          500,
        );
      assert.equal(
        logs.length,
        5,
        "Operational logs are bounded per instance and minute",
      );
      for (const values of logs) {
        assert.equal(values.length, 1);
        const log = JSON.parse(values[0]);
        assert.equal(log.event, "workspace-request-failed");
        assert([500, 503].includes(log.status));
        assert(
          !values[0].includes("private-") &&
            !values[0].includes(configuration.BETTER_AUTH_SECRET),
        );
      }
    } finally {
      console.error = originalConsoleError;
    }
  } finally {
    Module._load = originalLoad;
  }
  console.log(
    "Release mail adapter and private diagnostics passed with mocked HTTP/storage only.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
