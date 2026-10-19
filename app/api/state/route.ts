import { resolveWorkspace } from '../../lib/access-store';
import { mutateWorkspace, readMutationRequest, readWorkspace, routeError, workspaceForClient } from '../../lib/workspace-store';

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    return Response.json({ workspace: workspaceForClient(await readWorkspace(request), access.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const workspace = await mutateWorkspace(request, await readMutationRequest(request));
    return Response.json({ workspace: workspaceForClient(workspace, access.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
