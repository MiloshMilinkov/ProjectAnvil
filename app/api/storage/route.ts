import { assertSameOrigin, resolveWorkspace } from "../../lib/access-store";
import { storageHealth } from "../../lib/media-store";
import { readRawWorkspace, routeError } from "../../lib/workspace-store";
import { readBoundedBody } from "../../lib/request-body";
import { WorkspaceError } from "../../lib/workspace-model";
import {
  applyStorageCleanup,
  cleanupRequestSchema,
  previewStorageCleanup,
} from "../../lib/storage-cleanup";

async function checkAccess(
  request: Request,
  securityRevision: number | undefined,
) {
  const latest = await resolveWorkspace(request);
  if (latest.securityRevision !== securityRevision)
    throw new WorkspaceError(
      "Workspace access changed. Check storage again.",
      409,
    );
}

export async function GET(request: Request) {
  try {
    const access = await resolveWorkspace(request);
    const report = await storageHealth(access, await readRawWorkspace(access));
    await checkAccess(request, access.securityRevision);
    return Response.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const access = await resolveWorkspace(request);
    const bytes = await readBoundedBody(
      request,
      20_000,
      "The cleanup request is too large. Review storage again.",
    );
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new WorkspaceError("Choose a valid cleanup review.");
    }
    const parsed = cleanupRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new WorkspaceError(
        "Choose valid cleanup options and review them before deleting anything.",
      );
    const workspace = await readRawWorkspace(access);
    const result =
      parsed.data.action === "preview"
        ? await previewStorageCleanup(access, workspace, parsed.data)
        : await applyStorageCleanup(access, workspace, parsed.data.preview);
    await checkAccess(request, access.securityRevision);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
