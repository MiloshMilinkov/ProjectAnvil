import { changeWatch, readWatch } from "../../lib/collaboration-store";
import { readMutationRequest, routeError } from "../../lib/workspace-store";
export async function GET(request: Request) {
  try {
    return Response.json(await readWatch(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    return Response.json(
      await changeWatch(request, await readMutationRequest(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
