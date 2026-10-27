import { Unzip, UnzipInflate, zipSync } from "fflate";
import type {
  DecisionRecord,
  Media,
  Note,
  NoteType,
  Relationship,
  Workspace,
} from "./types";
import { emptyDecision } from "./note-structures";

export const portableLimits = {
  archiveBytes: 25 * 1024 * 1024,
  expandedBytes: 24 * 1024 * 1024,
  attachmentBytes: 20 * 1024 * 1024,
  noteBytes: 1_500_000,
  notes: 200,
  files: 400,
} as const;
export type PortableFile = {
  path: string;
  bytes: Uint8Array;
  name?: string;
  type?: string;
};
export type PortableNote = {
  path: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};
export type PortableBundle = {
  notes: PortableNote[];
  attachments: PortableFile[];
  noteTypes: NoteType[];
  relationships: {
    from: string;
    to: string;
    kind: Relationship["kind"];
    label: string;
  }[];
  warnings: string[];
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const manifestPath = "projectanvil-manifest.json";
const dangerous = new Set(["__proto__", "prototype", "constructor"]);

export function portablePath(value: string): string {
  const path = value.normalize("NFC");
  const segments = path.split("/");
  if (
    !path ||
    path.length > 240 ||
    segments.length > 12 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\:*?"<>|\x00-\x1f\x7f]/.test(segment) ||
        /[. ]$/.test(segment) ||
        dangerous.has(segment.toLowerCase()) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
    )
  )
    throw new Error(
      "Use relative folder paths without parent folders, drive names, or reserved filenames.",
    );
  return path;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Inspect allocation sizes before asking the ZIP library to inflate anything. */
export function unpackPortableZip(bytes: Uint8Array): PortableFile[] {
  if (bytes.byteLength > portableLimits.archiveBytes)
    throw new Error("Choose a ZIP smaller than 25 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65558);
    offset--
  )
    if (
      u32(offset) === 0x06054b50 &&
      offset + 22 + u16(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    throw new Error("Choose an ordinary, single-volume ZIP archive.");
  const count = u16(end + 10),
    size = u32(end + 12),
    start = u32(end + 16);
  if (!count || count > portableLimits.files + 30 || start + size !== end)
    throw new Error(
      "Use a ZIP with at most 400 files and ordinary ZIP headers.",
    );
  const expected = new Map<string, { size: number; crc: number }>();
  const names = new Set<string>();
  let offset = start,
    total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50)
      throw new Error("The ZIP directory is damaged.");
    const flags = u16(offset + 8),
      method = u16(offset + 10),
      compressed = u32(offset + 20),
      expanded = u32(offset + 24);
    const nameLength = u16(offset + 28),
      extraLength = u16(offset + 30),
      commentLength = u16(offset + 32),
      local = u32(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      expanded === 0xffffffff ||
      compressed === 0xffffffff ||
      ((u32(offset + 38) >>> 16) & 0xf000) === 0xa000
    )
      throw new Error(
        "Encrypted, linked, ZIP64, or unsupported ZIP entries cannot be imported.",
      );
    let raw: string;
    try {
      raw = decoder.decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      );
    } catch {
      throw new Error("Use UTF-8 filenames in the ZIP archive.");
    }
    const directory = raw.endsWith("/");
    const path = portablePath(directory ? raw.slice(0, -1) : raw);
    const key = path.toLocaleLowerCase("en-US");
    if (names.has(key))
      throw new Error("The ZIP contains duplicate or case-colliding paths.");
    names.add(key);
    if (
      local + 30 > start ||
      u32(local) !== 0x04034b50 ||
      u16(local + 8) !== method ||
      u16(local + 6) & 1
    )
      throw new Error("The ZIP file headers are damaged.");
    const localName = decoder.decode(
      bytes.subarray(local + 30, local + 30 + u16(local + 26)),
    );
    const payload = local + 30 + u16(local + 26) + u16(local + 28);
    if (
      localName !== raw ||
      payload + compressed > start ||
      (directory && (compressed || expanded))
    )
      throw new Error("The ZIP file paths or sizes do not match.");
    if (!directory) {
      const maximum = /\.(md|markdown)$/i.test(path)
        ? portableLimits.noteBytes
        : portableLimits.attachmentBytes;
      if (expanded > maximum || (method === 0 && compressed !== expanded))
        throw new Error("A note or attachment exceeds the import size limit.");
      total += expanded;
      if (
        total > portableLimits.expandedBytes ||
        expected.size >= portableLimits.files
      )
        throw new Error(
          "Import at most 400 files and 24 MB of expanded content at a time.",
        );
      expected.set(raw, { size: expanded, crc: u32(offset + 16) });
    }
    offset = next;
  }
  if (offset !== end) throw new Error("The ZIP directory is damaged.");
  const unpacked = new Map<string, Uint8Array>();
  let failure: Error | null = null;
  const started = new Set<string>();
  const unzip = new Unzip((file) => {
    const item = expected.get(file.name);
    if (!item) return;
    if (started.has(file.name)) {
      failure = new Error("The ZIP contains duplicate file headers.");
      return;
    }
    started.add(file.name);
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = new Error("The ZIP contents could not be read.");
        file.terminate();
        return;
      }
      size += chunk.length;
      if (size > item.size) {
        failure = new Error("The ZIP expanded beyond its declared size.");
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        const data = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          data.set(part, offset);
          offset += part.length;
        }
        unpacked.set(file.name, data);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Bound each inflate step as well as declared sizes. A lying ZIP header
    // cannot make the decompressor allocate its entire expanded payload.
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      unzip.push(
        bytes.subarray(offset, offset + 1024),
        offset + 1024 >= bytes.length,
      );
      if (failure) throw failure;
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("The ZIP contents could not be read.");
  }
  const result: PortableFile[] = [];
  for (const [raw, item] of expected) {
    const data = unpacked.get(raw);
    if (!data || data.length !== item.size || crc32(data) !== item.crc)
      throw new Error("The ZIP contains incomplete or damaged files.");
    result.push({ path: portablePath(raw), bytes: data });
  }
  return result;
}

