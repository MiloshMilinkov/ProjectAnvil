import { resolveWorkspace } from "../../lib/access-store";
import { canManageWorkspace } from "../../lib/permissions";
import { trashPage, canAccessTrash } from "../../lib/workspace-trash";
import { readRawWorkspace, routeError } from "../../lib/workspace-store";

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const url = new URL(request.url);
    const page = await trashPage(
      access.id,
      url.searchParams.get("cursor"),
      url.searchParams.get("limit"),
    );
    if (!canManageWorkspace(access)) {
    const workspace = await readRawWorkspace(access);
    const allowed = await Promise.all(
      page.entries.map(async (entry) => ({
        visible: await canAccessTrash(access, workspace, entry.id),
        editable: await canAccessTrash(access, workspace, entry.id, true),
      })),
    );
    page.entries = page.entries.flatMap((entry, index) =>
      !allowed[index].visible
        ? []
        : [
            allowed[index].editable
              ? entry
              : {
                  ...entry,
                  restorable: false,
                  unavailableReason:
                    "Your current role can read this recovery record but cannot restore it.",
                },
          ],
    );
    }
    // A revoked membership must not receive a list prepared before its removal.
    const latest = await resolveWorkspace(request);
    if (latest.securityRevision !== access.securityRevision)
      return Response.json(
        {
          error:
            "Project access changed. Reopen Trash to load the current recovery records.",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
