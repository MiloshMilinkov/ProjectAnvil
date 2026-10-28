import { z } from "zod";
import type { BulkTaskPatch } from "./bulk-tasks";
import { isCalendarDate } from "./reminder-time";
const choice = z.string().regex(/^(keep|set:[A-Za-z0-9_-]{0,120})$/);
const date = z.string().refine((value) => !value || isCalendarDate(value));
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const reference = z.union([identifier, z.literal("")]);
const basicFields = z
  .object({
    id: identifier,
    status: z
      .enum(["backlog", "todo", "in-progress", "review", "done"])
      .optional(),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    assigneeId: reference.optional(),
    projectId: reference.optional(),
    milestoneId: reference.optional(),
    parentId: reference.optional(),
    startDate: date.optional(),
    dueDate: date.optional(),
  })
  .strict();
const pendingMutation = z
  .object({
    action: z.literal("upsert"),
    entity: z.literal("tasks"),
    item: basicFields,
    base: basicFields,
    operationId: identifier,
  })
  .strict()
  .refine(
    (value) =>
      value.item.id === value.base.id &&
      Object.keys(value.item).length > 1 &&
      Object.keys(value.item).every((field) =>
        Object.hasOwn(value.base, field),
      ),
    "Keep the original values for each changed field.",
  );
const schema = z
  .object({
    form: z
      .object({
        status: z.enum([
          "",
          "backlog",
          "todo",
          "in-progress",
          "review",
          "done",
        ]),
        priority: z.enum(["", "urgent", "high", "medium", "low"]),
        assignee: choice,
        project: choice,
        milestone: choice,
        changeStart: z.boolean(),
        startDate: date,
        changeDue: z.boolean(),
        dueDate: date,
      })
      .strict(),
    ids: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,120}$/))
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Select each task only once.",
      ),
    replacing: z.boolean().optional(),
    pending: z
      .array(pendingMutation)
      .max(100)
      .refine(
        (values) =>
          new Set(values.map((value) => value.operationId)).size ===
            values.length &&
          new Set(values.map((value) => value.item.id)).size === values.length,
        "This batch contains duplicate tasks or pending saves. Review the selection before trying again.",
      )
      .optional(),
  })
  .strict();
export type BulkDraft = z.infer<typeof schema>;
export type BulkForm = BulkDraft["form"];
export const emptyBulkForm: BulkForm = {
  status: "",
  priority: "",
  assignee: "keep",
  project: "keep",
  milestone: "keep",
  changeStart: false,
  startDate: "",
  changeDue: false,
  dueDate: "",
};
export function parseBulkDraft(input: unknown): BulkDraft | null {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
export function bulkFormPatch(form: BulkForm): BulkTaskPatch {
  const patch: BulkTaskPatch = {};
  if (form.status) patch.status = form.status;
  if (form.priority) patch.priority = form.priority;
  if (form.assignee.startsWith("set:"))
    patch.assigneeId = form.assignee.slice(4);
  if (form.project.startsWith("set:")) patch.projectId = form.project.slice(4);
  if (form.milestone.startsWith("set:"))
    patch.milestoneId = form.milestone.slice(4);
  if (form.changeStart) patch.startDate = form.startDate;
  if (form.changeDue) patch.dueDate = form.dueDate;
  return patch;
}
