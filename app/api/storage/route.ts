import { resolveWorkspace } from "../../lib/access-store";
import { storageHealth } from "../../lib/media-store";
import { readWorkspace, routeError } from "../../lib/workspace-store";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const report = await storageHealth(access, await readWorkspace(request));
    return Response.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
