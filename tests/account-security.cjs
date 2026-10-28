const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { createHash, createHmac } = require("node:crypto");
const ts = require("typescript");
const { accountPolicy, emailApproved, accountCallback } = require("./compiled/app/lib/account-policy");
const { deliverAccountMail } = require("./compiled/app/lib/account-mail");

const localOrigin = "http://127.0.0.1:5199";
const onlineOrigin = "https://projectanvil.test";
const onlineConfiguration = {
  PROJECTANVIL_MODE: "online",
  BETTER_AUTH_URL: onlineOrigin,
  PROJECTANVIL_ALLOWED_EMAILS: " Owner@Example.test , member@example.test",
  ACCOUNT_MAILER: { fetch: async () => new Response(null, { status: 204 }) },
};
const status = (expected) => (error) => error.status === expected;

/** Exercise the installed auth library with the app's actual configuration. */
async function nativeAuthChecks(root, policy) {
  const plugin = pathToFileURL(require.resolve("better-auth/plugins/username")).href;
  const source = (await fs.readFile(path.join(root, "app/lib/auth-options.ts"), "utf8"))
    .replace(/from ["']better-auth\/plugins\/username["']/, `from ${JSON.stringify(plugin)}`);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { authOptions } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
  const { betterAuth } = await import(pathToFileURL(require.resolve("better-auth")).href);
  const sql = new DatabaseSync(":memory:");
  sql.exec(await fs.readFile(path.join(root, "db/auth.sql"), "utf8"));
  const secret = "fixture-only-native-auth-secret-at-least-32-characters";
  const mail = [];
  const auth = betterAuth({
    ...authOptions(sql, secret, onlineOrigin, {
      policy,
      send: async (email, url, kind) => { mail.push({ email, url, kind }); },
    }),
    logger: { disabled: true },
  });
  const password = "Native-fixture-password-123!";
  const nextPassword = "Changed-fixture-password-456!";
  const post = (endpoint, body, ip = "198.51.100.10") => auth.handler(new Request(`${onlineOrigin}/api/auth/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: onlineOrigin, "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  }));
  const tokenFor = (url) => decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  try {
    const registration = await post("sign-up/email", {
      username: "nativeowner", name: "nativeowner", email: "owner@example.test", password,
      callbackURL: `${onlineOrigin}/?account=verified`,
    });
    assert.equal(registration.status, 200);
    assert.equal((await registration.json()).token, null, "Online registration must not create an authenticated session");
    assert.equal(registration.headers.get("set-cookie"), null);
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 0);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].kind, "verification");
    assert.equal((await post("sign-in/username", { username: "nativeowner", password })).status, 403);
    const verified = await auth.handler(new Request(mail[0].url));
    assert.equal(verified.status, 302);
    assert.equal(verified.headers.get("location"), `${onlineOrigin}/?account=verified`);
    assert.equal(verified.headers.get("set-cookie"), null, "Verification must require an explicit sign-in");
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 0);
    assert.equal(sql.prepare('SELECT emailVerified FROM "user" WHERE email=?').get("owner@example.test").emailVerified, 1);
    const replayedVerification = await auth.handler(new Request(mail[0].url));
    assert.equal(replayedVerification.status, 302, "Repeated verification is idempotent");
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 0);
    const signedIn = await post("sign-in/username", { username: "nativeowner", password });
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.headers.get("set-cookie"), /Secure/);
    assert.match(signedIn.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 1);

    const sendReset = (email, ip) => post("request-password-reset", { email, redirectTo: `${onlineOrigin}/?account=reset` }, ip);
    const known = await sendReset("owner@example.test", "198.51.100.11");
    const unknown = await sendReset("missing@example.test", "198.51.100.12");
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), await unknown.json(), "Recovery must not reveal whether an address exists");
    assert.equal(mail.filter((message) => message.kind === "reset").length, 1);
    const firstReset = mail.at(-1);
    const firstToken = tokenFor(firstReset.url);
    sql.prepare('UPDATE "verification" SET expiresAt=? WHERE identifier=?').run(Date.now() - 1000, `reset-password:${firstToken}`);
    const expiredReset = await post("reset-password", { token: firstToken, newPassword: nextPassword }, "198.51.100.13");
    assert.equal(expiredReset.status, 400);
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 1, "Rejected reset must preserve current sessions");
    await sendReset("owner@example.test", "198.51.100.14");
    const resetToken = tokenFor(mail.at(-1).url);
    assert.equal((await post("reset-password", { token: resetToken, newPassword: nextPassword }, "198.51.100.15")).status, 200);
    assert.equal(sql.prepare('SELECT count(*) AS count FROM "session"').get().count, 0, "Successful recovery revokes existing sessions");
    assert.equal((await post("reset-password", { token: resetToken, newPassword: password }, "198.51.100.16")).status, 400, "Reset tokens are single-use");
    assert.equal((await post("sign-in/username", { username: "nativeowner", password }, "198.51.100.17")).status, 401);
    assert.equal((await post("sign-in/username", { username: "nativeowner", password: nextPassword }, "198.51.100.18")).status, 200);

    const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify({ email: "owner@example.test", exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const expiredToken = `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
    const expiredVerificationURL = `${onlineOrigin}/api/auth/verify-email?token=${expiredToken}&callbackURL=${encodeURIComponent(`${onlineOrigin}/?account=verified`)}`;
    const expiredVerification = await auth.handler(new Request(expiredVerificationURL));
    assert.equal(expiredVerification.status, 302);
    assert.equal(new URL(expiredVerification.headers.get("location")).searchParams.get("error"), "TOKEN_EXPIRED");
    const tampered = new URL(mail[0].url);
    tampered.searchParams.set("token", "forged.token.signature");
    const forgedVerification = await auth.handler(new Request(tampered));
    assert.equal(forgedVerification.status, 302);
    assert.equal(new URL(forgedVerification.headers.get("location")).searchParams.get("error"), "INVALID_TOKEN");
    for (let index = 0; index < 3; index++)
      assert.equal((await sendReset("missing@example.test", "198.51.100.19")).status, 200);
    const limited = await sendReset("missing@example.test", "198.51.100.19");
    assert.equal(limited.status, 429, "The fourth recovery request is rate-limited");
    assert.match((await limited.json()).message, /too many|rate limit|try again/i);
    assert.equal(mail.filter((message) => message.email === "missing@example.test").length, 0);
    console.log("Native Better Auth verification, recovery, expiry, replay, revocation and rate-limit integration passed.");
  } finally { sql.close(); }
}

async function main() {
  for (const origin of [localOrigin, "http://localhost:5199", "http://[::1]:5199"])
    assert.equal(accountPolicy({}, origin).public.mode, "local");
  for (const origin of [onlineOrigin, "http://localhost.evil.test", "http://192.168.1.5"])
    assert.throws(() => accountPolicy({}, origin), status(503));
  for (const configuration of [
    { PROJECTANVIL_MODE: "unknown" },
    { BETTER_AUTH_URL: "invalid" },
    { BETTER_AUTH_URL: `${localOrigin}/path` },
    { BETTER_AUTH_URL: `${localOrigin}/?query=1` },
    { BETTER_AUTH_URL: "http://user:password@127.0.0.1:5199" },
    { PROJECTANVIL_ALLOWED_EMAILS: "not-an-email" },
    { PROJECTANVIL_ALLOWED_EMAILS: Array.from({ length: 201 }, (_, index) => `${index}@example.test`).join(",") },
  ]) assert.throws(() => accountPolicy(configuration, localOrigin), status(503));
  for (const key of ["BETTER_AUTH_URL", "PROJECTANVIL_ALLOWED_EMAILS", "ACCOUNT_MAILER"]) {
    const configuration = { ...onlineConfiguration };
    delete configuration[key];
    assert.throws(() => accountPolicy(configuration, onlineOrigin), status(503));
  }
  assert.throws(() => accountPolicy({ ...onlineConfiguration, BETTER_AUTH_URL: "http://projectanvil.test" }, "http://projectanvil.test"), status(503));
  assert.throws(() => accountPolicy(onlineConfiguration, "https://different.test"), status(403));
  const local = accountPolicy({}, localOrigin);
  const online = accountPolicy(onlineConfiguration, onlineOrigin);
  assert.equal(emailApproved(local, "anyone@example.test"), true);
  assert.equal(emailApproved(online, "OWNER@EXAMPLE.TEST"), true);
  assert.equal(emailApproved(online, "foreign@example.test"), false);
  assert.equal(online.public.registration, "invite-only");
  assert.equal(online.public.verificationRequired, true);
  assert.equal(JSON.stringify(online.public).includes("owner@"), false);
  for (const kind of ["reset", "verified"]) {
    const expected = `${onlineOrigin}/?account=${kind}`;
    assert.equal(accountCallback(undefined, onlineOrigin, kind), expected);
    assert.equal(accountCallback(expected, onlineOrigin, kind), expected);
    for (const value of ["https://evil.test", "//evil.test", "/", `${expected}&next=https://evil.test`, {}, null])
      assert.throws(() => accountCallback(value, onlineOrigin, kind), status(400));
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "projectanvil-account-security-"));
  const location = path.join(directory, "fixture.sqlite");
  const sql = new DatabaseSync(location);
  const root = process.env.PROJECTANVIL_CHECK_ROOT || process.cwd();
  const originalLoad = Module._load;
  try {
    sql.exec(await fs.readFile(path.join(root, "db/release.sql"), "utf8"));
    const database = {
      prepare(query) {
        const statement = sql.prepare(query);
        let values = [];
        return {
          bind(...parameters) { values = parameters; return this; },
          async first() { return statement.get(...values) || null; },
          async all() { return { results: statement.all(...values) }; },
          async run() { return statement.run(...values); },
        };
      },
      async batch(statements) {
        sql.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sql.exec("COMMIT");
          return results;
        } catch (error) { sql.exec("ROLLBACK"); throw error; }
      },
    };
    const link = `${localOrigin}/api/auth/reset-password/private-token?callbackURL=${encodeURIComponent(`${localOrigin}/?account=reset`)}`;
    const expired = Date.now() - 1000;
    sql.prepare("INSERT INTO account_mail_outbox VALUES (?,?,?,?,?,?)").run("expired", "owner@example.test", "reset", "expired-secret", expired, expired);
    for (let index = 0; index < 103; index++)
      await deliverAccountMail(database, {}, local, { email: "OWNER@EXAMPLE.TEST", url: link, kind: "reset" });
    assert.equal(sql.prepare("SELECT count(*) AS count FROM account_mail_outbox").get().count, 100);
    assert.equal(sql.prepare("SELECT id FROM account_mail_outbox WHERE id='expired'").get(), undefined);
    assert.equal(sql.prepare("SELECT email FROM account_mail_outbox LIMIT 1").get().email, "owner@example.test");
    const resetMail = sql.prepare("SELECT created_at,expires_at FROM account_mail_outbox LIMIT 1").get();
    assert.equal(resetMail.expires_at - resetMail.created_at, 1_800_000, "Local reset links must expire with their 30-minute reset tokens");
    await assert.rejects(deliverAccountMail(database, {}, local, { email: "owner@example.test", url: "https://evil.test/api/auth/reset", kind: "reset" }), status(503));
    let delivered;
    await deliverAccountMail(database, { ACCOUNT_MAILER: { fetch: async (url, options) => {
      delivered = { url, options }; return new Response(null, { status: 204 });
    } } }, online, { email: "owner@example.test", url: `${onlineOrigin}/api/auth/verify-email?token=private-token`, kind: "verification" });
    assert.equal(delivered.url, "https://account-mail.internal/send");
    assert.equal(delivered.options.method, "POST");
    assert.equal(JSON.parse(delivered.options.body).kind, "verification");
    await assert.rejects(deliverAccountMail(database, { ACCOUNT_MAILER: { fetch: async () => new Response(null, { status: 503 }) } }, online, { email: "owner@example.test", url: `${onlineOrigin}/api/auth/verify-email?token=private-token`, kind: "verification" }), status(503));
    assert.equal(sql.prepare("SELECT count(*) AS count FROM account_mail_outbox").get().count, 100, "Online delivery never stores recovery links in the local outbox");

    const { readLocalAccountMail } = await import(pathToFileURL(path.join(root, "scripts/account-mail.mjs")).href);
    sql.prepare("INSERT INTO account_mail_outbox VALUES (?,?,?,?,?,?)").run("cli-expired", "owner@example.test", "reset", "expired-cli-secret", Date.now() + 10000, expired);
    const before = createHash("sha256").update(await fs.readFile(location)).digest("hex");
    const messages = await readLocalAccountMail({ stateDirectory: directory, email: "OWNER@EXAMPLE.TEST" });
    assert.equal(messages.length, 20);
    assert(messages.every((message) => message.url === link && message.expires_at > Date.now()));
    assert.deepEqual(await readLocalAccountMail({ stateDirectory: directory, email: "other@example.test" }), []);
    await assert.rejects(readLocalAccountMail({ stateDirectory: directory, email: "invalid" }));
    assert.equal(createHash("sha256").update(await fs.readFile(location)).digest("hex"), before, "Reading account mail must not modify the database");

    const environment = { DB: database };
    let user = null;
    let forwarded;
    let revokeToken;
    let revokeOthers = 0;
    const current = { id: "current-session", token: "private-current", userAgent: "Current browser", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10000).toISOString() };
    const other = { ...current, id: "other-session", token: "private-other", userAgent: "Other browser" };
    const auth = {
      async handler(request) {
        forwarded = { url: request.url, headers: request.headers, body: request.method === "POST" ? await request.json() : undefined };
        return Response.json({ token: "private-bearer", session: { id: current.id, token: current.token }, user }, { headers: { "Set-Cookie": "session=private-cookie; HttpOnly" } });
      },
      api: {
        async getSession() { return user ? { user, session: current } : null; },
        async listSessions() { return [current, other]; },
        async revokeSession({ body }) { revokeToken = body.token; },
        async revokeOtherSessions() { revokeOthers++; },
      },
    };
    Module._load = function (request, parent, ...rest) {
      if (request === "cloudflare:workers") return { env: environment };
      if (request === "./auth" || request.endsWith("/lib/auth"))
        return { getSessionUser: async () => user, getAuth: async () => auth };
      return originalLoad.call(this, request, parent, ...rest);
    };
    const access = require("./compiled/app/lib/access-store");
    const authRoute = require("./compiled/app/api/auth/[...all]/route");
    const sessionsRoute = require("./compiled/app/api/account/sessions/route");
    const request = (endpoint, body, headers = {}, origin = localOrigin) => new Request(`${origin}${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
    assert.equal((await access.resolveWorkspace(request("/api/state"))).id, "main");
    Object.assign(environment, onlineConfiguration);
    await assert.rejects(access.resolveWorkspace(request("/api/state?workspace=main", undefined, {}, onlineOrigin)), status(401));
    const account = await access.getAccountContext(request("/api/account", undefined, {}, onlineOrigin));
    assert.deepEqual(account.workspaces, []);
    assert.equal(JSON.stringify(account).includes("private-token"), false);
    assert.equal((await authRoute.POST(request("/api/auth/sign-up/email", { username: "foreign", email: "foreign@example.test" }, {}, onlineOrigin))).status, 403);
    for (const key of Object.keys(onlineConfiguration)) delete environment[key];

    for (const endpoint of ["admin-delete-user", "account-mail", "outbox"])
      for (const method of ["GET", "POST"])
        assert.equal((await authRoute[method](request(`/api/auth/${endpoint}`, method === "POST" ? {} : undefined))).status, 404);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", "{"))).status, 400);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", []))).status, 400);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", {}, { "Content-Type": "text/plain" }))).status, 415);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", {}, { Origin: "https://evil.test" }))).status, 403);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", { padding: "x".repeat(10000) }))).status, 413);
    assert.equal((await authRoute.POST(request("/api/auth/sign-in/username", {}, { "x-account-id": "another-user" }))).status, 409);
    assert.equal((await authRoute.POST(request("/api/auth/request-password-reset", { email: "owner@example.test", redirectTo: "https://evil.test" }))).status, 400);
    assert.equal((await authRoute.GET(request("/api/auth/verify-email?token=secret&callbackURL=https://evil.test"))).status, 400);
    const signedUp = await authRoute.POST(request("/api/auth/sign-up/email", { username: "owner", email: "owner@example.test", name: "Spoofed", displayUsername: "Spoofed" }));
    assert.equal(signedUp.status, 200);
    assert.equal(forwarded.body.name, "owner");
    assert.equal(forwarded.body.displayUsername, undefined);
    assert.equal(forwarded.body.callbackURL, `${localOrigin}/?account=verified`);
    assert.equal(signedUp.headers.get("cache-control"), "private, no-store");
    assert.match(signedUp.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(JSON.stringify(await signedUp.json()).includes("private-"), false, "Bearer credentials must not escape through auth JSON");
    const reset = await authRoute.POST(request("/api/auth/request-password-reset", { email: "owner@example.test" }));
    assert.equal(reset.status, 200);
    assert.equal(forwarded.body.redirectTo, `${localOrigin}/?account=reset`);
    await authRoute.POST(request("/api/auth/sign-in/username", { username: "owner", callbackURL: "https://evil.test" }));
    assert.equal(forwarded.body.callbackURL, undefined);
    const rawSession = await authRoute.GET(request("/api/auth/get-session"));
    assert.equal(JSON.stringify(await rawSession.json()).includes("private-"), false);
    const normalHandler = auth.handler;
    auth.handler = async () => new Response(null, {
      status: 302,
      headers: { "Content-Type": "application/json", Location: `${localOrigin}/?account=verified`, "Set-Cookie": "session=redirect-cookie; HttpOnly" },
    });
    const redirect = await authRoute.GET(request(`/api/auth/verify-email?token=fixture&callbackURL=${encodeURIComponent(`${localOrigin}/?account=verified`)}`));
    assert.equal(redirect.status, 302, "Empty JSON-labelled verification redirects must not be parsed as JSON");
    assert.equal(redirect.headers.get("location"), `${localOrigin}/?account=verified`);
    assert.match(redirect.headers.get("set-cookie"), /redirect-cookie/);
    assert.equal(await redirect.text(), "");
    auth.handler = async () => new Response(null, { status: 204, headers: { "Content-Type": "application/json" } });
    const noContent = await authRoute.GET(request("/api/auth/get-session"));
    assert.equal(noContent.status, 204);
    assert.equal(await noContent.text(), "");
    auth.handler = normalHandler;

    assert.equal((await sessionsRoute.GET(request("/api/account/sessions"))).status, 401);
    user = { id: "owner-id", username: "owner", email: "owner@example.test" };
    assert.equal((await sessionsRoute.GET(request("/api/account/sessions"))).status, 409);
    const identity = { "x-account-id": user.id };
    const listed = await sessionsRoute.GET(request("/api/account/sessions", undefined, identity));
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.equal(listedBody.sessions.length, 2);
    assert.equal(listedBody.sessions[0].current, true);
    assert.equal(JSON.stringify(listedBody).includes("private-"), false);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke", sessionId: "foreign-session" }, identity))).status, 404);
    assert.equal(revokeToken, undefined);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke", sessionId: current.id }, identity))).status, 400);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke", sessionId: other.id }, { "x-account-id": "foreign-id" }))).status, 409);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke", sessionId: other.id }, identity))).status, 200);
    assert.equal(revokeToken, other.token, "Only the server resolves a session ID to a bearer token");
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke-others" }, identity))).status, 200);
    assert.equal(revokeOthers, 1);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { action: "revoke-others" }, { ...identity, Origin: "https://evil.test" }))).status, 403);
    assert.equal((await sessionsRoute.POST(request("/api/account/sessions", { padding: "x".repeat(2048) }, identity))).status, 413);
    Module._load = originalLoad;
    await nativeAuthChecks(root, online);
    console.log("Account access, recovery, outbox, auth guards and session regressions passed.");
  } finally {
    Module._load = originalLoad;
    sql.close();
    await fs.unlink(location);
    await fs.rmdir(directory);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
