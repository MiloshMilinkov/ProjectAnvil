import {
  exportMarkdownFolder,
  importMarkdownFolder,
} from "../../lib/portable-store";
import { routeError, workspaceForClient } from "../../lib/workspace-store";
import { resolveWorkspace } from "../../lib/access-store";

export async function GET(request: Request) {
  try {
    const bytes = await exportMarkdownFolder(request);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="projectanvil-markdown-${new Date().toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie, X-Workspace-Id, X-Account-Id",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await importMarkdownFolder(request);
    const access = await resolveWorkspace(request);
    return Response.json(
      { ...result, workspace: workspaceForClient(result.workspace, access.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
