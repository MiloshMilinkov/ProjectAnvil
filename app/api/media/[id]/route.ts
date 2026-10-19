import { env } from 'cloudflare:workers';
import { readWorkspace, routeError } from '../../../lib/workspace-store';
import { WorkspaceError } from '../../../lib/workspace-model';

const inlineTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg', 'text/plain', 'text/markdown',
]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new WorkspaceError('This file could not be found.', 404);
    if (!env.BUCKET) throw new WorkspaceError('Media storage is unavailable.', 503);
    const workspace = await readWorkspace();
    const media = workspace.media.find(item => item.id === id);
    if (!media) throw new WorkspaceError('This file was removed or could not be found.', 404);
    let range: { offset: number; length: number } | undefined;
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const metadata = await env.BUCKET.head(`media/${id}`);
      if (!metadata) throw new WorkspaceError('The file data is missing. Upload the file again.', 404);
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      let start = 0;
      let end = metadata.size - 1;
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(end, Number(match[2]));
        } else start = Math.max(0, metadata.size - Number(match[2]));
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= metadata.size) {
        return Response.json({ error: 'The requested part of this file is unavailable.' }, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}`, 'Cache-Control': 'private, no-store' } });
      }
      range = { offset: start, length: end - start + 1 };
    }
    const object = await env.BUCKET.get(`media/${id}`, range ? { range } : undefined);
    if (!object) throw new WorkspaceError('The file data is missing. Upload the file again.', 404);
    const isInline = inlineTypes.has(media.type.toLowerCase());
    const filename = media.name.replace(/[^\x20-\x7E]|["\\]/g, '_');
    return new Response(object.body, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': isInline ? media.type : 'application/octet-stream',
        'Content-Length': String(range?.length ?? object.size),
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` } : {}),
        'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(media.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    });
  } catch (error) { return routeError(error); }
}
