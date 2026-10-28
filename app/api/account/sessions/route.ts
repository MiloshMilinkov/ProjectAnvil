import { getAuth, getSessionUser } from "../../../lib/auth";
import { assertSameOrigin } from "../../../lib/access-store";
import { readBoundedBody } from "../../../lib/request-body";
import { WorkspaceError } from "../../../lib/workspace-model";
import { routeError } from "../../../lib/workspace-store";

async function sessionsFor(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw new WorkspaceError("Sign in to manage your sessions.", 401);
  if (request.headers.get("x-account-id") !== user.id)
    throw new WorkspaceError(
      "The signed-in account changed. Reopen account security.",
      409,
    );
  const auth = await getAuth(request);
  const current = await auth.api.getSession({ headers: request.headers });
  const sessions = await auth.api.listSessions({ headers: request.headers });
  return { auth, current, sessions };
}

function failure(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    (error.statusCode === 401 || error.statusCode === 403)
  )
    return routeError(
      new WorkspaceError(
        "Sign in again before managing your sessions.",
        error.statusCode,
      ),
    );
  return routeError(error);
}

export async function GET(request: Request) {
  try {
    const { current, sessions } = await sessionsFor(request);
    return Response.json(
      {
        sessions: sessions.map((session) => ({
          id: session.id,
          userAgent: session.userAgent || "Unknown browser",
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          current: session.id === current?.session.id,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new WorkspaceError("Send a JSON request.", 415);
    const bytes = await readBoundedBody(
      request,
      2048,
      "This session request is too large.",
    );
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new WorkspaceError("Choose a session action.", 400);
    }
    const { auth, current, sessions } = await sessionsFor(request);
    if (body?.action === "revoke-others")
      await auth.api.revokeOtherSessions({ headers: request.headers });
    else if (body?.action === "revoke" && typeof body.sessionId === "string") {
      const target = sessions.find((session) => session.id === body.sessionId);
      if (!target)
        throw new WorkspaceError("This session has already ended.", 404);
      if (target.id === current?.session.id)
        throw new WorkspaceError(
          "Use Sign out to close this session safely.",
          400,
        );
      await auth.api.revokeSession({
        headers: request.headers,
        body: { token: target.token },
      });
    } else throw new WorkspaceError("Choose a session action.", 400);
    return Response.json(
      { success: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
