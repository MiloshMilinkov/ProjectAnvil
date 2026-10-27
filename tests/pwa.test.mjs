import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generatePwaAssets } from "../scripts/generate-pwa-assets.mjs";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const workerSource = await fs.readFile(
  path.join(root, "public", "service-worker.js"),
  "utf8",
);
const origin = "http://127.0.0.1:5173";
const asset = new TextEncoder().encode(
  "export const application = 'ProjectAnvil';",
);
const resource = {
  url: "/_next/static/chunks/app-123.js",
  bytes: asset.byteLength,
  sha256: createHash("sha256").update(asset).digest("hex"),
};
const publicHtml =
  '<!doctype html><html><body data-projectanvil-shell="public">Opening your workspace…<script src="/_next/static/chunks/app-123.js"></script></body></html>';
const updatesSource = await fs.readFile(
  path.join(root, "app", "lib", "app-installation-updates.ts"),
  "utf8",
);
const { createAppUpdateObserver } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(updatesSource, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString("base64")
);

class ObservedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

test("offline-resumed registrations report asynchronous updates without duplicate listeners", async () => {
  const registration = new ObservedTarget();
  registration.active = { state: "activated" };
  registration.installing = null;
  registration.waiting = null;
  const states = [];
  const observer = createAppUpdateObserver((worker) =>
    states.push(worker.state),
  );
  observer.observe(registration);
  observer.observe(registration);
  assert.equal(registration.listenerCount("updatefound"), 1);
  const worker = new ObservedTarget();
  worker.state = "installing";
  await Promise.resolve();
  registration.installing = worker;
  registration.dispatchEvent(new Event("updatefound"));
  registration.dispatchEvent(new Event("updatefound"));
  assert.equal(worker.listenerCount("statechange"), 1);
  await Promise.resolve();
  worker.state = "installed";
  registration.installing = null;
  registration.waiting = worker;
  worker.dispatchEvent(new Event("statechange"));
  assert.deepEqual(states, ["installing", "installed"]);
  const replacement = new ObservedTarget();
  replacement.installing = null;
  replacement.waiting = worker;
  observer.observe(replacement);
  assert.equal(registration.listenerCount("updatefound"), 0);
  assert.equal(replacement.listenerCount("updatefound"), 1);
  assert.equal(worker.listenerCount("statechange"), 1);
  observer.disconnect();
  assert.equal(replacement.listenerCount("updatefound"), 0);
  assert.equal(worker.listenerCount("statechange"), 0);
  const count = states.length;
  worker.state = "activated";
  worker.dispatchEvent(new Event("statechange"));
  assert.equal(states.length, count);
});

test("a superseded waiting worker cannot overwrite the current update state", () => {
  const registration = new ObservedTarget();
  const earlier = new ObservedTarget();
  earlier.state = "installed";
  registration.installing = null;
  registration.waiting = earlier;
  const states = [];
  const observer = createAppUpdateObserver((worker) =>
    states.push(worker.state),
  );
  observer.observe(registration);
  const incoming = new ObservedTarget();
  incoming.state = "installing";
  registration.installing = incoming;
  registration.dispatchEvent(new Event("updatefound"));
  earlier.state = "redundant";
  earlier.dispatchEvent(new Event("statechange"));
  assert.deepEqual(states, ["installed", "installing"]);
  assert.equal(earlier.listenerCount("statechange"), 0);
  incoming.state = "installed";
  registration.waiting = incoming;
  registration.installing = null;
  incoming.dispatchEvent(new Event("statechange"));
  assert.deepEqual(states, ["installed", "installing", "installed"]);
  observer.disconnect();
});

function worker() {
  const handlers = new Map();
  const stores = new Map();
  const fetches = [];
  let network = true;
  let shell = publicHtml;
  let shellHeaders = { "Content-Type": "text/html; charset=utf-8" };
  let assetBody = asset;
  let windows = 1;
  let activated = 0;
  let claimed = 0;
  const key = (input) =>
    new URL(typeof input === "string" ? input : input.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(input) {
          return entries.get(key(input))?.clone();
        },
        async put(input, response) {
          entries.set(key(input), response.clone());
        },
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    Uint8Array,
    Set,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    caches,
    fetch: async (request) => {
      if (!network) throw new TypeError("Network unavailable");
      fetches.push(request);
      if (new URL(request.url).pathname === "/")
        return new Response(shell, { headers: shellHeaders });
      return new Response(assetBody, {
        headers: { "Content-Type": "text/javascript" },
      });
    },
    self: {
      location: { origin },
      addEventListener: (name, listener) => handlers.set(name, listener),
      clients: {
        claim: async () => {
          claimed++;
        },
        matchAll: async () =>
          Array.from({ length: windows }, (_, index) => ({
            id: String(index),
            url: origin + "/",
          })),
      },
      skipWaiting: async () => {
        activated++;
      },
    },
  });
  const source = workerSource
    .replace('/* PROJECTANVIL_BUILD */ "development"', '"fixture"')
    .replace("/* PROJECTANVIL_RESOURCES */ []", JSON.stringify([resource]));
  const api = vm.runInContext(
    source + "; ({ prepareShell, cacheReady, publicResource, CACHE_NAME });",
    context,
  );
  async function dispatch(name, extra = {}) {
    const work = [];
    let response;
    const event = {
      ...extra,
      waitUntil: (promise) => work.push(promise),
      respondWith: (promise) => {
        response = promise;
      },
    };
    handlers.get(name)(event);
    await Promise.all(work);
    return response ? await response : undefined;
  }
  async function message(type, source = origin + "/") {
    let reply;
    await dispatch("message", {
      data: { type },
      source: { url: source },
      ports: [
        {
          postMessage: (value) => {
            reply = value;
          },
        },
      ],
    });
    return reply;
  }
  return {
    api,
    caches,
    stores,
    fetches,
    dispatch,
    message,
    setNetwork: (value) => {
      network = value;
    },
    setShell: (value, headers = shellHeaders) => {
      shell = value;
      shellHeaders = headers;
    },
    setAsset: (value) => {
      assetBody = value;
    },
    setWindows: (count) => {
      windows = count;
    },
    counts: () => ({ activated, claimed }),
  };
}

