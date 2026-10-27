import type { DraftRecord } from "./draft-store";
import type { Note, Priority } from "./types";
import { isDecisionDraft } from "./note-structures";
import {
  instantiateNoteTemplate,
  type PersonalTemplate,
} from "./personal-templates";

import { noteTemplateIds, type NoteTemplateId } from "./note-template-catalog";
export { noteTemplateIds, type NoteTemplateId } from "./note-template-catalog";

export interface NewNoteDraft {
  title: string;
  templateId: NoteTemplateId;
  candidate?: Note;
  operationId?: string;
  personalTemplateId?: string;
}

/** Stage reusable content for review; the caller still owns explicit creation. */
export function stagePersonalNoteTemplate(
  template: PersonalTemplate & { kind: "note" },
  notes: Pick<Note, "title">[],
  projectId = "",
): NewNoteDraft {
  const titles = new Set(notes.map((note) => note.title.trim().toLowerCase()));
  const original =
    template.content.title.trim() || template.name.trim() || "Untitled note";
  let title = original.slice(0, 300);
  let number = 1;
  while (titles.has(title.toLowerCase())) {
    const suffix = number === 1 ? " (copy)" : ` (copy ${number})`;
    title = `${original.slice(0, 300 - suffix.length)}${suffix}`;
    number++;
  }
  const candidate = instantiateNoteTemplate(template.content, { projectId });
  return {
    title,
    templateId: "blank",
    candidate: { ...candidate, title },
    operationId: crypto.randomUUID(),
    personalTemplateId: template.id,
  };
}

export interface LinkedTaskDraft {
  title: string;
  excerpt: string;
  projectId: string;
  assigneeId: string;
  priority: Priority;
  taskId: string;
  operationId: string;
  createdAt: string;
}

export interface NoteCopyDraft {
  note: Note;
  operationId: string;
}

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
}

function reference(value: unknown): value is string {
  return value === "" || identifier(value);
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Validate browser input before exposing it to rendering or editor operations. */
export function isRecoverableNote(value: unknown): value is Note {
  if (
    !object(value) ||
    !identifier(value.id) ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    typeof value.folder !== "string" ||
    !reference(value.projectId) ||
    typeof value.bookmarked !== "boolean" ||
    typeof value.kind !== "string" ||
    ![
      "note",
      "world",
      "character",
      "research",
      "daily",
      "meeting",
      "decision",
    ].includes(value.kind) ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    !object(value.properties) ||
    !Object.values(value.properties).every(
      (property) => typeof property === "string",
    ) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !Array.isArray(value.snapshots)
  )
    return false;
  if (value.customTypeId !== undefined && !reference(value.customTypeId))
    return false;
  if (
    value.propertyValues !== undefined &&
    (!object(value.propertyValues) ||
      !Object.values(value.propertyValues).every(
        (property) => typeof property === "string",
      ))
  )
    return false;
  if (
    value.decision !== undefined &&
    value.decision !== null &&
    !isDecisionDraft(value.decision)
  )
    return false;
  return value.snapshots.every(
    (snapshot) =>
      object(snapshot) &&
      identifier(snapshot.id) &&
      typeof snapshot.content === "string" &&
      timestamp(snapshot.savedAt),
  );
}

export function isRecoverableNoteRecord(
  record: DraftRecord<unknown, unknown>,
  storedId: string,
): record is DraftRecord<Note> {
  return (
    isRecoverableNote(record.value) &&
    isRecoverableNote(record.baseline) &&
    record.value.id === storedId &&
    record.baseline.id === storedId
  );
}

export function parseNewNoteDraft(value: unknown): NewNoteDraft | null {
  if (
    !object(value) ||
    typeof value.title !== "string" ||
    typeof value.templateId !== "string" ||
    !noteTemplateIds.includes(value.templateId as NoteTemplateId)
  )
    return null;
  if (value.candidate !== undefined && !isRecoverableNote(value.candidate))
    return null;
  if (value.operationId !== undefined && !identifier(value.operationId))
    return null;
  if (
    value.personalTemplateId !== undefined &&
    !identifier(value.personalTemplateId)
  )
    return null;
  if ((value.candidate === undefined) !== (value.operationId === undefined))
    return null;
  if (value.personalTemplateId !== undefined && value.candidate === undefined)
    return null;
  return value as unknown as NewNoteDraft;
}

export function parseLinkedTaskDraft(value: unknown): LinkedTaskDraft | null {
  if (
    !object(value) ||
    typeof value.title !== "string" ||
    typeof value.excerpt !== "string" ||
    !reference(value.projectId) ||
    !reference(value.assigneeId) ||
    typeof value.priority !== "string" ||
    !["urgent", "high", "medium", "low"].includes(value.priority) ||
    !identifier(value.taskId) ||
    !identifier(value.operationId) ||
    !timestamp(value.createdAt)
  )
    return null;
  return value as unknown as LinkedTaskDraft;
}

export function parseNoteCopyDraft(value: unknown): NoteCopyDraft | null {
  return object(value) &&
    isRecoverableNote(value.note) &&
    identifier(value.operationId)
    ? (value as unknown as NoteCopyDraft)
    : null;
}
