import { env } from "cloudflare:workers";
import {
  assertSameOrigin,
  database,
  resolveWorkspace,
  type ResolvedWorkspace,
} from "./access-store";
import { readRawWorkspace, readWorkspace } from "./workspace-store";
import { WorkspaceError, validateWorkspace } from "./workspace-model";
import { assertMutationAccess, assertProjectWritable } from "./permissions";
import { commitWorkspace, hasReceipt, payloadHash } from "./workspace-journal";
import { recordUpload, retainFailedUpload } from "./media-store";
import { createSignatureReader } from "./relationships";
import {
  exportPortableNotes,
  packPortableZip,
  planPortableImport,
  portableLimits,
  readPortableBundle,
  unpackPortableZip,
} from "./portable-markdown";
import { readBoundedBody } from "./request-body";
import type { Mutation, Workspace } from "./types";

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function validIdentifier(value: string) {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value);
}
function writableTarget(
  access: ResolvedWorkspace,
  workspace: Workspace,
  projectId: string,
) {
  assertProjectWritable(access, projectId);
  if (
    projectId &&
    !workspace.projects.some((project) => project.id === projectId)
  )
    throw new WorkspaceError(
      "Choose an available project for the imported notes.",
      404,
    );
}

export async function exportMarkdownFolder(request: Request) {
  const access = await resolveWorkspace(request);
  const workspace = await readWorkspace(request);
  const projectId = new URL(request.url).searchParams.get("project") || "";
  if (
    projectId &&
    (!validIdentifier(projectId) ||
      !workspace.projects.some((project) => project.id === projectId))
  )
    throw new WorkspaceError("This project is no longer available for export.", 404);
  const selected = projectId
    ? {
        ...workspace,
        notes: workspace.notes.filter((note) => note.projectId === projectId),
      }
    : workspace;
  if (!selected.notes.length)
    throw new WorkspaceError(
      "There are no notes to export. Add a note or choose another project.",
    );
  if (selected.notes.length > portableLimits.notes)
    throw new WorkspaceError(
      "Export at most 200 notes at a time. Choose a project to narrow the export.",
    );
  const referenced = new Set<string>();
  for (const note of selected.notes) {
    // Portable metadata can hold attachment links too. Historical snapshots
    // are deliberately excluded because this export contains current notes.
    const currentText = JSON.stringify([
      note.content,
      note.properties,
      note.propertyValues || {},
      note.decision || null,
    ]);
    for (const match of currentText.matchAll(/\/api\/media\/([A-Za-z0-9_-]+)/g))
      referenced.add(match[1]);
  }
  selected.media = workspace.media.filter(
    (file) =>
      !projectId || file.projectId === projectId || referenced.has(file.id),
  );
  if (selected.notes.length + selected.media.length + 1 > portableLimits.files)
    throw new WorkspaceError(
      "Export at most 400 notes and attachments at a time. Choose a project to narrow the export.",
    );
  let portable: ReturnType<typeof exportPortableNotes>;
  try {
    portable = exportPortableNotes(selected);
  } catch (error) {
    throw new WorkspaceError(
      error instanceof Error
        ? error.message
        : "Some note paths could not be exported.",
    );
  }
  let total = portable.files.reduce((sum, file) => sum + file.bytes.length, 0);
  for (const file of selected.media) {
    if (!env.BUCKET)
      throw new WorkspaceError("Attachment storage is unavailable.", 503);
    const object =
      (await env.BUCKET.get(`media/${access.id}/${file.id}`)) ||
      (access.kind === "guest"
        ? await env.BUCKET.get(`media/${file.id}`)
        : null);
    if (!object)
      throw new WorkspaceError(
        "An attachment is missing. Check workspace storage before exporting these notes.",
        409,
      );
    total += object.size;
    if (total > portableLimits.expandedBytes)
      throw new WorkspaceError(
        "Export at most 24 MB at a time. Choose a smaller project.",
        413,
      );
    if (
      object.size > portableLimits.attachmentBytes ||
      object.size !== file.size
    )
      throw new WorkspaceError(
        "An attachment's stored size has changed. Check workspace storage before exporting.",
        409,
      );
    portable.files.push({
      path: portable.attachmentPaths.get(file.id)!,
      bytes: new Uint8Array(await new Response(object.body).arrayBuffer()),
    });
  }
  const latest = await readWorkspace(request);
  // File reads can take time. Recheck every exported record against current access.
  if (
    selected.notes.some(
      (note) => !latest.notes.some((item) => item.id === note.id),
    ) ||
    selected.media.some(
      (file) => !latest.media.some((item) => item.id === file.id),
    )
  )
    throw new WorkspaceError(
      "Your access changed during export. Start the export again to include only the items you can still open.",
      409,
    );
  try {
    return packPortableZip(portable.files);
  } catch (error) {
    throw new WorkspaceError(
      error instanceof Error
        ? error.message
        : "The Markdown folder could not be exported.",
    );
  }
}

