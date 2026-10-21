import { mutateWorkRoom, readWorkRooms } from '../../lib/workroom-store';
import { readMutationRequest, routeError } from '../../lib/workspace-store';

export async function GET(request: Request) {
  try {
    return Response.json({ rooms: await readWorkRooms(request) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json({ rooms: await mutateWorkRoom(request, await readMutationRequest(request)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeError(error);
  }
}
