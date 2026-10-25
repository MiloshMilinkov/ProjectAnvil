import { resolveWorkspace } from "../../lib/access-store";
import { historyPage } from "../../lib/workspace-journal";
import { readWorkspace, routeError } from "../../lib/workspace-store";
import { WorkspaceError } from "../../lib/workspace-model";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const url = new URL(request.url);
    const workspace = await readWorkspace(request);
    if (
      !workspace.notes.some((note) => note.id === url.searchParams.get("note"))
    )
      throw new WorkspaceError("This note is no longer available.", 404);
    const result = await historyPage(
      access.id,
      workspace,
      url.searchParams.get("note") || "",
      url.searchParams.get("cursor"),
    );
    if (
      !(await readWorkspace(request)).notes.some(
        (note) => note.id === url.searchParams.get("note"),
      )
    )
      throw new WorkspaceError("This note is no longer available.", 404);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
