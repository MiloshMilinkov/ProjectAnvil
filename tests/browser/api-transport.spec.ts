import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type BrowserContext } from "@playwright/test";
import { api, type BrowserAccount } from "./helpers";

test("fixture reads recover from one connection reset without replaying writes or HTTP failures", async ({
  browser,
}) => {
  const attempts = new Map<string, number>();
  const mutations: string[] = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const count = (attempts.get(pathname) || 0) + 1;
    attempts.set(pathname, count);
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Local transport fixture</title>");
      return;
    }
    if (pathname === "/mutation") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      // Model a committed mutation whose acknowledgement is lost. Replaying
      // it automatically would produce a second, unintended write.
      mutations.push(Buffer.concat(chunks).toString("utf8"));
      request.socket.destroy();
      return;
    }
    if (
      pathname === "/always-reset" ||
      (pathname === "/read" && count === 1)
    ) {
      request.socket.destroy();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (pathname === "/http-error") {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Deliberate server failure" }));
      return;
    }
    response.end(
      JSON.stringify({
        account: request.headers["x-account-id"],
        workspace: request.headers["x-workspace-id"],
        origin: request.headers.origin,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/");
    const actor: BrowserAccount = {
      context,
      page,
      userId: "transport-account",
      username: "transport-fixture",
      password: "Unused synthetic credential",
      personal: {
        id: "transport-workspace",
        name: "Transport fixture",
        kind: "personal",
        role: "owner",
      },
      pageErrors: [],
      nativeExitErrors: [],
    };
    expect(await api(actor, "/read", undefined, actor.personal.id)).toEqual({
      account: actor.userId,
      workspace: actor.personal.id,
      origin: baseURL,
    });
    expect(attempts.get("/read")).toBe(2);

    await expect(api(actor, "/always-reset")).rejects.toThrow();
    expect(attempts.get("/always-reset")).toBe(2);

    await expect(
      api(actor, "/mutation", { title: "Write once" }),
    ).rejects.toThrow();
    expect(attempts.get("/mutation")).toBe(1);
    expect(mutations).toEqual([JSON.stringify({ title: "Write once" })]);

    await expect(api(actor, "/http-error")).rejects.toThrow("failed (500)");
    expect(attempts.get("/http-error")).toBe(1);
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
