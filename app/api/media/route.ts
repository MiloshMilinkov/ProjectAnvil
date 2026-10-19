import { env } from 'cloudflare:workers';
import { mutateWorkspace, routeError } from '../../lib/workspace-store';
import { WorkspaceError } from '../../lib/workspace-model';
import type { Media } from '../../lib/types';

const maximumSize = 20 * 1024 * 1024;

export async function POST(request: Request) {
  let uploadedId: string | undefined;
  try {
    if (!env.BUCKET) throw new WorkspaceError('Media storage is unavailable. Enable the BUCKET storage binding before uploading files.', 503);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new WorkspaceError('Upload a file using a multipart form with a file field.', 415);
    if (Number(request.headers.get('content-length') || 0) > maximumSize + 100_000) throw new WorkspaceError('Choose a file smaller than 20 MB.', 413);
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || !('arrayBuffer' in file)) throw new WorkspaceError('Choose a file to upload.');
    if (file.size > maximumSize) throw new WorkspaceError('Choose a file smaller than 20 MB.', 413);
    if (!file.size) throw new WorkspaceError('The selected file is empty.');
    const id = crypto.randomUUID();
    const name = file.name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 240) || 'Untitled file';
    const type = file.type.slice(0, 150) || 'application/octet-stream';
    const media: Media = { id, name, type, size: file.size, url: `/api/media/${id}`, createdAt: new Date().toISOString() };
    await env.BUCKET.put(`media/${id}`, await file.arrayBuffer(), { httpMetadata: { contentType: type }, customMetadata: { name } });
    uploadedId = id;
    const workspace = await mutateWorkspace({ action: 'upsert', entity: 'media', item: media });
    return Response.json({ media, workspace }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (uploadedId && env.BUCKET) await env.BUCKET.delete(`media/${uploadedId}`).catch(() => undefined);
    return routeError(error);
  }
}