export function packPortableZip(files: PortableFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const path = portablePath(file.path);
    total += file.bytes.length;
    if (total > portableLimits.expandedBytes || Object.hasOwn(entries, path))
      throw new Error("Export at most 24 MB with distinct file paths.");
    entries[path] = file.bytes;
  }
  // Stored files make export predictable on memory-limited browsers and workers.
  return zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1) });
}

function scalar(value: string): unknown {
  const text = value.trim();
  if (!text) return "";
  if (
    /^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(text) ||
    /^["[{]/.test(text)
  ) {
    try {
      return JSON.parse(text);
    } catch {
      /* Plain YAML text below. */
    }
  }
  if (text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replace(/''/g, "'");
  if (/^[!&*|>]/.test(text))
    throw new Error("This frontmatter uses advanced YAML.");
  return text;
}

function frontmatter(text: string, warnings: string[], path: string) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(clean);
  if (!match) return { metadata: {} as Record<string, unknown>, body: clean };
  const metadata: Record<string, unknown> = Object.create(null);
  try {
    let listKey = "";
    for (const line of match[1].split("\n")) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const list = /^\s+-\s+(.*)$/.exec(line);
      if (list && listKey && Array.isArray(metadata[listKey])) {
        (metadata[listKey] as unknown[]).push(scalar(list[1]));
        continue;
      }
      const item = /^([A-Za-z][A-Za-z0-9_-]{0,79}):\s*(.*)$/.exec(line);
      if (!item || dangerous.has(item[1]) || Object.hasOwn(metadata, item[1]))
        throw new Error("Unsupported frontmatter.");
      metadata[item[1]] = item[2].trim() ? scalar(item[2]) : [];
      listKey = item[2].trim() ? "" : item[1];
    }
    return { metadata, body: clean.slice(match[0].length) };
  } catch {
    warnings.push(
      `${path}: advanced frontmatter is kept in the note body for review.`,
    );
    return { metadata: {} as Record<string, unknown>, body: clean };
  }
}

const mediaTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};
export function portableMediaType(path: string) {
  return (
    mediaTypes[path.split(".").at(-1)?.toLowerCase() || ""] ||
    "application/octet-stream"
  );
}

export function readPortableBundle(files: PortableFile[]): PortableBundle {
  if (!files.length || files.length > portableLimits.files)
    throw new Error("Choose a folder or ZIP with 1–400 files.");
  const bundle: PortableBundle = {
    notes: [],
    attachments: [],
    noteTypes: [],
    relationships: [],
    warnings: [],
  };
  const wrappedManifest = files.find((file) =>
    file.path.endsWith(`/${manifestPath}`),
  );
  if (wrappedManifest) {
    const prefix = wrappedManifest.path.slice(0, -manifestPath.length);
    if (files.every((file) => file.path.startsWith(prefix)))
      files = files.map((file) => ({
        ...file,
        path: file.path.slice(prefix.length),
      }));
  }
  let attachmentMetadata: unknown;
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    file.path = portablePath(file.path);
    const key = file.path.toLocaleLowerCase("en-US");
    if (names.has(key))
      throw new Error("Choose distinct folder paths, including letter case.");
    names.add(key);
    total += file.bytes.length;
    if (total > portableLimits.expandedBytes)
      throw new Error("Import at most 24 MB of content at a time.");
    if (file.path === manifestPath) {
      if (file.bytes.length > portableLimits.noteBytes)
        throw new Error("The portable manifest is too large.");
      let manifest: {
        format?: unknown;
        version?: unknown;
        noteTypes?: unknown;
        relationships?: unknown;
        attachments?: unknown;
      };
      try {
        manifest = JSON.parse(decoder.decode(file.bytes));
      } catch {
        throw new Error("The portable manifest is damaged.");
      }
      if (
        !manifest ||
        typeof manifest !== "object" ||
        manifest.format !== "projectanvil-markdown" ||
        manifest.version !== 1
      )
        throw new Error("This portable manifest version is not supported.");
      if (
        !Array.isArray(manifest.noteTypes) ||
        !Array.isArray(manifest.relationships) ||
        manifest.noteTypes.length > 100 ||
        manifest.relationships.length > 2000
      )
        throw new Error("The portable manifest collections are invalid.");
      bundle.noteTypes = manifest.noteTypes as NoteType[];
      bundle.relationships =
        manifest.relationships as PortableBundle["relationships"];
      attachmentMetadata = manifest.attachments;
    } else if (/\.(md|markdown)$/i.test(file.path)) {
      if (
        file.bytes.length > portableLimits.noteBytes ||
        bundle.notes.length >= portableLimits.notes
      )
        throw new Error(
          "Import at most 200 notes, each under 100,000 characters.",
        );
      let text: string;
      try {
        text = decoder.decode(file.bytes);
      } catch {
        throw new Error(
          `${file.path}: save this note as UTF-8 before importing.`,
        );
      }
      const parsed = frontmatter(text, bundle.warnings, file.path);
      if (parsed.body.length > 100_000)
        throw new Error(
          `${file.path}: keep the note under 100,000 characters.`,
        );
      const title =
        typeof parsed.metadata.title === "string" &&
        parsed.metadata.title.trim()
          ? parsed.metadata.title.trim()
          : file.path
              .split("/")
              .at(-1)!
              .replace(/\.(md|markdown)$/i, "");
      if (title.length > 300)
        throw new Error(`${file.path}: keep titles under 300 characters.`);
      bundle.notes.push({
        path: file.path,
        title,
        body: parsed.body,
        metadata: parsed.metadata,
      });
    } else {
      if (
        !file.bytes.length ||
        file.bytes.length > portableLimits.attachmentBytes
      )
        throw new Error(
          `${file.path}: choose a nonempty attachment smaller than 20 MB.`,
        );
      bundle.attachments.push(file);
    }
  }
  if (!bundle.notes.length)
    throw new Error(
      "Choose a folder or ZIP containing Markdown notes (.md or .markdown).",
    );
  if (attachmentMetadata !== undefined) {
    if (
      !Array.isArray(attachmentMetadata) ||
      attachmentMetadata.length > portableLimits.files
    )
      throw new Error("The attachment manifest is invalid.");
    const names = new Set<string>();
    for (const value of attachmentMetadata) {
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.path !== "string" ||
        typeof value.name !== "string" ||
        !value.name ||
        value.name.length > 240 ||
        /[\x00-\x1f\x7f]/.test(value.name) ||
        typeof value.type !== "string" ||
        !/^[A-Za-z0-9.+_-]+\/[A-Za-z0-9.+_-]+$/.test(value.type) ||
        value.type.length > 150 ||
        names.has(value.path)
      )
        throw new Error("The attachment manifest is invalid.");
      names.add(value.path);
      const file = bundle.attachments.find((file) => file.path === value.path);
      if (!file)
        throw new Error("An attachment listed in the manifest is missing.");
      file.name = value.name;
      file.type = value.type;
    }
  }
  if (
    bundle.attachments.some((file) =>
      /\.(html?|js|mjs|cjs|exe|com|bat|cmd|ps1|sh|lnk|url|dll)$/i.test(
        file.path,
      ),
    )
  )
    bundle.warnings.push(
      "Executable and webpage attachments download as files; the app does not execute them.",
    );
  bundle.warnings.push(
    "Imported notes are new copies. Existing work, account access, histories, and task assignments are not replaced.",
  );
  return bundle;
}

