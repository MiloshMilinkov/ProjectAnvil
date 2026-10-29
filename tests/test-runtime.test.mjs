import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
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
} from "../scripts/test-runtime.mjs";

const securitySource = await fs.readFile(
  new URL("../app/lib/http-security.ts", import.meta.url),
  "utf8",
);
const { secureResponse } = await import(
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
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
  assert.match(response.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self'/);
  assert.equal(response.headers.get("etag"), '"workspace-4"');
  assert.equal(response.headers.get("set-cookie"), "session=test; HttpOnly; SameSite=Lax");
  assert.equal(response.body, original.body, "The wrapper must not buffer the stream.");
  assert.equal(await response.text(), "streamed content");
});

test("local responses retain cache rules and stricter attachment sandbox policies", async () => {
  const local = new Request("http://127.0.0.1:5173/offline.html");
  const response = secureResponse(local, new Response("public shell", {
    headers: { "Cache-Control": "public, max-age=3600" },
  }));
  assert.equal(response.headers.get("strict-transport-security"), null);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(response.headers.get("cross-origin-resource-policy"), null);
  const policy = "sandbox; default-src 'none'";
  const media = secureResponse(
    new Request("https://projectanvil.test/api/media/attachment"),
    new Response("attachment", { headers: { "Content-Security-Policy": policy } }),
  );
  assert.equal(media.headers.get("content-security-policy"), policy);
  assert.equal(await media.text(), "attachment");
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
