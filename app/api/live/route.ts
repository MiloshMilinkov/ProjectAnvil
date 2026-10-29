import {
  database,
  resolveWorkspace,
  resolveWorkspaceMarker,
} from "../../lib/access-store";
import { readRawWorkspace, routeError } from "../../lib/workspace-store";
import { WorkspaceError } from "../../lib/workspace-model";

/** Long polling sends revision markers only; normal reads enforce data visibility. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const since = url.searchParams.get("since") || "";
    const wait = url.searchParams.get("wait") === "0" ? 0 : 18_000;
    const deadline = Date.now() + wait;
    while (!request.signal.aborted) {
      // Markers contain no records. Recheck the session, membership and security
      // revision each tick; normal state reads still load all project grants.
      const access = await resolveWorkspaceMarker(request);
      const row =
        (await database()
          .prepare("SELECT revision FROM workspaces WHERE id = ?")
          .bind(access.id)
          .first<{ revision: number }>()) ||
        (access.kind === "guest"
          ? {
              revision: (
                await readRawWorkspace(await resolveWorkspace(request))
              ).revision,
            }
          : null);
      if (!row) throw new WorkspaceError("This workspace is unavailable.", 404);
      const securityRevision = access.securityRevision || 0;
      const cursor = `${row.revision}:${securityRevision}:${access.role}`;
      if (cursor !== since || Date.now() >= deadline)
        return Response.json(
          {
            cursor,
            revision: row.revision,
            securityRevision,
            role: access.role,
          },
          {
            headers: {
              "Cache-Control": "private, no-store",
              Vary: "Cookie, X-Workspace-Id, X-Account-Id",
            },
          },
        );
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(
          finish,
          Math.min(1_000, Math.max(0, deadline - Date.now())),
        );
        request.signal.addEventListener("abort", finish, { once: true });
      });
    }
    return new Response(null, { status: 204 });
  } catch (cause) {
    return routeError(cause);
  }
}
