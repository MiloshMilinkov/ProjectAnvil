import {
  readNoteCollaboration,
  updateNoteCollaboration,
} from "../../lib/note-collaboration-store";
import { readMutationRequest, routeError } from "../../lib/workspace-store";

export async function GET(request: Request) {
  try {
    return Response.json(await readNoteCollaboration(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    return Response.json(
      await updateNoteCollaboration(
        request,
        await readMutationRequest(request),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