function safeSegment(value: string) {
  const cleaned =
    value
      .normalize("NFC")
      .replace(/[\\/:*?"<>|#^()[\]!\x00-\x1f\x7f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 90) || "Untitled";
  try {
    portablePath(cleaned);
    return cleaned;
  } catch {
    return `_${cleaned}`;
  }
}
function relativePath(from: string, to: string) {
  const left = from.split("/").slice(0, -1),
    right = to.split("/");
  while (left.length && right.length && left[0] === right[0]) {
    left.shift();
    right.shift();
  }
  return [...left.map(() => ".."), ...right].join("/");
}
function resolveRelative(from: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.replace(/^<|>$/g, ""));
  } catch {
    return null;
  }
  if (
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(decoded) ||
    decoded.includes("\\")
  )
    return null;
  const segments = from.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "." || !segment) continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  try {
    return portablePath(segments.join("/"));
  } catch {
    return null;
  }
}
function outsideCode(text: string, transform: (text: string) => string) {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
    .map((part, index) => (index % 2 ? part : transform(part)))
    .join("");
}

export function exportPortableNotes(workspace: Workspace): {
  files: PortableFile[];
  attachmentPaths: Map<string, string>;
} {
  const paths = new Map<string, string>(),
    used = new Set<string>();
  for (const note of workspace.notes) {
    const folder = note.folder
      .split(/[\\/]/)
      .filter(Boolean)
      .slice(0, 6)
      .map(safeSegment);
    let path = [...folder, `${safeSegment(note.title)}.md`].join("/");
    let counter = 2;
    while (used.has(path.toLocaleLowerCase("en-US")))
      path = [...folder, `${safeSegment(note.title)} (${counter++}).md`].join(
        "/",
      );
    portablePath(path);
    used.add(path.toLocaleLowerCase("en-US"));
    paths.set(note.id, path);
  }
  const attachmentPaths = new Map<string, string>();
  for (const media of workspace.media)
    attachmentPaths.set(
      media.id,
      `attachments/${media.id}-${safeSegment(media.name.replace(/\.[A-Za-z0-9]{1,10}$/, "")).slice(0, 75)}${/\.[A-Za-z0-9]{1,10}$/.exec(media.name)?.[0] || ""}`,
    );
  const notesByTitle = new Map(
    workspace.notes.map((note) => [
      note.title.toLocaleLowerCase("en-US"),
      note,
    ]),
  );
  const files: PortableFile[] = workspace.notes.map((note) => {
    const path = paths.get(note.id)!;
    const rewrite = (text: string) =>
      outsideCode(text, (part) =>
        part
          .replace(/\[\[([^\]\n]+)\]\]/g, (full, inner: string) => {
            const [target, ...alias] = inner.split("|");
            const split = target.search(/[#^]/),
              title = (split < 0 ? target : target.slice(0, split)).trim(),
              suffix = split < 0 ? "" : target.slice(split);
            const linked = notesByTitle.get(title.toLocaleLowerCase("en-US"));
            return linked
              ? `[[${relativePath(path, paths.get(linked.id)!).replace(/\.md$/, "")}${suffix}${alias.length ? `|${alias.join("|")}` : `|${title}`}]]`
              : full;
          })
          .replace(
            /\/api\/media\/([A-Za-z0-9_-]+)(?:\?workspace=[A-Za-z0-9_-]+)?/g,
            (full, id: string) =>
              attachmentPaths.has(id)
                ? encodeURI(relativePath(path, attachmentPaths.get(id)!))
                : full,
          ),
      );
    const content = rewrite(note.content);
    const rewriteValues = (values: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, rewrite(value)]),
      );
    const metadata = {
      title: note.title,
      tags: note.tags,
      kind: note.kind,
      bookmarked: note.bookmarked,
      properties: rewriteValues(note.properties),
      customTypeId: note.customTypeId || "",
      propertyValues: rewriteValues(note.propertyValues || {}),
      decision: note.decision
        ? {
            ...note.decision,
            context: rewrite(note.decision.context),
            options: rewrite(note.decision.options),
            outcome: rewrite(note.decision.outcome),
            consequences: rewrite(note.decision.consequences),
          }
        : null,
      sourceId: note.id,
    };
    const front = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n");
    return { path, bytes: encoder.encode(`---\n${front}\n---\n\n${content}`) };
  });
  const noteIds = new Set(workspace.notes.map((note) => note.id));
  const typeIds = new Set(workspace.notes.map((note) => note.customTypeId));
  const manifest = {
    format: "projectanvil-markdown",
    version: 1,
    noteTypes: (workspace.noteTypes || []).filter((type) =>
      typeIds.has(type.id),
    ),
    relationships: workspace.relationships
      .filter(
        (link) =>
          link.from.type === "note" &&
          link.to.type === "note" &&
          noteIds.has(link.from.id) &&
          noteIds.has(link.to.id),
      )
      .map((link) => ({
        from: link.from.id,
        to: link.to.id,
        kind: link.kind,
        label: link.label,
      })),
    attachments: workspace.media.map((file) => ({
      path: attachmentPaths.get(file.id),
      name: file.name,
      type: /^[A-Za-z0-9.+_-]+\/[A-Za-z0-9.+_-]+$/.test(file.type)
        ? file.type
        : portableMediaType(file.name),
    })),
  };
  files.push({
    path: manifestPath,
    bytes: encoder.encode(JSON.stringify(manifest, null, 2)),
  });
  return { files, attachmentPaths };
}

