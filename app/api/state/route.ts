import { resolveWorkspace } from "../../lib/access-store";
import {
  mutateWorkspaceResult,
  readMutationRequest,
  readWorkspace,
  routeError,
  workspaceForClient,
} from "../../lib/workspace-store";
import { payloadHash } from "../../lib/workspace-journal";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const workspace = await readWorkspace(request);
    const people = [...workspace.people].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const etag = `"${await payloadHash({ workspace: access.id, account: access.user?.id || "guest", revision: workspace.revision, people })}"`;
    const headers = {
      "Cache-Control": "private, no-cache",
      ETag: etag,
      Vary: "Cookie, X-Workspace-Id, X-Account-Id",
    };
    if (
      request.headers
        .get("if-none-match")
        ?.split(",")
        .map((value) => value.trim())
        .includes(etag)
    )
      return new Response(null, { status: 304, headers });
    return Response.json(
      { workspace: workspaceForClient(workspace, access.id) },
      { headers },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const result = await mutateWorkspaceResult(
      request,
      await readMutationRequest(request),
    );
    return Response.json(
      {
        workspace: workspaceForClient(result.workspace, access.id),
        warnings: result.warnings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