test("installation caches only verified public files and an anonymous generic shell", async () => {
  const fixture = worker();
  await fixture.dispatch("install");
  assert.equal(await fixture.api.cacheReady(), true);
  assert.equal(
    fixture.counts().activated,
    0,
    "install must never skip the update waiting period",
  );
  assert(fixture.fetches.every((request) => request.credentials === "omit"));
  assert.deepEqual(
    fixture.fetches.map((request) => new URL(request.url).pathname).sort(),
    ["/", resource.url],
  );
  const keys = await (await fixture.caches.open(fixture.api.CACHE_NAME)).keys();
  assert.deepEqual(
    keys.map((request) => new URL(request.url).pathname).sort(),
    ["/", resource.url],
  );
});

test("API, upload, cross-origin, range, query and mutation requests never use the app cache", async () => {
  const fixture = worker();
  await fixture.dispatch("install");
  for (const request of [
    new Request(origin + "/api/account"),
    new Request(origin + "/api/state"),
    new Request(origin + "/api/media/private-file"),
    new Request(origin + resource.url + "?token=private"),
    new Request("https://example.test" + resource.url),
    new Request(origin + resource.url, { method: "POST", body: "private" }),
    new Request(origin + resource.url, { headers: { Range: "bytes=0-4" } }),
    new Request(origin + "/?__rsc=private"),
  ])
    assert.equal(await fixture.dispatch("fetch", { request }), undefined);
});

test("navigation uses one coherent public build and never stores authenticated navigation responses", async () => {
  const fixture = worker();
  await fixture.dispatch("install");
  const request = {
    url: origin + "/?note=private-id",
    mode: "navigate",
    method: "GET",
    headers: new Headers(),
  };
  fixture.setShell("PRIVATE_ACCOUNT_RESPONSE");
  const reads = fixture.fetches.length;
  assert.equal(
    await (await fixture.dispatch("fetch", { request })).text(),
    publicHtml,
  );
  assert.equal(
    fixture.fetches.length,
    reads,
    "a prepared shell must not mix with a newer network build",
  );
  fixture.stores.get(fixture.api.CACHE_NAME).delete(origin + "/");
  assert.equal(
    await (await fixture.dispatch("fetch", { request })).text(),
    "PRIVATE_ACCOUNT_RESPONSE",
  );
  assert.equal(
    await (await fixture.caches.open(fixture.api.CACHE_NAME)).match("/"),
    undefined,
  );
  await (
    await fixture.caches.open(fixture.api.CACHE_NAME)
  ).put("/", new Response(publicHtml));
  fixture.setNetwork(false);
  assert.equal(
    await (await fixture.dispatch("fetch", { request })).text(),
    publicHtml,
  );
  assert.equal(
    await (
      await fixture.dispatch("fetch", {
        request: new Request(origin + resource.url),
      })
    ).text(),
    new TextDecoder().decode(asset),
  );
});

test("integrity, body limits, shell identity and mixed-build checks fail closed", async () => {
  const corrupt = worker();
  corrupt.setAsset(new Uint8Array(asset.byteLength).fill(1));
  await assert.rejects(corrupt.dispatch("install"), /verified/);
  assert.equal(await corrupt.api.cacheReady(), false);
  const oversized = worker();
  oversized.setAsset(new Uint8Array(asset.byteLength + 1));
  await assert.rejects(oversized.dispatch("install"), /size limit/);
  for (const [html, headers] of [
    ["PRIVATE_ACCOUNT_RESPONSE", { "Content-Type": "text/html" }],
    [
      publicHtml,
      { "Content-Type": "text/html", "Set-Cookie": "private=value" },
    ],
    [
      publicHtml.replace("app-123.js", "new-build.js"),
      { "Content-Type": "text/html" },
    ],
  ]) {
    const fixture = worker();
    fixture.setShell(html, headers);
    await assert.rejects(fixture.dispatch("install"), /shell|updated/);
    assert.equal(await fixture.api.cacheReady(), false);
  }
});

