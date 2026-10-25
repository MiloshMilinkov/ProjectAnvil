import {
  changeNotifications,
  readNotifications,
} from "../../lib/collaboration-store";
import { readMutationRequest, routeError } from "../../lib/workspace-store";
export async function GET(request: Request) {
  try {
    return Response.json(await readNotifications(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    await changeNotifications(request, await readMutationRequest(request));
    return Response.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
