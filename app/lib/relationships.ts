import type { EntityRef, Relationship, Workspace } from "./types";

export interface RelationshipImpact {
  changed: Set<string>;
  affected: Set<string>;
  direct: Set<string>;
  relationshipIds: Set<string>;
}

export function entityKey(reference: EntityRef): string {
  return `${reference.type}:${reference.id}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

/** A change marker, not a security hash. It excludes history and timestamps. */
function signature(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}:${text.length}`;
}

export function createSignatureReader(
  workspace: Workspace,
): (reference: EntityRef) => string {
  const notes = new Map(workspace.notes.map((note) => [note.id, note]));
  const tasks = new Map(workspace.tasks.map((task) => [task.id, task]));
  const projects = new Map(
    workspace.projects.map((project) => [project.id, project]),
  );
  const noteTypes = new Map(
    (workspace.noteTypes || []).map((type) => [type.id, type]),
  );
  const cache = new Map<string, string>();

  return (reference) => {
    const key = entityKey(reference);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let value: unknown;
    if (reference.type === "note") {
      const note = notes.get(reference.id);
      const noteType = note?.customTypeId
        ? noteTypes.get(note.customTypeId)
        : undefined;
      if (note)
        value = {
          title: note.title,
          content: note.content,
          projectId: note.projectId,
          properties: note.properties,
          kind: note.kind,
          ...(note.customTypeId ? { customTypeId: note.customTypeId } : {}),
          ...(noteType
            ? { customType: { name: noteType.name, fields: noteType.fields } }
            : {}),
          ...(note.propertyValues && Object.keys(note.propertyValues).length
            ? { propertyValues: note.propertyValues }
            : {}),
          ...(note.decision ? { decision: note.decision } : {}),
        };
    } else if (reference.type === "task") {
      const task = tasks.get(reference.id);
      if (task)
        value = {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          projectId: task.projectId,
          dueDate: task.dueDate,
          ...(task.startDate ? { startDate: task.startDate } : {}),
          estimate: task.estimate,
          blockedBy: [...task.blockedBy].sort(),
          noteIds: [...task.noteIds].sort(),
          subtasks: task.subtasks,
        };
    } else value = projects.get(reference.id);
    const result = value === undefined ? "" : signature(value);
    cache.set(key, result);
    return result;
  };
}

export function entitySignature(
  workspace: Workspace,
  reference: EntityRef,
): string {
  return createSignatureReader(workspace)(reference);
}

/** Direction describes the consequence of changing an endpoint. */
export function impactDirections(
  relationship: Relationship,
): [string, string][] {
  const from = entityKey(relationship.from);
  const to = entityKey(relationship.to);
  if (relationship.kind === "supports") return [[from, to]];
  if (relationship.kind === "contradicts")
    return [
      [from, to],
      [to, from],
    ];
  return [[to, from]];
}

export function relationshipImpact(workspace: Workspace): RelationshipImpact {
  const changed = new Set<string>();
  const affected = new Set<string>();
  const direct = new Set<string>();
  const relationshipIds = new Set<string>();
  const readSignature = createSignatureReader(workspace);
  const adjacency = new Map<
    string,
    { target: string; relationshipId?: string; requiresReview: boolean }[]
  >();
  const add = (
    source: string,
    target: string,
    requiresReview: boolean,
    relationshipId?: string,
  ) => {
    const neighbors = adjacency.get(source) || [];
    neighbors.push({ target, relationshipId, requiresReview });
    adjacency.set(source, neighbors);
  };

  for (const relationship of workspace.relationships || []) {
    const fromChanged =
      readSignature(relationship.from) !== relationship.fromSignature;
    const toChanged =
      readSignature(relationship.to) !== relationship.toSignature;
    const fromIsUpstream =
      relationship.kind === "supports" || relationship.kind === "contradicts";
    const toIsUpstream = relationship.kind !== "supports";
    if (fromChanged && fromIsUpstream)
      changed.add(entityKey(relationship.from));
    if (toChanged && toIsUpstream) changed.add(entityKey(relationship.to));
    if ((fromChanged && fromIsUpstream) || (toChanged && toIsUpstream))
      relationshipIds.add(relationship.id);
    for (const [source, target] of impactDirections(relationship)) {
      add(
        source,
        target,
        source === entityKey(relationship.from) ? fromChanged : toChanged,
        relationship.id,
      );
    }
  }
  for (const task of workspace.tasks) {
    for (const dependency of task.blockedBy)
      add(`task:${dependency}`, `task:${task.id}`, true);
  }

  const visited = new Set<string>();
  const queue = [...changed].map((key) => ({ key, propagated: false }));
  for (let position = 0; position < queue.length; position++) {
    const source = queue[position];
    for (const neighbor of adjacency.get(source.key) || []) {
      // A reviewed edge stays clear even if a different edge from the same
      // changed source still awaits review. Indirect effects continue onward.
      if (!source.propagated && !neighbor.requiresReview) continue;
      if (!changed.has(neighbor.target)) {
        affected.add(neighbor.target);
        if (!source.propagated) direct.add(neighbor.target);
      }
      if (!visited.has(neighbor.target)) {
        visited.add(neighbor.target);
        queue.push({ key: neighbor.target, propagated: true });
      }
    }
  }
  return { changed, affected, direct, relationshipIds };
}
