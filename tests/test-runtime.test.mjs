import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  captureBrowserFailureLog,
  sanitizeBrowserServerLog,
} from "../scripts/run-browser-tests.mjs";
import {
  projectRoot,
  validateDisposableTarget,
  assertLocalTestBindings,
  installTestCancellationHandlers,
  ensureTestBuild,
  startDisposableServer,
  ownedProcessStopper,
  runNode,
  killOwnedProcessTree,
  DEADLINE_EXIT_CODE,
} from "../scripts/test-runtime.mjs";
import {
  readWorkerLease,
  releaseWorkerLease,
  writeWorkerLease,
} from "../scripts/test-worker-lease.mjs";
import { browserRunDeadline } from "../scripts/run-browser-tests.mjs";

test("a disposable server guardian stops its child when the worker IPC channel disappears", {
  timeout: 15_000,
}, async () => {
  const guardian = spawn(process.execPath, [
    fileURLToPath(new URL("../scripts/test-server-guardian.mjs", import.meta.url)),
    "--eval",
    "setInterval(() => {}, 1000)",
  ], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const stop = ownedProcessStopper(guardian);
  let diagnostic = "";
  guardian.stderr.on("data", (chunk) => { diagnostic += chunk; });
  const exited = once(guardian, "exit");
  try {
    const [message] = await once(guardian, "message", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(message.type, "child-started");
    assert.equal(typeof message.pid, "number");
    process.kill(message.pid, 0);
    guardian.disconnect();
    const [code] = await exited;
    assert.equal(code, 0, diagnostic);
    assert.throws(() => process.kill(message.pid, 0), { code: "ESRCH" });
  } finally {
    if (guardian.connected) guardian.disconnect();
    await stop();
  }
});

const securitySource = await fs.readFile(
  new URL("../app/lib/http-security.ts", import.meta.url),
  "utf8",
);
const { secureResponse, createSecurityContext } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(securitySource, {
        compilerOptions: { module: ts.ModuleKind.ESNext },
      }).outputText,
    ).toString("base64")
);

test("security headers preserve private responses, cookies and streamed bodies", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("streamed content"));
      controller.close();
    },
  });
  const original = new Response(stream, {
    status: 201,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session=test; HttpOnly; SameSite=Lax",
      ETag: '"workspace-4"',
      "Cache-Control": "public, max-age=600",
    },
  });
  const response = secureResponse(
    new Request("https://projectanvil.test/api/state"),
    original,
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  assert.match(
    response.headers.get("permissions-policy"),
    /microphone=\(self\)/,
  );
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'self'/,
  );
  assert.equal(response.headers.get("etag"), '"workspace-4"');
  assert.equal(
    response.headers.get("set-cookie"),
    "session=test; HttpOnly; SameSite=Lax",
  );
  assert.equal(
    response.body,
    original.body,
    "The wrapper must not buffer the stream.",
  );
  assert.equal(await response.text(), "streamed content");
});

test("local responses retain cache rules and stricter attachment sandbox policies", async () => {
  const local = new Request("http://127.0.0.1:5173/offline.html");
  const response = secureResponse(
    local,
    new Response("public shell", {
      headers: { "Cache-Control": "public, max-age=3600" },
    }),
  );
  assert.equal(response.headers.get("strict-transport-security"), null);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(response.headers.get("cross-origin-resource-policy"), null);
  const policy = "sandbox; default-src 'none'";
  const media = secureResponse(
    new Request("https://projectanvil.test/api/media/attachment"),
    new Response("attachment", {
      headers: { "Content-Security-Policy": policy },
    }),
  );
  assert.equal(media.headers.get("content-security-policy"), policy);
  assert.equal(await media.text(), "attachment");
});

