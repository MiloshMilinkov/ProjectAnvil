import * as Y from "yjs";

export const collaborativeTextLimit = 100_000;
export const collaborativeUpdateLimit = 1_000_000;
export interface NoteCollaborationState {
  noteId: string;
  generation: string;
  update: string;
  stateVector: string;
  content: string;
  revision: number;
  canEdit: boolean;
  peers: { id: string; name: string }[];
}
export interface CollaborativeDraft {
  noteId?: string;
  generation: string;
  update: string;
  content: string;
}

export function encodeDocumentUpdate(update: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < update.length; offset += 8192)
    binary += String.fromCharCode(...update.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function decodeDocumentUpdate(value: string): Uint8Array {
  if (
    !value ||
    value.length > Math.ceil(collaborativeUpdateLimit / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("The shared note update is invalid or too large.");
  const binary = atob(value);
  if (binary.length > collaborativeUpdateLimit)
    throw new Error("The shared note update is too large.");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createTextDocument(content: string): Y.Doc {
  if (content.length > collaborativeTextLimit)
    throw new Error("Keep a single note under 100,000 characters.");
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      content,
    )
  )
    throw new Error(
      "This note contains an incomplete Unicode character. Fix it in the note editor before starting shared editing.",
    );
  const doc = new Y.Doc();
  if (content) doc.getText("content").insert(0, content);
  else doc.getText("content");
  return doc;
}

/** Reject unrelated shared structures; the endpoint only accepts plain Markdown. */
export function documentText(doc: Y.Doc): string {
  if ([...doc.share.keys()].some((key) => key !== "content"))
    throw new Error("A shared note update can only contain note text.");
  const text = doc.getText("content");
  if (
    text
      .toDelta()
      .some(
        (part: { insert?: unknown; attributes?: unknown }) =>
          typeof part.insert !== "string" || part.attributes,
      )
  )
    throw new Error("A shared note update must contain plain Markdown text.");
  const content = text.toString();
  if (content.length > collaborativeTextLimit)
    throw new Error("Keep a single note under 100,000 characters.");
  return content;
}

export function serializedDocument(doc: Y.Doc): string {
  documentText(doc);
  const update = Y.encodeStateAsUpdate(doc);
  if (update.length > collaborativeUpdateLimit)
    throw new Error(
      "This shared editing session has reached its history limit. Save your text and restart the session from the note's saved version.",
    );
  return encodeDocumentUpdate(update);
}

/** Small replacement deltas preserve concurrent inserts instead of replacing all text. */
export function replaceCollaborativeText(doc: Y.Doc, next: string): void {
  if (next.length > collaborativeTextLimit)
    throw new Error("Keep a single note under 100,000 characters.");
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      next,
    )
  )
    throw new Error(
      "Finish entering this Unicode character before syncing the note.",
    );
  const text = doc.getText("content"),
    previous = text.toString();
  if (previous === next) return;
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  )
    prefix++;
  // Y.Text indexes UTF-16 units, but splitting a surrogate pair would corrupt emoji.
  if (
    prefix > 0 &&
    /[\uD800-\uDBFF]/.test(previous[prefix - 1]) &&
    /[\uDC00-\uDFFF]/.test(previous[prefix] || "")
  )
    prefix--;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  if (
    suffix > 0 &&
    /[\uDC00-\uDFFF]/.test(previous[previous.length - suffix]) &&
    /[\uD800-\uDBFF]/.test(previous[previous.length - suffix - 1] || "")
  )
    suffix--;
  doc.transact(() => {
    const removed = previous.length - prefix - suffix;
    if (removed) text.delete(prefix, removed);
    const inserted = next.slice(prefix, next.length - suffix);
    if (inserted) text.insert(prefix, inserted);
  }, "local");
}

export function parseCollaborativeDraft(
  value: unknown,
): CollaborativeDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<CollaborativeDraft>;
  if (
    (draft.noteId !== undefined &&
      (typeof draft.noteId !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(draft.noteId))) ||
    typeof draft.generation !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(draft.generation) ||
    typeof draft.content !== "string" ||
    draft.content.length > collaborativeTextLimit ||
    typeof draft.update !== "string"
  )
    return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, decodeDocumentUpdate(draft.update));
    return documentText(doc) === draft.content
      ? (draft as CollaborativeDraft)
      : null;
  } catch {
    return null;
  } finally {
    doc.destroy();
  }
}
