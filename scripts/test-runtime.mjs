import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isBuildCurrent } from "./build-fingerprint.mjs";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runRoot = path.join(projectRoot, "work", "qa");

export function installTestCancellationHandlers(target = process) {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new DOMException("Test run cancelled.", "AbortError"));
  target.once("SIGINT", cancel);
  target.once("SIGTERM", cancel);
  return {
    signal: controller.signal,
    dispose() {
      target.removeListener("SIGINT", cancel);
      target.removeListener("SIGTERM", cancel);
    },
  };
}

export async function ensureTestBuild({ signal } = {}) {
  signal?.throwIfAborted();
  if (await isBuildCurrent(projectRoot)) return;
  signal?.throwIfAborted();
  console.log("Preparing the current local application build for testing…");
  const status = await runNode("scripts/build-app.mjs", [], {
    cwd: projectRoot,
    signal,
  });
  signal?.throwIfAborted();
  if (status !== 0)
    throw new Error("Build failed; no test server was started.");
}

const exited = (child) => child.exitCode !== null || child.signalCode !== null;
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForOwnedExit(child, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!exited(child) && Date.now() < deadline) await delay(25);
  if (!exited(child))
    throw new Error(
      "The owned test process did not stop. Cleanup can be retried.",
    );
}

/** Stop only a process tree created by this runner; never select by port or name. */
export function ownedProcessStopper(
  child,
  { platform = process.platform, killTree = spawnSync } = {},
) {
  let completed = false,
    stopping;
  return async function stop() {
    if (completed) return;
    if (stopping) return stopping;
    stopping = (async () => {
      if (child.pid && !exited(child)) {
        if (platform === "win32") {
          const result = killTree(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            {
              stdio: "ignore",
              windowsHide: true,
            },
          );
          if ((result.error || result.status !== 0) && !exited(child))
            throw new Error(
              "The owned test process tree could not be stopped. Cleanup can be retried.",
            );
        } else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          try {
            await waitForOwnedExit(child, 3000);
          } catch {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
          }
        }
        await waitForOwnedExit(child);
      }
      completed = true;
    })();
    try {
      await stopping;
    } finally {
      stopping = undefined;
    }
  };
}

