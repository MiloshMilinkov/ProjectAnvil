import { readActivity } from "../../lib/collaboration-store";
import { routeError } from "../../lib/workspace-store";
export async function GET(request: Request) {
  try {
    return Response.json(await readActivity(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
