import { env } from "cloudflare:workers";
import { assertSameOrigin, resolveWorkspace } from "../../lib/access-store";
import {
  mutateWorkspace,
  readWorkspace,
  routeError,
  workspaceForClient,
} from "../../lib/workspace-store";
import { WorkspaceError } from "../../lib/workspace-model";
import { recordUpload, retainFailedUpload } from "../../lib/media-store";
import { readBoundedBody } from "../../lib/request-body";
import type { Media } from "../../lib/types";

const maximumSize = 20 * 1024 * 1024;

export async function POST(request: Request) {
  let uploadedKey: string | undefined;
  let uploadedWorkspace: string | undefined;
  let uploadedId: string | undefined;
  try {
    assertSameOrigin(request);
    const access = await resolveWorkspace(request);
    if (!env.BUCKET)
      throw new WorkspaceError(
        "Media storage is unavailable. Enable the BUCKET storage binding before uploading files.",
        503,
      );
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new WorkspaceError(
        "Upload a file using a multipart form with a file field.",
        415,
      );
    if (
      Number(request.headers.get("content-length") || 0) >
      maximumSize + 100_000
    )
      throw new WorkspaceError("Choose a file smaller than 20 MB.", 413);
    const bytes = await readBoundedBody(
      request,
      maximumSize + 100_000,
      "Choose a file smaller than 20 MB.",
    );
    const form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || !("arrayBuffer" in file))
      throw new WorkspaceError("Choose a file to upload.");
    if (file.size > maximumSize)
      throw new WorkspaceError("Choose a file smaller than 20 MB.", 413);
    if (!file.size) throw new WorkspaceError("The selected file is empty.");
    const id = crypto.randomUUID();
    const name =
      file.name.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 240) ||
      "Untitled file";
    const type = file.type.slice(0, 150) || "application/octet-stream";
    const media: Media = {
      id,
      name,
      type,
      size: file.size,
      url: `/api/media/${id}`,
      createdAt: new Date().toISOString(),
    };
    uploadedKey = `media/${access.id}/${id}`;
    await readWorkspace(request);
    await recordUpload(access, id, uploadedKey);
    uploadedWorkspace = access.id;
    uploadedId = id;
    await env.BUCKET.put(uploadedKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: type },
      customMetadata: { name, workspaceId: access.id },
    });
    const workspace = workspaceForClient(
      await mutateWorkspace(request, {
        action: "upsert",
        entity: "media",
        item: media,
        base: null,
        operationId: `upload_${id}`,
      }),
      access.id,
    );
    return Response.json(
      { media: workspace.media.find((item) => item.id === id), workspace },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (uploadedWorkspace && uploadedId)
      await retainFailedUpload(uploadedWorkspace, uploadedId).catch(
        () => undefined,
      );
    return routeError(error);
  }
}
