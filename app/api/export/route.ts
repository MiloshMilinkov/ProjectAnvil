import { readWorkspace, routeError } from '../../lib/workspace-store';

export async function GET() {
  try {
    const workspace = await readWorkspace();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(workspace, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="forgeboard-workspace-${date}.json"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return routeError(error); }
}
