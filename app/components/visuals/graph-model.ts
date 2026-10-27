import type { Workspace } from "../../lib/types";
import { entityKey } from "../../lib/relationships";
import { relationshipLabel } from "../../lib/relationship-display";
import { clamp, cssColor } from "./visual-helpers";

export type GraphNode = {
  id: string;
  entityId: string;
  type: "note" | "task" | "project";
  title: string;
  subtitle: string;
  color: string;
  projectId: string;
  x: number;
  y: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  relationshipId?: string;
};

export const nodeRadius = (node: GraphNode) =>
  node.type === "project" ? 15 : node.type === "note" ? 8 : 6;

export function graphData(
  workspace: Workspace,
  projectFilter: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const matchProject = (projectId: string) =>
    !projectFilter || projectFilter === "all" || projectId === projectFilter;
  const nodes: GraphNode[] = [];
  workspace.projects
    .filter((p) => matchProject(p.id))
    .forEach((p) =>
      nodes.push({
        id: `project:${p.id}`,
        entityId: p.id,
        type: "project",
        title: p.name,
        subtitle: p.key,
        color: cssColor(p.color, "#e6b670"),
        projectId: p.id,
        x: 0,
        y: 0,
      }),
    );
  workspace.notes
    .filter((n) => matchProject(n.projectId))
    .forEach((n) =>
      nodes.push({
        id: `note:${n.id}`,
        entityId: n.id,
        type: "note",
        title: n.title,
        subtitle: n.folder || n.kind,
        color:
          n.kind === "world"
            ? "#69cbb0"
            : n.kind === "character"
              ? "#df8bb6"
              : "#83b9eb",
        projectId: n.projectId,
        x: 0,
        y: 0,
      }),
    );
  workspace.tasks
    .filter((t) => matchProject(t.projectId))
    .forEach((t) =>
      nodes.push({
        id: `task:${t.id}`,
        entityId: t.id,
        type: "task",
        title: t.title,
        subtitle: t.key,
        color: t.status === "done" ? "#69cbb0" : "#ab94ff",
        projectId: t.projectId,
        x: 0,
        y: 0,
      }),
    );
  const valid = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  const added = new Set<string>();
  const add = (
    from: string,
    to: string,
    kind: string,
    relationshipId?: string,
  ) => {
    if (!valid.has(from) || !valid.has(to) || from === to) return;
    const key = relationshipId || `${kind}:${[from, to].sort().join("|")}`;
    if (added.has(key)) return;
    added.add(key);
    edges.push({ id: key, from, to, kind, relationshipId });
  };
  const noteTitles = new Map(
    workspace.notes.map((n) => [n.title.toLocaleLowerCase(), n.id]),
  );
  const noteIds = new Set(workspace.notes.map((note) => note.id));
  for (const note of workspace.notes) {
    for (const link of note.content.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const title = link[1]
        .split("|")[0]
        .split("#")[0]
        .trim()
        .replace(/\.md$/i, "")
        .toLocaleLowerCase();
      const target =
        noteTitles.get(title) || (noteIds.has(title) ? title : undefined);
      if (target) add(`note:${note.id}`, `note:${target}`, "Linked note");
    }
    if (note.projectId)
      add(`project:${note.projectId}`, `note:${note.id}`, "Project note");
  }
  for (const task of workspace.tasks) {
    if (task.projectId)
      add(`project:${task.projectId}`, `task:${task.id}`, "Project task");
    task.noteIds.forEach((id) =>
      add(`task:${task.id}`, `note:${id}`, "Related note"),
    );
    task.blockedBy.forEach((id) =>
      add(`task:${task.id}`, `task:${id}`, "Dependency"),
    );
  }
  for (const relationship of workspace.relationships ?? []) {
    add(
      entityKey(relationship.from),
      entityKey(relationship.to),
      relationshipLabel(relationship.kind),
      relationship.id,
    );
  }
  // Stable initial positions and a small force simulation keep connected topics together.
  const projects = workspace.projects.map((p) => p.id);
  nodes.forEach((node, i) => {
    const group = Math.max(0, projects.indexOf(node.projectId));
    const groupAngle =
      (group * Math.PI * 2) / Math.max(projects.length, 1) - Math.PI / 2;
    const groupRadius = projects.length > 1 ? 210 : 0;
    const angle = i * 2.39996323;
    const radius = node.type === "project" ? 0 : 65 + Math.sqrt(i + 1) * 22;
    node.x = Math.cos(groupAngle) * groupRadius + Math.cos(angle) * radius;
    node.y = Math.sin(groupAngle) * groupRadius + Math.sin(angle) * radius;
  });
  return { nodes, edges };
}

export function layoutGraph(
  input: GraphNode[],
  edges: GraphEdge[],
): GraphNode[] {
  const nodes = input.map((node) => ({ ...node }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairs = (nodes.length * (nodes.length - 1)) / 2;
  const iterations = Math.max(
    18,
    Math.min(90, Math.floor(600_000 / Math.max(1, pairs))),
  );
  if (nodes.length <= 250)
    for (let iteration = 0; iteration < iterations; iteration++) {
      const force = new Map(
        nodes.map((n) => [n.id, { x: -n.x * 0.003, y: -n.y * 0.003 }]),
      );
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          const dx = a.x - b.x || 0.1,
            dy = a.y - b.y || 0.1;
          const distance = Math.max(25, Math.hypot(dx, dy));
          const strength = 1450 / (distance * distance);
          force.get(a.id)!.x += (dx / distance) * strength;
          force.get(a.id)!.y += (dy / distance) * strength;
          force.get(b.id)!.x -= (dx / distance) * strength;
          force.get(b.id)!.y -= (dy / distance) * strength;
        }
      for (const edge of edges) {
        const a = byId.get(edge.from)!,
          b = byId.get(edge.to)!;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const strength =
          (distance - (edge.kind === "Project task" ? 170 : 125)) * 0.012;
        force.get(a.id)!.x += (dx / distance) * strength;
        force.get(a.id)!.y += (dy / distance) * strength;
        force.get(b.id)!.x -= (dx / distance) * strength;
        force.get(b.id)!.y -= (dy / distance) * strength;
      }
      nodes.forEach((node) => {
        const f = force.get(node.id)!;
        node.x += clamp(f.x, -8, 8);
        node.y += clamp(f.y, -8, 8);
      });
    }
  return nodes;
}