export async function importMarkdownFolder(request: Request) {
  assertSameOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/zip")
    throw new WorkspaceError(
      "Send the reviewed Markdown folder as a ZIP archive.",
      415,
    );
  const projectId = request.headers.get("X-Import-Project") || "";
  const operationId = request.headers.get("X-Import-Operation") || "";
  if (
    (projectId && !validIdentifier(projectId)) ||
    !validIdentifier(operationId)
  )
    throw new WorkspaceError(
      "This import is missing a valid project or save reference. Review the import and try again.",
    );
  let access = await resolveWorkspace(request);
  let current = await readRawWorkspace(access);
  writableTarget(access, current, projectId);
  const archive = await readBoundedBody(
    request,
    portableLimits.archiveBytes,
    "Choose a ZIP smaller than 25 MB.",
  );
  let bundle: ReturnType<typeof readPortableBundle>;
  try {
    bundle = readPortableBundle(unpackPortableZip(archive));
  } catch (error) {
    throw new WorkspaceError(
      error instanceof Error
        ? error.message
        : "The Markdown folder could not be read.",
    );
  }
  const archiveHash = await digest(archive);
  const hash = await payloadHash({
    format: "markdown-folder-v1",
    projectId,
    archiveHash,
  });
  const ids = new Map<string, string>();
  const keys = [
    ...bundle.notes.map((note) => note.path),
    ...bundle.attachments.map((file) => file.path),
    ...bundle.noteTypes.map((_, index) => `type:${index}`),
    ...bundle.relationships.map((_, index) => `relationship:${index}`),
  ];
  for (const key of keys)
    ids.set(
      key,
      `markdown_${(await payloadHash([access.id, access.user?.id || "guest", operationId, archiveHash, key])).slice(0, 40)}`,
    );
  const now = new Date().toISOString();
  const staged = new Set<string>();
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      access = await resolveWorkspace(request);
      current = await readRawWorkspace(access);
      writableTarget(access, current, projectId);
      if (await hasReceipt(access, operationId, hash))
        return {
          workspace: await readWorkspace(request),
          imported: {
            notes: bundle.notes.length,
            attachments: bundle.attachments.length,
          },
          warnings: [
            "This import was already completed. The current workspace has been loaded.",
          ],
          alreadyImported: true,
        };
      let plan: ReturnType<typeof planPortableImport>;
      try {
        plan = planPortableImport(bundle, current, projectId, ids, now);
      } catch (error) {
        throw new WorkspaceError(
          error instanceof Error
            ? error.message
            : "The imported notes could not be prepared.",
        );
      }
      const existingIds = new Set([
        ...current.notes.map((item) => item.id),
        ...current.media.map((item) => item.id),
        ...(current.noteTypes || []).map((item) => item.id),
        ...current.relationships.map((item) => item.id),
      ]);
      if ([...ids.values()].some((id) => existingIds.has(id)))
        throw new WorkspaceError(
          "This import's earlier records have changed. Start a new import to create another copy.",
          409,
        );
      const deleted = await database()
        .prepare(
          "SELECT entity_id FROM entity_tombstones WHERE workspace_id = ? AND entity_id IN (SELECT value FROM json_each(?)) LIMIT 1",
        )
        .bind(access.id, JSON.stringify([...ids.values()]))
        .first();
      if (deleted)
        throw new WorkspaceError(
          "An earlier import was deleted. Restore it from Trash, or start a new import for fresh copies.",
          409,
        );
      const updated = validateWorkspace({
        ...current,
        notes: [...current.notes, ...plan.notes],
        media: [...current.media, ...plan.media],
        noteTypes: [...(current.noteTypes || []), ...plan.noteTypes],
        relationships: [...current.relationships, ...plan.relationships],
        revision: current.revision + 1,
      });
      const signatures = createSignatureReader(updated);
      for (const link of plan.relationships) {
        const target = updated.relationships.find(
          (item) => item.id === link.id,
        )!;
        target.fromSignature = signatures(target.from);
        target.toSignature = signatures(target.to);
      }
      const mutation: Mutation = {
        action: "upsert",
        entity: "notes",
        item: { id: plan.notes[0].id },
        base: null,
      };
      assertMutationAccess(access, current, updated, mutation);
      if (bundle.attachments.length && !env.BUCKET)
        throw new WorkspaceError("Attachment storage is unavailable.", 503);
      for (const file of bundle.attachments) {
        const id = ids.get(file.path)!;
        if (staged.has(id)) continue;
        const key = `media/${access.id}/${id}`;
        const existing = await database()
          .prepare(
            "SELECT object_key FROM media_objects WHERE workspace_id = ? AND media_id = ?",
          )
          .bind(access.id, id)
          .first<{ object_key: string }>();
        if (existing && existing.object_key !== key)
          throw new WorkspaceError(
            "The attachment staging record has changed. Start a new import.",
            409,
          );
        if (!existing) await recordUpload(access, id, key);
        staged.add(id);
        const metadata = plan.media.find((item) => item.id === id)!;
        const bucket = env.BUCKET;
        if (!bucket)
          throw new WorkspaceError("Attachment storage is unavailable.", 503);
        await bucket.put(key, file.bytes, {
          httpMetadata: { contentType: metadata.type },
          customMetadata: { name: metadata.name, workspaceId: access.id },
        });
      }
      const committed = await commitWorkspace(
        access,
        current,
        updated,
        operationId,
        hash,
        false,
        {},
        { mutation, suppressNotifications: true },
      );
      if (committed)
        return {
          workspace: await readWorkspace(request),
          imported: {
            notes: plan.notes.length,
            attachments: plan.media.length,
          },
          warnings: plan.warnings,
          alreadyImported: false,
        };
    }
    throw new WorkspaceError(
      "The workspace kept changing during import. Your existing work is intact. Retry this import when editing settles.",
      409,
    );
  } catch (error) {
    // A failed response may follow a successful commit. Never delete uncertain
    // bytes; active records remain active and uncommitted staging is retained.
    for (const id of staged)
      await retainFailedUpload(access.id, id).catch(() => undefined);
    throw error;
  }
}