test("updates wait for other windows and activation removes only older public shell caches", async () => {
  const fixture = worker();
  await fixture.caches.open("unrelated-private-cache");
  await fixture.caches.open("projectanvil-shell-v1-oldest");
  await fixture.caches.open("projectanvil-shell-v1-previous");
  await fixture.dispatch("install");
  fixture.setWindows(2);
  assert.equal(
    (await fixture.message("PROJECTANVIL_ACTIVATE_UPDATE")).activated,
    false,
  );
  assert.equal(fixture.counts().activated, 0);
  fixture.setWindows(1);
  assert.equal(
    (await fixture.message("PROJECTANVIL_ACTIVATE_UPDATE")).activated,
    true,
  );
  assert.equal(fixture.counts().activated, 1);
  assert.equal(
    await fixture.message(
      "PROJECTANVIL_ACTIVATE_UPDATE",
      "https://example.test/",
    ),
    undefined,
  );
  await fixture.dispatch("activate");
  assert.deepEqual(await fixture.caches.keys(), [
    "unrelated-private-cache",
    "projectanvil-shell-v1-previous",
    fixture.api.CACHE_NAME,
  ]);
  assert.equal(fixture.counts().claimed, 1);
});

async function buildFixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(temporaryRoot, "projectanvil-pwa-test-"),
  );
  t.after(async () => {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    assert(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    assert(path.basename(directory).startsWith("projectanvil-pwa-test-"));
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const client = path.join(directory, "dist", "client");
  await fs.mkdir(path.join(client, "_next", "static", "chunks"), {
    recursive: true,
  });
  await fs.mkdir(path.join(directory, "dist", "server"), { recursive: true });
  await fs.cp(path.join(root, "public"), path.join(directory, "public"), {
    recursive: true,
  });
  await fs.cp(path.join(root, "public"), client, { recursive: true });
  await fs.writeFile(
    path.join(client, "_next", "static", "chunks", "app.js"),
    asset,
  );
  await fs.writeFile(
    path.join(directory, "dist", "server", "BUILD_ID"),
    "fixture-build",
  );
  return { directory, client };
}

test("build generation excludes API/private files and changes version with assets or build identity", async (t) => {
  const { directory, client } = await buildFixture(t);
  await fs.mkdir(path.join(client, "api"));
  await fs.writeFile(
    path.join(client, "api", "private.json"),
    "fixture-private-record",
  );
  await fs.writeFile(path.join(client, ".dev.vars"), "fixture-private-secret");
  const first = await generatePwaAssets(directory);
  assert(
    first.resources.every(
      (entry) =>
        !entry.url.includes("api/") && !entry.url.includes(".dev.vars"),
    ),
  );
  const source = await fs.readFile(
    path.join(client, "service-worker.js"),
    "utf8",
  );
  assert(!source.includes("fixture-private"));
  assert(!source.includes("PROJECTANVIL_RESOURCES */"));
  const metadata = JSON.parse(
    await fs.readFile(path.join(client, "app-assets.json"), "utf8"),
  );
  assert.equal(metadata.mode, "production");
  assert.match(metadata.version, /^[a-f0-9]{20}$/);
  assert.equal(metadata.assetCount, first.resources.length);
  assert.equal((await generatePwaAssets(directory)).version, first.version);
  await fs.appendFile(
    path.join(client, "_next", "static", "chunks", "app.js"),
    "\n// Updated",
  );
  const changed = await generatePwaAssets(directory);
  assert.notEqual(changed.version, first.version);
  await fs.writeFile(
    path.join(directory, "dist", "server", "BUILD_ID"),
    "next-build",
  );
  assert.notEqual(
    (await generatePwaAssets(directory)).version,
    changed.version,
  );
});

test("build generation refuses unsupported paths and oversized application files", async (t) => {
  const { directory, client } = await buildFixture(t);
  const badPath = path.join(
    client,
    "_next",
    "static",
    "chunks",
    "unsafe%2fapi.js",
  );
  await fs.writeFile(badPath, "not a supported path");
  await assert.rejects(generatePwaAssets(directory), /unsupported path/);
  await fs.unlink(badPath);
  await fs.writeFile(
    path.join(client, "_next", "static", "chunks", "large.js"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  );
  await assert.rejects(generatePwaAssets(directory), /too large/);
});

test("build generation rejects linked asset directories", async (t) => {
  const { directory, client } = await buildFixture(t);
  const target = path.join(directory, "linked-target");
  await fs.mkdir(target);
  await fs.writeFile(
    path.join(target, "data.js"),
    "must not become an app asset",
  );
  await fs.symlink(
    target,
    path.join(client, "_next", "static", "linked"),
    "junction",
  );
  await assert.rejects(generatePwaAssets(directory), /symbolic links/);
});
