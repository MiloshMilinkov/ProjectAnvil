import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
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
