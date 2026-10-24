import { resolveWorkspace } from "../../lib/access-store";
import { trashPage } from "../../lib/workspace-trash";
import { routeError } from "../../lib/workspace-store";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const url = new URL(request.url);
    const page = await trashPage(
      access.id,
      url.searchParams.get("cursor"),
      url.searchParams.get("limit"),
    );
    // A revoked membership must not receive a list prepared before its removal.
    await resolveWorkspace(request);
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
