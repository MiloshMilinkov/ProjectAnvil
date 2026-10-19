import { mutateWorkspace, readMutationRequest, readWorkspace, routeError } from '../../lib/workspace-store';

export async function GET() {
  try {
    return Response.json({ workspace: await readWorkspace() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await mutateWorkspace(await readMutationRequest(request));
    return Response.json({ workspace }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
