import { z } from "zod";
import type { Note, NotePropertyField, Workspace } from "./types";
import { isCalendarDate } from "./reminder-time";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const reference = z.union([id, z.literal("")]);
const named = (maximum: number) => z.string().trim().min(1).max(maximum);
const uniqueIds = <T extends { id: string }>(items: T[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
const date = z
  .string()
  .refine((value) => !value || isCalendarDate(value), "Choose a valid date.");
const field = z
  .object({
    id,
    name: named(80),
    type: z.enum(["text", "number", "date", "checkbox", "select"]),
    required: z.boolean().default(false),
    options: z.array(named(100)).max(50).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.options.map((option) => option.toLocaleLowerCase()))
        .size !== value.options.length
    )
      context.addIssue({
        code: "custom",
        message: "Select choices must be unique.",
      });
    if (value.type === "select" && !value.options.length)
      context.addIssue({
        code: "custom",
        message: "Add at least one select choice.",
      });
    if (value.type !== "select" && value.options.length)
      context.addIssue({
        code: "custom",
        message: "Choices are only available for select fields.",
      });
  });
export const noteTypesSchema = z
  .object({
    id,
    name: named(100),
    description: z.string().max(2000).default(""),
    archived: z.boolean().default(false),
    fields: z
      .array(field)
      .max(30)
      .refine(uniqueIds, "Property IDs must be unique.")
      .refine(
        (values) =>
          new Set(values.map((value) => value.name.toLocaleLowerCase()))
            .size === values.length,
        "Property names must be unique.",
      ),
  })
  .strict();

export const decisionSchema = z
  .object({
    status: z.enum(["proposed", "accepted", "rejected", "superseded"]),
    context: z.string().max(10_000),
    options: z.string().max(10_000),
    outcome: z.string().max(10_000),
    consequences: z.string().max(10_000),
    decidedOn: date,
    ownerId: reference,
    supersededById: reference,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "accepted" &&
      (!value.outcome.trim() || !value.decidedOn)
    )
      context.addIssue({
        code: "custom",
        message: "An accepted decision needs an outcome and decision date.",
      });
    if (value.status === "superseded" && !value.supersededById)
      context.addIssue({
        code: "custom",
        message: "Choose the decision that replaces this one.",
      });
    if (value.status !== "superseded" && value.supersededById)
      context.addIssue({
        code: "custom",
        message: "Only superseded decisions can have a replacement.",
      });
  });

export const relationshipPresetsSchema = z
  .object({
    id,
    name: named(100),
    description: z.string().max(2000).default(""),
    kind: z.enum(["depends-on", "supports", "contradicts", "decided-because"]),
    label: z.string().max(300).default(""),
    fromType: z.enum(["any", "note", "task", "project"]).default("any"),
    toType: z.enum(["any", "note", "task", "project"]).default("any"),
    archived: z.boolean().default(false),
  })
  .strict();

export const brainstormsSchema = z
  .object({
    id,
    title: named(300),
    description: z.string().max(10_000).default(""),
    projectId: reference.default(""),
    groups: z
      .array(z.object({ id, title: named(300) }).strict())
      .max(30)
      .refine(uniqueIds, "Group IDs must be unique.")
      .default([]),
    ideas: z
      .array(
        z
          .object({
            id,
            title: named(300),
            description: z.string().max(10_000).default(""),
            groupId: reference.default(""),
            noteId: reference.default(""),
            taskId: reference.default(""),
            votes: z
              .array(id)
              .max(501)
              .refine(
                (values) => new Set(values).size === values.length,
                "Each person can vote once per idea.",
              )
              .default([]),
          })
          .strict(),
      )
      .max(200)
      .refine(uniqueIds, "Idea IDs must be unique.")
      .default([]),
    votingOpen: z.boolean().default(true),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export { emptyDecision } from "./note-structures";

export function propertyValueError(
  field: NotePropertyField,
  value: string,
): string {
  if (!value.trim()) return "";
  if (
    field.type === "number" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  )
    return `“${field.name}” needs a number.`;
  if (field.type === "number" && !Number.isFinite(Number(value)))
    return `“${field.name}” needs a finite number.`;
  if (field.type === "date" && !isCalendarDate(value))
    return `“${field.name}” needs a valid date.`;
  if (field.type === "checkbox" && !["true", "false"].includes(value))
    return `“${field.name}” needs a checkbox value.`;
  if (field.type === "select" && !field.options.includes(value))
    return `“${field.name}” needs one of its current choices.`;
  return "";
}

/** Empty required values remain editable drafts; nonempty values always match their type. */
export function connectedThinkingError(workspace: Workspace): string {
  const types = new Map(
    (workspace.noteTypes || []).map((type) => [type.id, type]),
  );
  const notes = new Map(workspace.notes.map((note) => [note.id, note]));
  const names = new Set<string>();
  for (const type of types.values()) {
    const normalized = type.name.trim().toLocaleLowerCase();
    if (names.has(normalized)) return "Custom note type names must be unique.";
    names.add(normalized);
  }
  for (const note of workspace.notes) {
    const type = types.get(note.customTypeId || "");
    if (note.customTypeId && !type)
      return `“${note.title}” uses an unavailable note type.`;
    const values = note.propertyValues || {};
    const fields = new Map(
      type?.fields.map((field) => [field.id, field]) || [],
    );
    for (const [id, value] of Object.entries(values)) {
      const field = fields.get(id);
      if (!field)
        return `“${note.title}” has a property outside its custom note type. Keep the field or clear its values first.`;
      const error = propertyValueError(field, value);
      if (error) return error;
    }
    if (note.kind !== "decision" && note.decision)
      return "Clear the decision record before changing this note’s kind.";
    if (note.decision?.supersededById) {
      const replacement = notes.get(note.decision.supersededById);
      if (
        !replacement ||
        replacement.kind !== "decision" ||
        replacement.id === note.id
      )
        return "Choose another decision note in this workspace as the replacement.";
      const seen = new Set<string>([note.id]);
      let current: Note | undefined = replacement;
      while (current) {
        if (seen.has(current.id))
          return "Decision replacements cannot form a cycle.";
        seen.add(current.id);
        current = notes.get(current.decision?.supersededById || "");
      }
    }
  }
  for (const board of workspace.brainstorms || []) {
    const groups = new Set(board.groups.map((group) => group.id));
    for (const idea of board.ideas) {
      if (idea.groupId && !groups.has(idea.groupId))
        return "An idea’s group is missing. Move its ideas before removing the group.";
    }
  }
  return "";
}