function textMap(value: unknown, max = 50): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (
    entries.length > max ||
    entries.some(
      ([key, item]) =>
        dangerous.has(key) ||
        key.length > 80 ||
        typeof item !== "string" ||
        item.length > 2000,
    )
  )
    throw new Error(
      "Some imported properties exceed the note property limits.",
    );
  return Object.fromEntries(entries) as Record<string, string>;
}

export function planPortableImport(
  bundle: PortableBundle,
  workspace: Workspace,
  projectId: string,
  ids: Map<string, string>,
  now: string,
) {
  const titles = new Set(
    workspace.notes.map((note) => note.title.toLocaleLowerCase("en-US")),
  );
  const titleByPath = new Map<string, string>(),
    sourceIds = new Map<string, string>();
  const warnings = [...bundle.warnings];
  for (const source of bundle.notes) {
    let title = source.title,
      counter = 2;
    while (titles.has(title.toLocaleLowerCase("en-US")))
      title = `${source.title.slice(0, 280)} (imported ${counter++})`;
    titles.add(title.toLocaleLowerCase("en-US"));
    titleByPath.set(source.path, title);
    if (title !== source.title)
      warnings.push(
        `${source.path}: saved as “${title}” to keep existing notes.`,
      );
    if (typeof source.metadata.sourceId === "string") {
      if (sourceIds.has(source.metadata.sourceId))
        throw new Error("Portable source note identifiers must be distinct.");
      sourceIds.set(source.metadata.sourceId, ids.get(source.path)!);
    }
  }
  const fileByPath = new Map(
    bundle.attachments.map((file) => [file.path, file]),
  );
  const typeIds = new Map<string, string>();
  const typeNames = new Set(
    (workspace.noteTypes || []).map((type) =>
      type.name.toLocaleLowerCase("en-US"),
    ),
  );
  const noteTypes = bundle.noteTypes.map((type, index) => {
    if (
      !type ||
      typeof type !== "object" ||
      typeof type.id !== "string" ||
      typeof type.name !== "string" ||
      !type.name.trim() ||
      typeIds.has(type.id)
    )
      throw new Error("The portable note types are invalid.");
    const id = ids.get(`type:${index}`)!;
    typeIds.set(type.id, id);
    let name = type.name,
      counter = 2;
    while (typeNames.has(name.toLocaleLowerCase("en-US")))
      name = `${type.name.slice(0, 280)} (imported ${counter++})`;
    typeNames.add(name.toLocaleLowerCase("en-US"));
    return {
      ...type,
      id,
      name,
      fields: Array.isArray(type.fields)
        ? type.fields.map((field) => ({ ...field }))
        : type.fields,
    };
  });
  const findNote = (source: PortableNote, target: string) => {
    const split = target.search(/[#^]/),
      raw = split < 0 ? target : target.slice(0, split),
      suffix = split < 0 ? "" : target.slice(split);
    const relative = resolveRelative(source.path, raw);
    const path = [
      relative,
      relative && `${relative}.md`,
      relative && `${relative}.markdown`,
      raw,
      `${raw}.md`,
      `${raw}.markdown`,
    ].find((candidate) => candidate && titleByPath.has(candidate));
    const byTitle = bundle.notes.filter(
      (note) =>
        note.title.toLocaleLowerCase("en-US") ===
        raw.trim().toLocaleLowerCase("en-US"),
    );
    return path
      ? { title: titleByPath.get(path)!, suffix }
      : byTitle.length === 1
        ? { title: titleByPath.get(byTitle[0].path)!, suffix }
        : null;
  };
  const notes: Note[] = bundle.notes.map((source) => {
    const rewrite = (text: string) => {
      const single = resolveRelative(source.path, text.trim());
      if (single && fileByPath.has(single))
        return `/api/media/${ids.get(single)}`;
      return outsideCode(text, (part) =>
        part
          .replace(
            /(!?)\[\[([^\]\n]+)\]\]/g,
            (full, embed: string, inner: string) => {
              const [target, ...aliases] = inner.split("|");
              const linked = findNote(source, target);
              if (linked)
                return `${embed}[[${linked.title}${linked.suffix}${aliases.length ? `|${aliases.join("|")}` : ""}]]`;
              const file = resolveRelative(source.path, target) || target;
              if (fileByPath.has(file))
                return `${embed ? "!" : ""}[${aliases[0] || file.split("/").at(-1)}](/api/media/${ids.get(file)})`;
              return full;
            },
          )
          .replace(
            /(!?\[[^\]\n]*\])\((<[^>\n]+>|[^\s)]+)(\s+"[^"\n]*")?\)/g,
            (full, label: string, target: string, caption = "") => {
              const fragment = target.indexOf("#"),
                raw = fragment < 0 ? target : target.slice(0, fragment),
                suffix = fragment < 0 ? "" : target.slice(fragment);
              const path = resolveRelative(source.path, raw);
              if (path && fileByPath.has(path))
                return `${label}(/api/media/${ids.get(path)}${caption})`;
              const linked = path && findNote(source, target);
              if (linked && !label.startsWith("!"))
                return `[[${linked.title}${suffix}|${label.slice(1, -1)}]]`;
              return full;
            },
          ),
      );
    };
    let body = rewrite(source.body);
    if (body.startsWith("\n")) body = body.slice(1);
    const metadata = source.metadata;
    const kinds = [
      "note",
      "world",
      "character",
      "research",
      "daily",
      "meeting",
      "decision",
    ];
    const kind = kinds.includes(String(metadata.kind))
      ? (metadata.kind as Note["kind"])
      : "note";
    let decision: DecisionRecord | null =
      kind === "decision" ? emptyDecision() : null;
    if (
      metadata.decision &&
      typeof metadata.decision === "object" &&
      !Array.isArray(metadata.decision)
    ) {
      const value = metadata.decision as DecisionRecord;
      decision = {
        ...value,
        context:
          typeof value.context === "string"
            ? rewrite(value.context)
            : value.context,
        options:
          typeof value.options === "string"
            ? rewrite(value.options)
            : value.options,
        outcome:
          typeof value.outcome === "string"
            ? rewrite(value.outcome)
            : value.outcome,
        consequences:
          typeof value.consequences === "string"
            ? rewrite(value.consequences)
            : value.consequences,
        ownerId: "",
        supersededById: sourceIds.get(value.supersededById) || "",
      };
      if (decision.status === "superseded" && !decision.supersededById)
        decision.status = "proposed";
    }
    const tags = Array.isArray(metadata.tags)
      ? metadata.tags
      : typeof metadata.tags === "string"
        ? metadata.tags.split(/[, ]+/).filter(Boolean)
        : [];
    if (tags.some((tag) => typeof tag !== "string"))
      throw new Error("Imported note tags must be text.");
    const properties = Object.fromEntries(
      Object.entries(textMap(metadata.properties)).map(([key, value]) => [
        key,
        rewrite(value),
      ]),
    );
    for (const [key, value] of Object.entries(metadata))
      if (
        ![
          "title",
          "tags",
          "kind",
          "bookmarked",
          "properties",
          "customTypeId",
          "propertyValues",
          "decision",
          "sourceId",
        ].includes(key) &&
        !dangerous.has(key)
      ) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (text.length <= 2000) properties[key] = text;
      }
    const customTypeId =
      typeof metadata.customTypeId === "string"
        ? typeIds.get(metadata.customTypeId) || ""
        : "";
    return {
      id: ids.get(source.path)!,
      title: titleByPath.get(source.path)!,
      content: body,
      folder: source.path.split("/").slice(0, -1).join("/").slice(0, 300),
      tags: tags as string[],
      projectId,
      kind,
      customTypeId,
      propertyValues: customTypeId
        ? Object.fromEntries(
            Object.entries(textMap(metadata.propertyValues, 30)).map(
              ([key, value]) => [key, rewrite(value)],
            ),
          )
        : {},
      decision,
      bookmarked: metadata.bookmarked === true,
      properties,
      snapshots: [],
      createdAt: now,
      updatedAt: now,
    };
  });
  const media: Media[] = bundle.attachments.map((file) => ({
    id: ids.get(file.path)!,
    name: file.name || file.path.split("/").at(-1)!,
    type: file.type || portableMediaType(file.path),
    size: file.bytes.length,
    url: `/api/media/${ids.get(file.path)}`,
    projectId,
    createdAt: now,
  }));
  const relationships: Relationship[] = bundle.relationships.map(
    (link, index) => {
      if (
        !link ||
        typeof link !== "object" ||
        !sourceIds.has(link.from) ||
        !sourceIds.has(link.to)
      )
        throw new Error(
          "A portable relationship points to a missing imported note.",
        );
      return {
        id: ids.get(`relationship:${index}`)!,
        from: { type: "note", id: sourceIds.get(link.from)! },
        to: { type: "note", id: sourceIds.get(link.to)! },
        kind: link.kind,
        label: link.label,
        createdAt: now,
        reviewedAt: now,
        fromSignature: "",
        toSignature: "",
      };
    },
  );
  return { notes, media, noteTypes, relationships, warnings };
}
