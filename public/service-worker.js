/* Public application files only. Private state belongs to scoped IndexedDB. */
const BUILD = /* PROJECTANVIL_BUILD */ "development";
const RESOURCES = /* PROJECTANVIL_RESOURCES */ [];
const CACHE_PREFIX = "projectanvil-shell-v1-";
const CACHE_NAME = CACHE_PREFIX + BUILD;
const SHELL_URL = "/";

function publicResource(request) {
  if (request.method !== "GET" || request.headers.has("Range")) return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return null;
  // This allowlist cannot include API endpoints, uploads, or arbitrary URLs.
  return RESOURCES.find((resource) => resource.url === url.pathname) || null;
}

async function fetchPublic(url, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      new Request(url, {
        credentials: "omit",
        redirect: "error",
        cache: "reload",
        signal: controller.signal,
      }),
    );
    if (!response.ok || response.redirected || response.type === "opaque")
      throw new Error("An application file could not be downloaded.");
    const chunks = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > limit)
          throw new Error("An application file exceeded its size limit.");
        chunks.push(chunk.value);
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers(response.headers);
    // Fetch has already decoded HTTP compression before exposing the bytes.
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function verifiedAsset(resource) {
  const response = await fetchPublic(
    new URL(resource.url, self.location.origin),
    resource.bytes,
  );
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== resource.bytes)
    throw new Error(
      "An application file changed during preparation. Retry after updating.",
    );
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== resource.sha256)
    throw new Error("An application file could not be verified.");
  return response;
}

async function prepareShell() {
  if (BUILD === "development" || !RESOURCES.length)
    throw new Error("Offline startup needs a built ProjectAnvil app.");
  const cache = await caches.open(CACHE_NAME);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, RESOURCES.length) }, async () => {
      while (next < RESOURCES.length) {
        const resource = RESOURCES[next++];
        if (!(await cache.match(resource.url)))
          await cache.put(resource.url, await verifiedAsset(resource));
      }
    }),
  );
  if (!(await cache.match(SHELL_URL))) {
    // Never cache a navigation response carrying a signed-in request. This
    // anonymous root has only the public loading shell, before account lookup.
    const response = await fetchPublic(
      new URL(SHELL_URL, self.location.origin),
      1024 * 1024,
    );
    const html = await response.clone().text();
    if (
      !response.headers.get("Content-Type")?.includes("text/html") ||
      response.headers.has("Set-Cookie") ||
      !html.includes('data-projectanvil-shell="public"') ||
      !html.includes("Opening your workspace")
    )
      throw new Error("The public application shell could not be verified.");
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const resource = new URL(match[1], self.location.origin);
      if (
        resource.origin === self.location.origin &&
        resource.pathname.startsWith("/_next/static/") &&
        !RESOURCES.some((entry) => entry.url === resource.pathname)
      )
        throw new Error(
          "The app was updated during preparation. Reopen it and retry.",
        );
    }
    await cache.put(SHELL_URL, response);
  }
  return cacheReady();
}

async function cacheReady() {
  const cache = await caches.open(CACHE_NAME);
  const keys = new Set(
    (await cache.keys()).map((request) => new URL(request.url).pathname),
  );
  return keys.has(SHELL_URL) && RESOURCES.every((entry) => keys.has(entry.url));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    prepareShell().then((ready) => {
      if (!ready) throw new Error("The offline app could not be prepared.");
    }),
  );
  // Updates wait until the user restarts, or all older app windows close.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const owned = (await caches.keys()).filter((name) =>
        name.startsWith(CACHE_PREFIX),
      );
      // Retain one earlier public shell for in-flight requests during a restart.
      const previous = owned.filter((name) => name !== CACHE_NAME).at(-1);
      await Promise.all(
        owned
          .filter((name) => name !== CACHE_NAME && name !== previous)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        // The generic shell and its chunks belong to one verified build. A
        // new shell becomes visible only when its prepared worker activates.
        const shell = await cache.match(SHELL_URL);
        if (shell) return shell;
        try {
          const response = await fetch(request);
          if (response.status < 500) return response;
          return (await cache.match(SHELL_URL)) || response;
        } catch {
          return (
            (await cache.match(SHELL_URL)) ||
            new Response(
              "ProjectAnvil is not ready for offline startup. Open the local app while its server is running first.",
              {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              },
            )
          );
        }
      })(),
    );
    return;
  }
  if (publicResource(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(url.pathname)) || (await fetch(request));
      })(),
    );
  }
});

self.addEventListener("message", (event) => {
  const reply = event.ports[0];
  if (
    !reply ||
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  if (event.data?.type === "PROJECTANVIL_SHELL_STATUS") {
    event.waitUntil(
      cacheReady().then((ready) =>
        reply.postMessage({ ready, version: BUILD }),
      ),
    );
  } else if (event.data?.type === "PROJECTANVIL_PREPARE_SHELL") {
    event.waitUntil(
      prepareShell()
        .then((ready) => reply.postMessage({ ready, version: BUILD }))
        .catch(() =>
          reply.postMessage({
            ready: false,
            error: "Keep the local server running and retry preparing the app.",
          }),
        ),
    );
  } else if (event.data?.type === "PROJECTANVIL_ACTIVATE_UPDATE") {
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        if (windows.length > 1) {
          reply.postMessage({
            activated: false,
            error:
              "Close other ProjectAnvil windows, then restart to update. Their unfinished work stays in those windows.",
          });
          return;
        }
        reply.postMessage({ activated: true });
        await self.skipWaiting();
      })(),
    );
  }
});
