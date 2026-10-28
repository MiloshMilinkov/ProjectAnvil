import { env } from "cloudflare:workers";
import { getAuth, getSessionUser } from "../../../lib/auth";
import {
  accountCallback,
  accountPolicy,
  emailApproved,
} from "../../../lib/account-policy";
import { assertSameOrigin } from "../../../lib/access-store";
import { readBoundedBody } from "../../../lib/request-body";
import { WorkspaceError } from "../../../lib/workspace-model";
import { routeError } from "../../../lib/workspace-store";

const postPaths = new Set([
  "sign-up/email",
  "sign-in/username",
  "sign-out",
  "change-password",
  "request-password-reset",
  "reset-password",
  "send-verification-email",
]);

/** Browser authentication uses HttpOnly cookies; never expose bearer session tokens. */
async function privateAuthResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  if (
    (response.status >= 300 && response.status < 400) ||
    response.status === 204 ||
    response.status === 205 ||
    !headers.get("content-type")?.includes("application/json")
  )
    return new Response(response.body, { status: response.status, headers });
  const body = (await response.json()) as Record<string, unknown>;
  if (body && typeof body === "object") {
    delete body.token;
    if (body.session && typeof body.session === "object")
      delete (body.session as Record<string, unknown>).token;
  }
  return Response.json(body, { status: response.status, headers });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/auth\//, "");
    if (
      path !== "get-session" &&
      path !== "verify-email" &&
      !/^reset-password\/[A-Za-z0-9_-]{1,200}$/.test(path)
    )
      return Response.json({ error: "Not found" }, { status: 404 });
    const policy = accountPolicy(env, request.url);
    if (path !== "get-session")
      accountCallback(
        url.searchParams.get("callbackURL") ?? undefined,
        policy.origin,
        path === "verify-email" ? "verified" : "reset",
      );
    return privateAuthResponse(await (await getAuth(request)).handler(request));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
    if (!postPaths.has(path))
      return Response.json({ error: "Not found" }, { status: 404 });
    assertSameOrigin(request);
    const policy = accountPolicy(env, request.url);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new WorkspaceError("Send a JSON request.", 415);
    const expected = request.headers.get("x-account-id");
    if (
      expected &&
      expected !== ((await getSessionUser(request))?.id || "guest")
    )
      throw new WorkspaceError(
        "The signed-in account changed. Reload before continuing.",
        409,
      );
    const raw = await readBoundedBody(
      request,
      10_000,
      "This account request is too large.",
    );
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw new WorkspaceError("Enter valid account details.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new WorkspaceError("Enter valid account details.", 400);
    if (path === "sign-up/email") {
      if (
        typeof body.username !== "string" ||
        !/^[A-Za-z0-9_.]{3,30}$/.test(body.username)
      )
        throw new WorkspaceError(
          "Choose a username with 3–30 letters, numbers, underscores, or dots.",
          400,
        );
      if (typeof body.email !== "string" || !emailApproved(policy, body.email))
        throw new WorkspaceError(
          "Registration is available to approved email addresses only.",
          403,
        );
      body.name = body.username;
      delete body.displayUsername;
      body.callbackURL = accountCallback(
        body.callbackURL,
        policy.origin,
        "verified",
      );
    }
    if (path === "sign-in/username") {
      delete body.callbackURL;
      if (
        policy.public.mode === "online" &&
        typeof body.username === "string"
      ) {
        await getAuth(request);
        const user = await env
          .DB!.prepare('SELECT email FROM "user" WHERE lower(username) = ?')
          .bind(body.username.toLowerCase())
          .first<{ email: string }>();
        if (user && !emailApproved(policy, user.email))
          throw new WorkspaceError(
            "Unable to sign in with these account details.",
            401,
          );
      }
    }
    if (path === "request-password-reset")
      body.redirectTo = accountCallback(
        body.redirectTo,
        policy.origin,
        "reset",
      );
    if (path === "send-verification-email")
      body.callbackURL = accountCallback(
        body.callbackURL,
        policy.origin,
        "verified",
      );
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const forwarded = new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return privateAuthResponse(
      await (await getAuth(request)).handler(forwarded),
    );
  } catch (error) {
    return routeError(error);
  }
}