test("document policies use fresh trusted nonces and preserve the forwarded request", async () => {
  const original = new Request("https://projectanvil.test/?note=private", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Cookie: "session=private",
      "X-Workspace-Id": "personal-fixture",
      "x-csp-nonce": "caller-selected",
      "x-nonce": "another-caller-value",
      "Content-Security-Policy": "script-src 'unsafe-inline' 'unsafe-eval'",
      "Content-Security-Policy-Report-Only": "default-src *",
    },
    body: "keep the streamed request body",
  });
  const context = createSecurityContext(original);
  const next = createSecurityContext(new Request(original.url));
  assert.match(context.nonce, /^[a-f0-9]{32}$/);
  assert.notEqual(context.nonce, next.nonce);
  assert.notEqual(context.nonce, "caller-selected");
  assert.equal(original.headers.get("x-csp-nonce"), "caller-selected");
  assert.equal(context.request.headers.get("x-csp-nonce"), context.nonce);
  assert.equal(context.request.headers.get("x-nonce"), null);
  assert.equal(
    context.request.headers.get("content-security-policy"),
    context.policy,
  );
  assert.equal(
    context.request.headers.get("content-security-policy-report-only"),
    null,
  );
  assert.equal(context.request.headers.get("cookie"), "session=private");
  assert.equal(
    context.request.headers.get("x-workspace-id"),
    "personal-fixture",
  );
  assert.equal(context.request.method, "POST");
  assert.equal(await context.request.text(), "keep the streamed request body");
  const directives = new Map(
    context.policy.split(";").map((entry) => {
      const [name, ...sources] = entry.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  assert.deepEqual(directives.get("script-src"), [
    `'nonce-${context.nonce}'`,
    "'strict-dynamic'",
  ]);
  for (const name of [
    "default-src",
    "script-src-attr",
    "object-src",
    "base-uri",
  ])
    assert.deepEqual(directives.get(name), ["'none'"]);
  assert.deepEqual(directives.get("worker-src"), ["'self'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert(
    !directives
      .get("script-src")
      .some((source) => /unsafe-inline|unsafe-eval|^https?:|\*/.test(source)),
  );
});

test("HTML uses the renderer policy without replayable HTTP cache validators", async () => {
  const original = new Request("https://projectanvil.test/");
  const context = createSecurityContext(original);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `<script nonce="${context.nonce}">bootstrap()</script>`,
        ),
      );
      controller.close();
    },
  });
  const upstream = new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ETag: '"shared-shell"',
      "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT",
      "Set-Cookie": "session=retained; HttpOnly; SameSite=Lax",
    },
  });
  const secured = secureResponse(original, upstream, context.policy);
  assert.equal(
    secured.body,
    upstream.body,
    "CSP must not buffer the React stream.",
  );
  assert.equal(secured.headers.get("Content-Security-Policy"), context.policy);
  assert.equal(secured.headers.get("Cache-Control"), "private, no-store");
  assert.equal(secured.headers.get("ETag"), null);
  assert.equal(secured.headers.get("Last-Modified"), null);
  assert.match(secured.headers.get("Set-Cookie"), /session=retained/);
  assert.match(await secured.text(), new RegExp(`nonce="${context.nonce}"`));
});

test("stress targets require an owned marker and cannot select an everyday server", async () => {
  const parent = path.join(projectRoot, "work", "qa");
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "guard-test-"));
  const markerPath = path.join(directory, ".projectanvil-test-run.json");
  const baseURL = "http://127.0.0.1:5199";
  const marker = {
    format: 1,
    kind: "disposable-local-test",
    runId: randomUUID(),
    baseURL,
    stateDirectory: path.join(directory, "state"),
  };
  await fs.mkdir(marker.stateDirectory);
  const health = async (url, options) => {
    assert.equal(url, `${baseURL}/__projectanvil_test_health`);
    assert.equal(options.redirect, "error");
    return Response.json({ runId: marker.runId });
  };
  try {
    await fs.writeFile(markerPath, JSON.stringify(marker));
    assert.equal(
      (await validateDisposableTarget(baseURL, markerPath, { fetcher: health }))
        .runId,
      marker.runId,
    );
    for (const target of [
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "https://example.test",
      "http://localhost:5199",
      "http://127.0.0.1:5199/api/state",
      "http://127.0.0.1:5199/?override=1",
      "http://other@127.0.0.1:5199",
    ])
      await assert.rejects(validateDisposableTarget(target, markerPath));
    await assert.rejects(validateDisposableTarget(baseURL));
    await assert.rejects(
      validateDisposableTarget(baseURL, markerPath, {
        fetcher: async () => Response.json({ runId: randomUUID() }),
      }),
      /health nonce/,
      "An unrelated server on the same port must not receive test mutations",
    );
    await assert.rejects(
      validateDisposableTarget(baseURL, markerPath, {
        fetcher: async () => new Response("Unavailable", { status: 503 }),
      }),
      /health nonce/,
    );
    await assert.rejects(
      validateDisposableTarget("http://127.0.0.1:5200", markerPath),
    );
    await fs.writeFile(
      markerPath,
      JSON.stringify({
        ...marker,
        stateDirectory: path.join(projectRoot, ".wrangler", "state"),
      }),
    );
    await assert.rejects(validateDisposableTarget(baseURL, markerPath));
    const outside = path.join(
      projectRoot,
      "work",
      ".projectanvil-test-run.json",
    );
    await fs.writeFile(outside, JSON.stringify(marker), { flag: "wx" });
    try {
      await assert.rejects(validateDisposableTarget(baseURL, outside));
    } finally {
      await fs.unlink(outside);
    }
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(parent));
    assert.ok(path.basename(resolved).startsWith("guard-test-"));
    // Keep these small ignored fixtures for diagnostics; never purge test copies.
  }
});

