import type { Entity, EntityRef, Mutation, Workspace } from "./types";
import type { ActivityAction, ActivityEntry } from "./collaboration-types";

const labels: Record<string, string> = {
  title: "Title",
  name: "Name",
  content: "Text",
  description: "Description",
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignment",
  startDate: "Planned start",
  dueDate: "Due date",
  projectId: "Project",
  folder: "Folder",
  tags: "Tags",
  kind: "Type",
  customTypeId: "Note type",
  properties: "Properties",
  propertyValues: "Structured properties",
  decision: "Decision record",
  subtasks: "Checklist",
  comments: "Discussion",
  blockedBy: "Dependencies",
  noteIds: "Note links",
  parentId: "Parent task",
  milestoneId: "Milestone",
  milestones: "Milestones",
  recurrence: "Recurrence",
  reminder: "Reminder",
  cards: "Cards",
  edges: "Connections",
  groups: "Groups",
  ideas: "Ideas",
  votingOpen: "Voting",
  fields: "Property structure",
  archived: "Archive status",
  bookmarked: "Bookmark",
  from: "First item",
  to: "Second item",
  label: "Explanation",
  estimate: "Effort",
  goal: "Goal",
  targetDate: "Target date",
  color: "Color",
  key: "Project key",
  fromType: "First item type",
  toType: "Second item type",
};
const ignored = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "snapshots",
  "fromSignature",
  "toSignature",
  "reviewedAt",
  "collaboration",
]);
const entities: Entity[] = [
  "projects",
  "tasks",
  "notes",
  "canvases",
  "people",
  "media",
  "savedViews",
  "relationships",
  "noteTypes",
  "relationshipPresets",
  "brainstorms",
];
type Item = Record<string, unknown> & { id: string };
export interface PreparedActivity
  extends Omit<ActivityEntry, "sequence" | "reference"> {
  actorId: string;
  mentions: string[];
}

export function referenceFor(
  entity: string,
  id: string,
): EntityRef | undefined {
  return entity === "notes"
    ? { type: "note", id }
    : entity === "tasks"
      ? { type: "task", id }
      : entity === "projects"
        ? { type: "project", id }
        : undefined;
}
export function activityVerb(action: ActivityAction): string {
  return {
    created: "created",
    updated: "updated",
    deleted: "moved to Trash",
    restored: "restored",
    renamed: "renamed",
    imported: "imported",
    reviewed: "reviewed",
    voted: "updated voting on",
    "access-changed": "changed access to",
  }[action];
}

/** Exact registered handles only. Code examples, escapes, and email addresses do not ping. */
export function mentionedUsers(
  text: string,
  usernames: ReadonlyMap<string, string>,
): Set<string> {
  const result = new Set<string>();
  const prose = text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/(`+)([^\n]*?)\1/g, " ")
    .replace(/https?:\/\/[^\s<>()]+/g, " ");
  const expression = /(^|[^\p{L}\p{N}_.\\])@([A-Za-z0-9_.]{3,120})/gu;
  for (const match of prose.matchAll(expression)) {
    let name = match[2].toLowerCase();
    // A full registered username wins over punctuation trimming.
    while (name && !usernames.has(name) && name.endsWith("."))
      name = name.slice(0, -1);
    const id = name.length <= 30 ? usernames.get(name) : undefined;
    if (id) result.add(id);
  }
  return result;
}
function mentionText(entity: Entity, item?: Item): string {
  if (!item) return "";
  if (entity === "notes")
    return typeof item.content === "string" ? item.content : "";
  if (entity !== "tasks") return "";
  return `${typeof item.description === "string" ? item.description : ""}\n${Array.isArray(item.comments) ? item.comments.map((comment) => (comment && typeof comment === "object" && typeof comment.body === "string" ? comment.body : "")).join("\n") : ""}`;
}
function changedFields(previous: Item, next: Item): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter(
      (key) =>
        !ignored.has(key) &&
        JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
    )
    .map((key) => labels[key] || "Details");
}

/** Event text contains labels, not old/new content or discussion bodies. */
export function prepareActivity(
  current: Workspace,
  updated: Workspace,
  actor: { id: string; name: string },
  usernames: ReadonlyMap<string, string>,
  mutation?: Pick<Mutation, "action" | "entity" | "id" | "item">,
  now = new Date().toISOString(),
): PreparedActivity[] {
  const event = (
    entity: Entity | "workspace",
    item: Item,
    action: ActivityAction,
    fields: string[],
    mentions: string[] = [],
  ): PreparedActivity => ({
    id: crypto.randomUUID(),
    entity,
    entityId: item.id,
    projectId:
      entity === "projects"
        ? item.id
        : typeof item.projectId === "string"
          ? item.projectId
          : "",
    title: String(
      item.title ||
        item.name ||
        (entity === "workspace" ? updated.name : "Workspace item"),
    ).slice(0, 300),
    action,
    fields: [...new Set(fields)].slice(0, 25),
    mentions,
    actorId: actor.id,
    actor: actor.name,
    revision: updated.revision,
    createdAt: now,
  });
  if (mutation?.action === "import")
    return [
      event("workspace", { id: "workspace", name: updated.name }, "imported", [
        "Workspace records",
      ]),
    ];
  if (mutation?.action === "rename")
    return current.name === updated.name
      ? []
      : [
          event(
            "workspace",
            { id: "workspace", name: updated.name },
            "renamed",
            ["Workspace name"],
          ),
        ];
  const result: PreparedActivity[] = [];
  const primaryId = String(mutation?.id || mutation?.item?.id || "");
  for (const entity of entities) {
    if (mutation?.entity && mutation.entity !== entity) continue;
    if (mutation?.action === "vote-idea" && entity !== "brainstorms") continue;
    if (
      mutation?.action === "review-relationship" &&
      entity !== "relationships"
    )
      continue;
    const before = new Map(
      ((current[entity] || []) as unknown as Item[]).map((item) => [
        item.id,
        item,
      ]),
    );
    const after = new Map(
      ((updated[entity] || []) as unknown as Item[]).map((item) => [
        item.id,
        item,
      ]),
    );
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (primaryId && mutation?.action !== "restore" && id !== primaryId)
        continue;
      const previous = before.get(id),
        next = after.get(id);
      const action: ActivityAction = !previous
        ? mutation?.action === "restore"
          ? "restored"
          : "created"
        : !next
          ? "deleted"
          : mutation?.action === "review-relationship"
            ? "reviewed"
            : mutation?.action === "vote-idea"
              ? "voted"
              : "updated";
      const fields = previous && next ? changedFields(previous, next) : [];
      if (previous && next && !fields.length && action !== "reviewed") continue;
      const oldMentions = mentionedUsers(
        mentionText(entity, previous),
        usernames,
      );
      const mentions = next
        ? [...mentionedUsers(mentionText(entity, next), usernames)].filter(
            (user) => !oldMentions.has(user),
          )
        : [];
      result.push(event(entity, next || previous!, action, fields, mentions));
      if (result.length >= 200) return result;
    }
  }
  return result;
}
