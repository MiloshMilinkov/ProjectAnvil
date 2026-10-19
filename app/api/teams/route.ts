import { listTeamMembers, teamAction } from '../../lib/access-store';
import { readMutationRequest, routeError } from '../../lib/workspace-store';
import { WorkspaceError } from '../../lib/workspace-model';

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!workspaceId) throw new WorkspaceError('Choose a workspace.');
    return Response.json(await listTeamMembers(request, workspaceId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try { return Response.json(await teamAction(request, await readMutationRequest(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return routeError(error); }
}