test("remote bindings are rejected at every nested configuration level", () => {
  assertLocalTestBindings({
    d1_databases: [{ binding: "DB", remote: false }],
    r2_buckets: [{ binding: "BUCKET" }],
  });
  for (const configuration of [
    { d1_databases: [{ binding: "DB", remote: true }] },
    { r2_buckets: [{ binding: "BUCKET", remote: true }] },
    { env: { staging: { kv_namespaces: [{ remote: true }] } } },
  ])
    assert.throws(
      () => assertLocalTestBindings(configuration),
      /remote bindings/,
    );
});

test("cancellation is installed before builds/startup and prevents child creation", async () => {
  const events = new EventEmitter();
  const cancellation = installTestCancellationHandlers(events);
  events.emit("SIGINT");
  assert(cancellation.signal.aborted);
  await assert.rejects(ensureTestBuild({ signal: cancellation.signal }), {
    name: "AbortError",
  });
  await assert.rejects(startDisposableServer({ signal: cancellation.signal }), {
    name: "AbortError",
  });
  assert.equal(
    await runNode("must-never-be-started.mjs", [], {
      signal: cancellation.signal,
    }),
    130,
  );
  cancellation.dispose();
  assert.equal(events.listenerCount("SIGINT"), 0);
  assert.equal(events.listenerCount("SIGTERM"), 0);
});

test("a command past its hard deadline is stopped and reported as 124", {
  timeout: 15_000,
}, async () => {
  let reported = 0;
  const started = Date.now();
  const status = await runNode("--eval", ["setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    deadline: 300,
    onDeadline: () => reported++,
  });
  assert.equal(status, DEADLINE_EXIT_CODE);
  assert.equal(reported, 1);
  assert(Date.now() - started < 10_000, "The deadline must stop the command.");
  // An outer cancellation keeps its own status rather than a deadline.
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await runNode("must-never-be-started.mjs", [], {
      signal: controller.signal,
      deadline: 60_000,
    }),
    130,
  );
});

test("browser run deadlines default to 45 minutes and reject invalid values", () => {
  assert.equal(browserRunDeadline({}), 45 * 60_000);
  assert.equal(
    browserRunDeadline({ PROJECTANVIL_BROWSER_DEADLINE_MINUTES: "35" }),
    35 * 60_000,
  );
  assert.throws(
    () => browserRunDeadline({ PROJECTANVIL_BROWSER_DEADLINE_MINUTES: "-1" }),
    /positive number/,
  );
});

test("the stall watchdog stops only a still-owned worker tree", () => {
  const listing = { stdout: ["  10   1", "  20  10", "  30  20", "  40   1", ""].join("\n") };
  const killed = [];
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    killed.push([pid, signal]);
    return true;
  };
  try {
    const run = () => listing;
    assert.equal(
      killOwnedProcessTree(10, { expectedParent: 1, platform: "linux", run }),
      true,
    );
    assert.deepEqual(killed, [[10, "SIGKILL"], [20, "SIGKILL"], [30, "SIGKILL"]]);
    killed.length = 0;
    // A reused ID under another parent is never stopped.
    assert.equal(
      killOwnedProcessTree(20, { expectedParent: 1, platform: "linux", run }),
      false,
    );
    const windows = [];
    const windowsRun = (command) => {
      windows.push(command);
      return command === "powershell.exe" ? { stdout: "77\r\n" } : { status: 0 };
    };
    assert.equal(
      killOwnedProcessTree(10, {
        expectedParent: 1,
        platform: "win32",
        run: windowsRun,
      }),
      false,
    );
    assert.deepEqual(windows, ["powershell.exe"]);
    assert.equal(
      killOwnedProcessTree(10, {
        expectedParent: 77,
        platform: "win32",
        run: windowsRun,
      }),
      true,
    );
    assert.deepEqual(windows, ["powershell.exe", "powershell.exe", "taskkill"]);
  } finally {
    process.kill = originalKill;
  }
  assert.equal(killed.length, 0);
  assert.throws(() => killOwnedProcessTree(process.pid), /unowned/);
  assert.throws(() => killOwnedProcessTree(0), /unowned/);
});

