import type { Note, Task } from "./types";
import { decisionReasoningMarkdown, emptyDecision } from "./note-structures";

export interface TaskTemplateContent {
  title: string;
  description: string;
  type: Task["type"];
  priority: Task["priority"];
  estimate: number;
  tags: string[];
  subtasks: string[];
}

export interface NoteTemplateContent {
  title: string;
  content: string;
  kind: Note["kind"];
  folder: string;
  tags: string[];
  properties: Record<string, string>;
}

export type TemplateInput =
  | { id: string; name: string; kind: "task"; content: TaskTemplateContent }
  | { id: string; name: string; kind: "note"; content: NoteTemplateContent };

export type PersonalTemplate = TemplateInput & {
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
};

/** Personal templates can travel between workspaces; uploaded files cannot. */
export function omitPrivateAttachments(text: string): string {
  return text
    .replace(
      /!?\[[^\]\n]*\]\([^\)\n]*\/api\/media\/[^\)\n]*\)/gi,
      "[Attachment omitted]",
    )
    .replace(
      /(?:https?:\/\/[^\s<>"'()\]]+)?\/api\/media\/[^\s<>"'()\]]+/gi,
      "[Attachment omitted]",
    );
}

export function taskTemplateContent(task: Task): TaskTemplateContent {
  return {
    title: task.title,
    description: omitPrivateAttachments(task.description),
    type: task.type,
    priority: task.priority,
    estimate: task.estimate,
    tags: [...task.tags],
    subtasks: task.subtasks.map((item) => item.title),
  };
}

export function noteTemplateContent(note: Note): NoteTemplateContent {
  return {
    title: note.title,
    content: omitPrivateAttachments(
      [
        note.decision ? decisionReasoningMarkdown(note.decision) : "",
        note.content,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    kind: note.kind,
    folder: note.folder,
    tags: [...note.tags],
    properties: Object.fromEntries(
      Object.entries(note.properties).map(([key, value]) => [
        key,
        omitPrivateAttachments(value),
      ]),
    ),
  };
}

export function instantiateTaskTemplate(
  content: TaskTemplateContent,
  context: { projectId?: string; assigneeId?: string } = {},
): Task {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    key: "",
    title: content.title,
    description: omitPrivateAttachments(content.description),
    type: content.type,
    priority: content.priority,
    estimate: content.estimate,
    tags: [...content.tags],
    subtasks: content.subtasks.map((title) => ({
      id: crypto.randomUUID(),
      title,
      done: false,
    })),
    status: "todo",
    projectId: context.projectId || "",
    assigneeId: context.assigneeId || "",
    startDate: "",
    dueDate: "",
    noteIds: [],
    blockedBy: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function instantiateNoteTemplate(
  content: NoteTemplateContent,
  context: { projectId?: string } = {},
): Note {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ...structuredClone(content),
    content: omitPrivateAttachments(content.content),
    properties: Object.fromEntries(
      Object.entries(content.properties).map(([key, value]) => [
        key,
        omitPrivateAttachments(value),
      ]),
    ),
    projectId: context.projectId || "",
    bookmarked: false,
    customTypeId: "",
    propertyValues: {},
    decision: content.kind === "decision" ? emptyDecision() : null,
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}
