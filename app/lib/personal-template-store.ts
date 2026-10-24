import { z } from "zod";
import { assertSameOrigin, database, resolveWorkspace } from "./access-store";
import { WorkspaceError } from "./workspace-model";
import {
  omitPrivateAttachments,
  type PersonalTemplate,
  type TemplateInput,
} from "./personal-templates";

const identifier = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const title = z.string().trim().min(1).max(300);
const tags = z.array(z.string().min(1).max(80)).max(40);
const text = z.string().max(100_000);
const taskContent = z
  .object({
    title,
    description: text,
    type: z.enum(["task", "bug", "story", "epic"]),
    priority: z.enum(["urgent", "high", "medium", "low"]),
    estimate: z.number().finite().min(0).max(100_000),
    tags,
    subtasks: z.array(title).max(200),
  })
  .strict();
const noteContent = z
  .object({
    title,
    content: text,
    kind: z.enum([
      "note",
      "world",
      "character",
      "research",
      "daily",
      "meeting",
    ]),
    folder: z.string().max(300),
    tags,
    properties: z
      .record(z.string().max(80), z.string().max(2000))
      .refine(
        (value) => Object.keys(value).length <= 50,
        "Use at most 50 properties.",
      ),
  })
  .strict();
const templateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: identifier,
      name: z.string().trim().min(1).max(100),
      kind: z.literal("task"),
      content: taskContent,
    })
    .strict(),
  z
    .object({
      id: identifier,
      name: z.string().trim().min(1).max(100),
      kind: z.literal("note"),
      content: noteContent,
    })
    .strict(),
]);
const revision = z.number().int().positive();
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      template: templateSchema,
      base: revision.nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal("delete"), id: identifier, base: revision })
    .strict(),
  z
    .object({ action: z.literal("restore"), id: identifier, base: revision })
    .strict(),
]);
interface TemplateRow {
  data: string;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
  last_action: "save" | "delete" | "restore";
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WorkspaceError(`${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data;
}

function cleanContent(input: TemplateInput): TemplateInput {
  if (input.kind === "task")
    return {
      ...input,
      content: {
        ...input.content,
        description: omitPrivateAttachments(input.content.description),
      },
    };
  return {
    ...input,
    content: {
      ...input.content,
      content: omitPrivateAttachments(input.content.content),
      properties: Object.fromEntries(
        Object.entries(input.content.properties).map(([key, value]) => [
          key,
          omitPrivateAttachments(value),
        ]),
      ),
    },
  };
}

async function ownerKey(request: Request): Promise<string> {
  // resolveWorkspace verifies stale account headers and team membership. The
  // returned workspace ID never becomes part of this account's library key.
  const access = await resolveWorkspace(request);
  return access.user ? `user:${access.user.id}` : "guest";
}

function fromRow(row: TemplateRow): PersonalTemplate {
  return {
    ...parse(templateSchema, JSON.parse(row.data)),
    revision: row.revision,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function listForOwner(owner: string): Promise<PersonalTemplate[]> {
  const rows = await database()
    .prepare(
      "SELECT data, revision, updated_at, deleted_at, last_action FROM personal_templates WHERE owner_key = ? ORDER BY updated_at DESC, id",
    )
    .bind(owner)
    .all<TemplateRow>();
  return rows.results.map(fromRow);
}

export async function readPersonalTemplates(
  request: Request,
): Promise<PersonalTemplate[]> {
  return listForOwner(await ownerKey(request));
}

export async function mutatePersonalTemplate(
  request: Request,
  input: unknown,
): Promise<PersonalTemplate[]> {
  assertSameOrigin(request);
  const owner = await ownerKey(request);
  const mutation = parse(mutationSchema, input);
  const db = database();
  const id = mutation.action === "save" ? mutation.template.id : mutation.id;
  const row = await db
    .prepare(
      "SELECT data, revision, updated_at, deleted_at, last_action FROM personal_templates WHERE owner_key = ? AND id = ?",
    )
    .bind(owner, id)
    .first<TemplateRow>();
  const now = new Date().toISOString();
  const conflict = () =>
    new WorkspaceError(
      "This template changed in another tab. Refresh the library before trying again.",
      409,
    );
  const latestRow = () =>
    db
      .prepare(
        "SELECT data, revision, updated_at, deleted_at, last_action FROM personal_templates WHERE owner_key = ? AND id = ?",
      )
      .bind(owner, id)
      .first<TemplateRow>();

  if (mutation.action !== "save") {
    if (!row) throw new WorkspaceError("This template is unavailable.", 404);
    const deleting = mutation.action === "delete";
    if (
      row.last_action === mutation.action &&
      row.revision === mutation.base + 1 &&
      Boolean(row.deleted_at) === deleting
    )
      return listForOwner(owner);
    if (row.revision !== mutation.base || Boolean(row.deleted_at) === deleting)
      throw conflict();
    const result = await db
      .prepare(
        "UPDATE personal_templates SET deleted_at = ?, revision = revision + 1, updated_at = ?, last_action = ? WHERE owner_key = ? AND id = ? AND revision = ?",
      )
      .bind(
        deleting ? now : null,
        now,
        mutation.action,
        owner,
        id,
        mutation.base,
      )
      .run();
    if (!result.meta.changes) {
      const latest = await latestRow();
      if (
        !latest ||
        latest.last_action !== mutation.action ||
        latest.revision !== mutation.base + 1 ||
        Boolean(latest.deleted_at) !== deleting
      )
        throw conflict();
    }
    return listForOwner(owner);
  }

  const template = cleanContent(mutation.template);
  const data = JSON.stringify(template);
  if (new TextEncoder().encode(data).length > 120_000)
    throw new WorkspaceError("Keep a template below 120 KB of text.", 413);
  if (row) {
    if (row.deleted_at)
      throw new WorkspaceError("Restore this template before editing it.", 409);
    const current = fromRow(row);
    if (current.kind !== template.kind)
      throw new WorkspaceError(
        "A template's note or task type cannot change.",
        409,
      );
    if (
      row.last_action === "save" &&
      row.data === data &&
      ((mutation.base === null && row.revision === 1) ||
        (mutation.base !== null && row.revision === mutation.base + 1))
    )
      return listForOwner(owner);
    if (mutation.base !== row.revision) throw conflict();
    const result = await db
      .prepare(
        "UPDATE personal_templates SET data = ?, revision = revision + 1, updated_at = ?, last_action = 'save' WHERE owner_key = ? AND id = ? AND revision = ? AND (SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) FROM personal_templates WHERE owner_key = ? AND id <> ?) + length(CAST(? AS BLOB)) <= 2000000",
      )
      .bind(data, now, owner, id, mutation.base, owner, id, data)
      .run();
    if (!result.meta.changes) {
      const latest = await latestRow();
      if (
        !latest ||
        latest.deleted_at ||
        latest.last_action !== "save" ||
        latest.data !== data ||
        latest.revision !== mutation.base + 1
      )
        throw new WorkspaceError(
          "This template changed or your library reached 2 MB. Refresh and shorten a template before trying again.",
          409,
        );
    }
  } else {
    if (mutation.base !== null) throw conflict();
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO personal_templates (owner_key, id, data, revision, deleted_at, updated_at, last_action) SELECT ?, ?, ?, 1, NULL, ?, 'save' WHERE (SELECT COUNT(*) FROM personal_templates WHERE owner_key = ?) < 200 AND (SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) FROM personal_templates WHERE owner_key = ?) + length(CAST(? AS BLOB)) <= 2000000",
      )
      .bind(owner, id, data, now, owner, owner, data)
      .run();
    if (!result.meta.changes) {
      const latest = await latestRow();
      if (
        !latest ||
        latest.deleted_at ||
        latest.last_action !== "save" ||
        latest.data !== data ||
        latest.revision !== 1
      )
        throw new WorkspaceError(
          "Your personal library supports 200 templates and 2 MB, including deleted templates. Refresh to check for changes.",
          409,
        );
    }
  }
  return listForOwner(owner);
}