test("worker leases are honoured only for the same run and runner", async (t) => {
  const parent = path.join(projectRoot, "work", "qa");
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "lease-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const previous = process.env.PROJECTANVIL_TEST_MANIFEST;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECTANVIL_TEST_MANIFEST;
    else process.env.PROJECTANVIL_TEST_MANIFEST = previous;
  });
  process.env.PROJECTANVIL_TEST_MANIFEST = "run-a";
  const release = writeWorkerLease(3, { directory, pid: 4321, ppid: 99 });
  assert.equal(readWorkerLease(3, { directory, runnerPid: 99 }), 4321);
  assert.equal(readWorkerLease(3, { directory, runnerPid: 100 }), undefined);
  assert.equal(readWorkerLease(4, { directory, runnerPid: 99 }), undefined);
  process.env.PROJECTANVIL_TEST_MANIFEST = "run-b";
  assert.equal(readWorkerLease(3, { directory, runnerPid: 99 }), undefined);
  process.env.PROJECTANVIL_TEST_MANIFEST = "run-a";
  release();
  assert.equal(readWorkerLease(3, { directory, runnerPid: 99 }), undefined);
  writeWorkerLease(5, { directory, pid: 99, ppid: 99 });
  assert.equal(readWorkerLease(5, { directory, runnerPid: 99 }), undefined);
  releaseWorkerLease(5, { directory });
  assert.throws(() => releaseWorkerLease(-1, { directory }), /Invalid worker/);
});

test("failed tree termination stays retryable; successful cleanup is idempotent", async () => {
  const child = { pid: 123456, exitCode: null, signalCode: null };
  let attempts = 0;
  const stop = ownedProcessStopper(child, {
    platform: "win32",
    killTree: (_command, args) => {
      assert.deepEqual(args, ["/PID", String(child.pid), "/T", "/F"]);
      attempts++;
      if (attempts === 1) return { status: 1 };
      child.exitCode = 0;
      return { status: 0 };
    },
  });
  await assert.rejects(stop(), /could not be stopped/);
  await stop();
  await stop();
  assert.equal(attempts, 2);
});

test(
  "aborting a live Node command stops its owned descendant process",
  { timeout: 15000 },
  async () => {
    const parent = path.join(projectRoot, "work", "qa");
    await fs.mkdir(parent, { recursive: true });
    const directory = await fs.mkdtemp(path.join(parent, "cancel-test-"));
    const script = path.join(directory, "owned-child.mjs");
    const heartbeat = path.join(directory, "heartbeat.txt");
    const ready = path.join(directory, "ready.json");
    const descendant = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),25);`;
    await fs.writeFile(
      script,
      `import{spawn}from'node:child_process';import fs from'node:fs';const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    const running = runNode(script, [], {
      signal: controller.signal,
      stdio: "ignore",
    });
    let pids;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          pids = JSON.parse(await fs.readFile(ready, "utf8"));
          if ((await fs.stat(heartbeat)).size > 0) break;
        } catch {
          /* Wait for the owned fixture. */
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert(pids?.child, "The disposable descendant should have started.");
      controller.abort();
      assert.equal(await running, 130);
      await new Promise((resolve) => setTimeout(resolve, 75));
      const stopped = await fs.readFile(heartbeat, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await fs.readFile(heartbeat, "utf8"),
        stopped,
        "The descendant must stop writing after cancellation.",
      );
    } finally {
      controller.abort();
      await running.catch(() => {});
      // Fallback cleanup targets only PIDs reported by this test's own fixture.
      for (const pid of [pids?.child, pids?.parent].filter(Boolean)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
    }
  },
);

