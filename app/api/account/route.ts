import { getAccountContext } from '../../lib/access-store';
import { routeError } from '../../lib/workspace-store';

export async function GET(request: Request) {
  try { return Response.json(await getAccountContext(request), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return routeError(error); }
}