export async function runNode(script, args = [], options = {}) {
  const { signal, ...spawnOptions } = options;
  if (signal?.aborted) return 130;
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    windowsHide: true,
    ...spawnOptions,
    // POSIX descendants inherit this private process group for bounded cleanup.
    detached: process.platform !== "win32",
  });
  const stop = ownedProcessStopper(child);
  let abort;
  const cancellation = new Promise((resolve, reject) => {
    abort = () => {
      void stop().then(() => resolve(130), reject);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (signal?.aborted) abort();
  try {
    const code = await Promise.race([completion, cancellation]);
    if (signal?.aborted) await stop();
    return signal?.aborted ? 130 : code;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function availablePort(requested = 0) {
  if (
    requested &&
    (!Number.isInteger(requested) ||
      requested < 1024 ||
      requested > 65535 ||
      [5173, 5174].includes(requested))
  )
    throw new Error(
      "Choose a dedicated test port; everyday application ports are forbidden.",
    );
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requested, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if ([5173, 5174].includes(port)) return availablePort();
  return port;
}

/** A benchmark may write only to a run explicitly created by this harness. */
export async function validateDisposableTarget(
  baseURL,
  manifestPath,
  { fetcher = fetch, signal } = {},
) {
  signal?.throwIfAborted();
  const url = new URL(baseURL);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    ["5173", "5174"].includes(url.port) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Tests require the harness's dedicated loopback origin.");
  if (!manifestPath)
    throw new Error("Start tests through the disposable test runner.");
  const manifestFile = await fs.realpath(manifestPath);
  const relative = path.relative(await fs.realpath(runRoot), manifestFile);
  if (
    path.isAbsolute(relative) ||
    relative.startsWith("..") ||
    path.basename(manifestFile) !== ".projectanvil-test-run.json"
  )
    throw new Error(
      "The disposable test marker is outside the owned test directory.",
    );
  const marker = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const directory = path.dirname(manifestFile);
  if (
    marker.format !== 1 ||
    marker.kind !== "disposable-local-test" ||
    marker.baseURL !== url.origin ||
    !/^[a-f0-9-]{36}$/.test(marker.runId) ||
    marker.stateDirectory !== path.join(directory, "state") ||
    (await fs.realpath(directory)) !== directory ||
    (await fs.realpath(marker.stateDirectory)) !== marker.stateDirectory
  )
    throw new Error("The disposable test marker does not match this server.");
  const response = await fetcher(`${url.origin}/__projectanvil_test_health`, {
    cache: "no-store",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
      : AbortSignal.timeout(2000),
  });
  if (!response.ok || (await response.json()).runId !== marker.runId)
    throw new Error(
      "The server does not own this disposable test run's health nonce.",
    );
  return marker;
}

export function assertLocalTestBindings(configuration) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.remote === true)
      throw new Error("Disposable tests forbid remote bindings.");
    for (const child of Object.values(value)) visit(child);
  };
  visit(configuration);
}

/** Starts a fresh database/file bucket without reading the user's state or secret. */
export async function startDisposableServer({
  kind = "browser",
  port: requestedPort,
  signal,
} = {}) {
  signal?.throwIfAborted();
  if (!/^[a-z][a-z-]{0,30}$/.test(kind))
    throw new Error("Invalid test run name.");
  const port = await availablePort(requestedPort);
  signal?.throwIfAborted();
  const baseURL = `http://127.0.0.1:${port}`;
  const runId = randomUUID();
  await fs.mkdir(runRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(runRoot, `${kind}-`));
  const stateDirectory = path.join(directory, "state");
  await fs.mkdir(stateDirectory);
  const manifestPath = path.join(directory, ".projectanvil-test-run.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        format: 1,
        kind: "disposable-local-test",
        runId,
        baseURL,
        stateDirectory,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(directory, ".dev.vars"),
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nBETTER_AUTH_URL=${baseURL}\n`,
    { mode: 0o600 },
  );
  const builtRoot = path.join(projectRoot, "dist");
  const configuration = JSON.parse(
    await fs.readFile(path.join(builtRoot, "server", "wrangler.json"), "utf8"),
  );
  assertLocalTestBindings(configuration);
  const serverDirectory = path.join(directory, "server");
  await fs.cp(path.join(builtRoot, "server"), serverDirectory, {
    recursive: true,
    errorOnExist: true,
  });
  const workerPath = path.join(serverDirectory, "test-worker.mjs");
  await fs.writeFile(
    workerPath,
    `import application from "./index.js";\nexport default {\n  fetch(request, env, context) {\n    if (new URL(request.url).pathname === "/__projectanvil_test_health")\n      return Response.json({ runId: ${JSON.stringify(runId)} }, { headers: { "Cache-Control": "no-store" } });\n    return application.fetch(request, env, context);\n  },\n};\n`,
  );
  configuration.name = `projectanvil-test-${runId.slice(0, 8)}`;
  configuration.main = workerPath;
  configuration.vars = {};
  delete configuration.build;
  configuration.assets = {
    ...configuration.assets,
    directory: path.join(builtRoot, "client"),
  };
  configuration.observability = { enabled: false };
  const configPath = path.join(directory, "wrangler.json");
  await fs.writeFile(configPath, JSON.stringify(configuration, null, 2));
  signal?.throwIfAborted();
  const logFile = await fs.open(path.join(directory, "server.log"), "w");
  const environment = {
    ...process.env,
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_CF_FETCH_ENABLED: "false",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"),
    WRANGLER_REGISTRY_PATH: path.join(directory, "registry"),
    MINIFLARE_REGISTRY_PATH: path.join(directory, "registry"),
  };
  for (const key of [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
  ])
    delete environment[key];
  const child = spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
      "dev",
      "--config",
      configPath,
      "--env-file",
      path.join(directory, ".dev.vars"),
      "--local",
      "--persist-to",
      stateDirectory,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
    ],
    {
      cwd: directory,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", logFile.fd, logFile.fd],
      env: environment,
    },
  );
  let failure;
  child.once("error", (error) => {
    failure = error;
  });
  const terminate = ownedProcessStopper(child);
  let stopped = false,
    stopping;
  async function stop() {
    if (stopped) return;
    if (stopping) return stopping;
    stopping = (async () => {
      await terminate();
      await logFile.close();
      stopped = true;
      signal?.removeEventListener("abort", abort);
    })();
    try {
      await stopping;
    } finally {
      stopping = undefined;
    }
  }
  const abort = () => {
    void stop().catch((error) => {
      failure = error;
    });
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (failure || child.exitCode !== null)
        throw (
          failure || new Error("The disposable server stopped during startup.")
        );
      try {
        const response = await fetch(`${baseURL}/api/account`, {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
            : AbortSignal.timeout(2000),
        });
        if (response.ok) {
          await validateDisposableTarget(baseURL, manifestPath, { signal });
          return { baseURL, directory, manifestPath, stop };
        }
      } catch {
        /* Wait only for the owned new server, never reuse another app. */
      }
      signal?.throwIfAborted();
      await delay(250);
    }
    throw new Error(
      "The disposable local server did not become ready. See its private server.log.",
    );
  } catch (cause) {
    await stop();
    throw cause;
  }
}

export function disposableEnvironment(server) {
  return {
    ...process.env,
    PROJECTANVIL_TEST_DISPOSABLE: "1",
    PROJECTANVIL_TEST_BASE_URL: server.baseURL,
    PLAYWRIGHT_TEST_BASE_URL: server.baseURL,
    PROJECTANVIL_TEST_MANIFEST: server.manifestPath,
  };
}