test("browser log excerpts omit credentials, account links, and URL queries", () => {
  const secret = "fixture-private-value";
  const input = [
    "[wrangler:info] GET /api/state 200 OK (12ms)",
    `Configuration value: ${secret}`,
    "Authorization: Bearer private-value",
    "Set-Cookie: session=private-value",
    "Password: Fixture-private-password",
    "Open http://127.0.0.1:5555/api/auth/verify-email?token=private-link",
    "Reset password link: http://127.0.0.1:5555/api/auth/reset-password/private-link",
    "Request http://127.0.0.1:5555/api/state?private=value#fragment",
    "GET /api/state?private=value 503 Unavailable",
    "Identifier: abcdefghijklmnopqrstuvwxyz123456",
    "TypeError: failed to load application module",
  ].join("\n");
  const result = sanitizeBrowserServerLog(input, [secret]);
  for (const privateValue of [
    secret,
    "private-value",
    "private-password",
    "private-link",
    "private=value",
    "fragment",
    "abcdefghijklmnopqrstuvwxyz123456",
  ])
    assert.equal(result.includes(privateValue), false, privateValue);
  assert.match(result, /GET \/api\/state 200 OK/);
  assert.match(result, /TypeError: failed to load application module/);
  assert.match(result, /Sensitive log line omitted/);
});

test("browser log excerpts bound line count and UTF-8 bytes", () => {
  const input = Array.from(
    { length: 900 },
    (_, index) => `${index}: ${"界".repeat(100)}`,
  ).join("\n");
  const result = sanitizeBrowserServerLog(input);
  assert.ok(Buffer.byteLength(result) <= 64 * 1024);
  assert.ok(result.split("\n").length <= 500);
  assert.match(result, /899:/);
  assert.doesNotMatch(result, /^0:/m);
});

async function fixture(t) {
  const parent = path.join(projectRoot, "work", "qa");
  const reportParent = path.join(projectRoot, "outputs", "browser");
  await fs.mkdir(parent, { recursive: true });
  await fs.mkdir(reportParent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "browser-diagnostic-"));
  const reportDirectory = await fs.mkdtemp(
    path.join(reportParent, "diagnostic-test-"),
  );
  t.after(async () => {
    // Delete only the exact disposable children created above.
    assert.equal(path.dirname(directory), parent);
    assert.equal(path.dirname(reportDirectory), reportParent);
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(reportDirectory, { recursive: true, force: true });
  });
  const baseURL = "http://127.0.0.1:5555";
  const marker = {
    format: 1,
    kind: "disposable-local-test",
    runId: randomUUID(),
    baseURL,
    stateDirectory: path.join(directory, "state"),
  };
  await fs.writeFile(
    path.join(directory, ".projectanvil-test-run.json"),
    JSON.stringify(marker),
  );
  await fs.writeFile(
    path.join(directory, ".dev.vars"),
    `BETTER_AUTH_SECRET=private-fixture-key\nBETTER_AUTH_URL=${baseURL}\n`,
  );
  return { server: { directory, baseURL }, reportDirectory, marker };
}

test("failed browser capture reads only the bounded owned log tail", async (t) => {
  const { server, reportDirectory, marker } = await fixture(t);
  await fs.writeFile(
    path.join(server.directory, "server.log"),
    "old startup output\n".repeat(20_000) +
      `Configuration private-fixture-key ${marker.runId}\n` +
      "TypeError: failed to load application module\n",
  );
  await captureBrowserFailureLog(server, "firefox", { reportDirectory });
  const output = await fs.readFile(
    path.join(reportDirectory, "server.log"),
    "utf8",
  );
  assert.ok(Buffer.byteLength(output) <= 64 * 1024);
  assert.match(output, /TypeError: failed to load application module/);
  assert.equal(output.includes("private-fixture-key"), false);
  assert.equal(output.includes(marker.runId), false);
});

test("browser capture rejects unrelated targets and invalid run markers", async (t) => {
  const { server, reportDirectory, marker } = await fixture(t);
  await fs.writeFile(path.join(server.directory, "server.log"), "safe log");
  await assert.rejects(
    captureBrowserFailureLog({ ...server, directory: projectRoot }, "firefox", {
      reportDirectory,
    }),
    /owned disposable/,
  );
  await assert.rejects(
    captureBrowserFailureLog(server, "unknown", { reportDirectory }),
    /Unknown browser/,
  );
  await assert.rejects(
    captureBrowserFailureLog(server, "firefox", {
      reportDirectory: projectRoot,
    }),
    /inside outputs/,
  );
  await fs.writeFile(
    path.join(server.directory, ".projectanvil-test-run.json"),
    JSON.stringify({ ...marker, kind: "ordinary-local-app" }),
  );
  await assert.rejects(
    captureBrowserFailureLog(server, "firefox", { reportDirectory }),
    /marker does not match/,
  );
});
