import { resolveWorkspace } from "../../lib/access-store";
import { historyPage } from "../../lib/workspace-journal";
import { readWorkspace, routeError } from "../../lib/workspace-store";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const url = new URL(request.url);
    const result = await historyPage(
      access.id,
      await readWorkspace(request),
      url.searchParams.get("note") || "",
      url.searchParams.get("cursor"),
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
