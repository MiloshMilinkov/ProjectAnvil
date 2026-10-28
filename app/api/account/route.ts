import { getAccountContext } from "../../lib/access-store";
import { routeError } from "../../lib/workspace-store";
import { accountPolicy } from "../../lib/account-policy";
import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  try {
    return Response.json(
      {
        ...(await getAccountContext(request)),
        policy: accountPolicy(env, request.url).public,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
