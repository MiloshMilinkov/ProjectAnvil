"use client";
import { useWorkspaceFetch } from "./WorkspaceScope";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckSquare2,
  CircleDot,
  FileText,
  Focus,
  Globe2,
  ImagePlus,
  Layers3,
  Link2,
  Loader2,
  Maximize,
  Minus,
  MousePointer2,
  Network,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import {
  type Canvas,
  type CanvasCard,
  type FeatureProps,
  type Media,
  type Workspace,
  uid,
} from "../lib/types";
import { entityKey, relationshipImpact } from "../lib/relationships";
import { relationshipLabel } from "../lib/relationship-display";
import type { EntityRef } from "../lib/types";
import GraphRelationships from "./GraphRelationships";
import { useCanvasPersistence } from "./useCanvasPersistence";
import { useDialog } from "./useDialog";
import "./visuals.css";
import "./project-planning.css";

type Point = { x: number; y: number };
type Camera = Point & { scale: number };
type GraphNode = {
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
type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  relationshipId?: string;
};
const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n));
const short = (s: string, n = 25) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const cssColor = (value: string | undefined, fallback = "#9b88ff") =>
  value && /^#[\da-f]{3,8}$/i.test(value) ? value : fallback;
const nodeRadius = (node: GraphNode) =>
  node.type === "project" ? 15 : node.type === "note" ? 8 : 6;

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 680 });
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function graphData(
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

/** Only visible nodes participate in layout, including a focused local graph. */
function layoutGraph(input: GraphNode[], edges: GraphEdge[]): GraphNode[] {
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

export function GraphView(
  props: FeatureProps & { onClearProjectFilter?: () => void },
) {
  const { workspace, projectFilter } = props;
  const data = useMemo(
    () => graphData(workspace, projectFilter),
    [workspace, projectFilter],
  );
  const impact = useMemo(
    () => relationshipImpact(props.workspace),
    [props.workspace],
  );
  const { ref, width, height } = useSize();
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 0.86 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState<"global" | "local">("global");
  const [depth, setDepth] = useState(1);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState({ note: true, task: true, project: true });
  const pendingLocation = useRef<string | null>(null);
  const drag = useRef<{
    id?: string;
    start: Point;
    origin: Point;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const zoom = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2,
        py = event.clientY - rect.top - rect.height / 2;
      setCamera((old) => {
        const scale = clamp(
          old.scale * (event.deltaY > 0 ? 0.9 : 1.1),
          0.15,
          3,
        );
        return {
          scale,
          x: px - ((px - old.x) * scale) / old.scale,
          y: py - ((py - old.y) * scale) / old.scale,
        };
      });
    };
    surface.addEventListener("wheel", zoom, { passive: false });
    return () => surface.removeEventListener("wheel", zoom);
  }, [ref]);
  const selectedNode = data.nodes.find((n) => n.id === selected);
  const focusId =
    selected ||
    data.nodes.find((n) => n.type === "note")?.id ||
    data.nodes[0]?.id;
  const localIds = useMemo(() => {
    const ids = new Set<string>(focusId ? [focusId] : []);
    for (let d = 0; d < depth; d++) {
      const previous = new Set(ids);
      for (const edge of data.edges)
        if (previous.has(edge.from) || previous.has(edge.to)) {
          ids.add(edge.from);
          ids.add(edge.to);
        }
    }
    return ids;
  }, [focusId, depth, data.edges]);
  const visibleGraph = useMemo(() => {
    const visibleNodes = data.nodes.filter(
      (node) =>
        types[node.type] && (scope === "global" || localIds.has(node.id)),
    );
    const ids = new Set(visibleNodes.map((node) => node.id));
    const edges = data.edges.filter(
      (edge) => ids.has(edge.from) && ids.has(edge.to),
    );
    return { nodes: layoutGraph(visibleNodes, edges), edges };
  }, [data, types, scope, localIds]);
  const { nodes, edges } = visibleGraph;
  const nodesById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data.nodes],
  );
  const visibleNodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const connected = data.edges.filter(
    (e) => e.from === selected || e.to === selected,
  );
  const matches = query
    ? nodes.filter((n) =>
        `${n.title} ${n.subtitle}`.toLowerCase().includes(query.toLowerCase()),
      )
    : [];
  const matchIds = new Set(matches.map((node) => node.id));
  const neighborIds = new Set(
    connected.flatMap((edge) => [edge.from, edge.to]),
  );
  const point = useCallback(
    (node: GraphNode) =>
      positions[node.id] || visibleNodesById.get(node.id) || node,
    [positions, visibleNodesById],
  );
  useEffect(() => {
    if (!pendingLocation.current) return;
    const node = data.nodes.find((item) => item.id === pendingLocation.current);
    if (!node) return;
    pendingLocation.current = null;
    const position = point(node);
    setCamera((old) => ({
      ...old,
      x: -position.x * old.scale,
      y: -position.y * old.scale,
    }));
  }, [data, point]);
  const open = (node: GraphNode) =>
    node.type === "note"
      ? props.openNote(node.entityId)
      : node.type === "task"
        ? props.openTask(node.entityId)
        : (setSelected(node.id), setScope("local"));
  const locateEntity = (reference: EntityRef) => {
    const key = entityKey(reference);
    setSelected(key);
    setScope("global");
    setTypes((old) => ({ ...old, [reference.type]: true }));
    setQuery("");
    const node = data.nodes.find((item) => item.id === key);
    if (node) {
      const position = point(node);
      setCamera((old) => ({
        ...old,
        x: -position.x * old.scale,
        y: -position.y * old.scale,
      }));
    } else if (props.projectFilter && props.onClearProjectFilter) {
      pendingLocation.current = key;
      props.onClearProjectFilter();
    }
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const openEntity = (reference: EntityRef) => {
    if (reference.type === "note") props.openNote(reference.id);
    else if (reference.type === "task") props.openTask(reference.id);
    else locateEntity(reference);
  };
  const fit = useCallback(() => {
    if (!nodes.length) return;
    const rect = ref.current?.getBoundingClientRect();
    const ps = nodes.map(point);
    const minX = Math.min(...ps.map((p) => p.x)) - 110,
      maxX = Math.max(...ps.map((p) => p.x)) + 110;
    const minY = Math.min(...ps.map((p) => p.y)) - 80,
      maxY = Math.max(...ps.map((p) => p.y)) + 80;
    const scale = clamp(
      Math.min(
        (rect?.width || width) / (maxX - minX),
        (rect?.height || height) / (maxY - minY),
      ),
      0.15,
      1.8,
    );
    setCamera({
      x: (-(minX + maxX) / 2) * scale,
      y: (-(minY + maxY) / 2) * scale,
      scale,
    });
  }, [nodes, point, ref, width, height]);
  const graphFitted = useRef(false);
  useEffect(() => {
    if (!graphFitted.current && nodes.length) {
      fit();
      graphFitted.current = true;
    }
  }, [nodes.length, fit]);
  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("[data-graph-node]")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: { x: event.clientX, y: event.clientY },
      origin: camera,
      moved: false,
    };
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = event.clientX - active.start.x,
      dy = event.clientY - active.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) active.moved = true;
    if (active.id)
      setPositions((old) => ({
        ...old,
        [active.id!]: {
          x: active.origin.x + dx / camera.scale,
          y: active.origin.y + dy / camera.scale,
        },
      }));
    else
      setCamera((old) => ({
        ...old,
        x: active.origin.x + dx,
        y: active.origin.y + dy,
      }));
  };
  return (
    <div className="visual-feature">
      <div className="visual-heading">
        <div>
          <div className="visual-eyebrow">CONNECTED THINKING</div>
          <h1>
            Knowledge graph{" "}
            <span className="visual-count">{data.nodes.length}</span>
          </h1>
          <p>See how your notes, projects, and tasks fit together.</p>
        </div>
        <div className="graph-heading-actions">
          <button
            className="btn"
            onClick={() =>
              document
                .querySelector('[data-tour="meaningful-relationships"]')
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <Link2 size={15} />
            Relationships
            {impact.relationshipIds.size > 0
              ? ` · ${impact.relationshipIds.size} to review`
              : ""}
          </button>
          <button className="btn" onClick={fit}>
            <Focus size={15} />
            Fit graph
          </button>
        </div>
      </div>
      <div className="graph-toolbar">
        <div className="visual-segment" role="group" aria-label="Graph scope">
          <button
            className={scope === "global" ? "active" : ""}
            aria-pressed={scope === "global"}
            onClick={() => setScope("global")}
          >
            <Globe2 size={14} /> Entire workspace
          </button>
          <button
            className={scope === "local" ? "active" : ""}
            aria-pressed={scope === "local"}
            onClick={() => {
              setScope("local");
              if (!selected && focusId) setSelected(focusId);
            }}
          >
            <Focus size={14} /> Local graph
          </button>
        </div>
        <div
          className="graph-types"
          role="group"
          aria-label="Visible graph items"
        >
          {(["note", "task", "project"] as const).map((type) => (
            <button
              key={type}
              className={types[type] ? "active" : ""}
              aria-pressed={types[type]}
              onClick={() =>
                setTypes((old) => ({ ...old, [type]: !old[type] }))
              }
            >
              <i
                style={{
                  background:
                    type === "note"
                      ? "#83b9eb"
                      : type === "task"
                        ? "#ab94ff"
                        : "#e6b670",
                }}
              />
              {type === "note"
                ? "Notes"
                : type === "task"
                  ? "Tasks"
                  : "Projects"}
            </button>
          ))}
        </div>
        {scope === "local" && (
          <select
            className="field graph-depth"
            aria-label="Connection depth"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            <option value={1}>1 connection away</option>
            <option value={2}>2 connections away</option>
          </select>
        )}
        <label className="visual-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a connection…"
            aria-label="Search graph"
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="graph-layout">
        <div className="graph-surface" ref={ref}>
          <svg
            className="graph-svg"
            aria-label="Relationship graph. Drag to pan, drag nodes to arrange, double click to open."
            onPointerDown={startPan}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <defs>
              <radialGradient id="graphGlow">
                <stop
                  offset="0%"
                  stopColor="var(--theme-ink-8a78fa,#8a78fa)"
                  stopOpacity=".1"
                />
                <stop
                  offset="100%"
                  stopColor="var(--theme-ink-8a78fa,#8a78fa)"
                  stopOpacity="0"
                />
              </radialGradient>
              <marker
                id="relationship-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="8"
                refY="4"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="var(--accent)" />
              </marker>
            </defs>
            <ellipse
              cx="50%"
              cy="48%"
              rx="45%"
              ry="45%"
              fill="url(#graphGlow)"
            />
            <g
              transform={`translate(${width / 2 + camera.x},${height / 2 + camera.y}) scale(${camera.scale})`}
            >
              {edges.map((edge) => {
                const source = nodesById.get(edge.from)!;
                const target = nodesById.get(edge.to)!;
                const a = point(source);
                const b = point(target);
                const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
                const ux = (b.x - a.x) / distance;
                const uy = (b.y - a.y) / distance;
                // Stop outside each node so its fill cannot hide the arrowhead.
                const startInset = edge.relationshipId
                  ? Math.min(nodeRadius(source) + 5, distance * 0.4)
                  : 0;
                const endInset = edge.relationshipId
                  ? Math.min(nodeRadius(target) + 5, distance * 0.4)
                  : 0;
                const active = edge.from === selected || edge.to === selected;
                const needsReview =
                  !!edge.relationshipId &&
                  impact.relationshipIds.has(edge.relationshipId);
                return (
                  <line
                    key={edge.id}
                    x1={a.x + ux * startInset}
                    y1={a.y + uy * startInset}
                    x2={b.x - ux * endInset}
                    y2={b.y - uy * endInset}
                    stroke={
                      needsReview || active
                        ? "var(--accent)"
                        : "var(--theme-line-41445c,#41445c)"
                    }
                    strokeWidth={needsReview ? 2.5 : active ? 1.7 : 1}
                    strokeOpacity={
                      needsReview ? 1 : selected && !active ? 0.25 : 0.65
                    }
                    strokeDasharray={
                      edge.kind === "Dependency" || edge.kind === "depends on"
                        ? "5 5"
                        : undefined
                    }
                    markerEnd={
                      edge.relationshipId
                        ? "url(#relationship-arrow)"
                        : undefined
                    }
                    markerStart={
                      edge.relationshipId && edge.kind === "contradicts"
                        ? "url(#relationship-arrow)"
                        : undefined
                    }
                  >
                    <title>
                      {edge.kind}
                      {needsReview ? " · source changed, review needed" : ""}
                    </title>
                  </line>
                );
              })}
              {nodes.map((node) => {
                const p = point(node);
                const active = node.id === selected;
                const impacted =
                  impact.changed.has(node.id) || impact.affected.has(node.id);
                const dim = impacted
                  ? false
                  : query
                    ? !matchIds.has(node.id)
                    : selected
                      ? node.id !== selected && !neighborIds.has(node.id)
                      : false;
                const radius =
                  node.type === "project" ? 15 : node.type === "note" ? 8 : 6;
                return (
                  <g
                    key={node.id}
                    data-graph-node={node.id}
                    data-impact={
                      impact.changed.has(node.id)
                        ? "changed"
                        : impact.direct.has(node.id)
                          ? "direct"
                          : impact.affected.has(node.id)
                            ? "downstream"
                            : undefined
                    }
                    transform={`translate(${p.x},${p.y})`}
                    className="graph-node"
                    style={{ opacity: dim ? 0.22 : 1 }}
                    role="button"
                    aria-pressed={active}
                    tabIndex={0}
                    aria-label={`${node.type}: ${node.title}${impacted ? ", source changed or needs review" : ""}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open(node);
                      if (e.key === " ") {
                        e.preventDefault();
                        setSelected(node.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = {
                        id: node.id,
                        start: { x: event.clientX, y: event.clientY },
                        origin: p,
                        moved: false,
                      };
                    }}
                    onClick={() => {
                      if (!drag.current?.moved) setSelected(node.id);
                    }}
                    onDoubleClick={() => open(node)}
                  >
                    {impacted && (
                      <circle
                        r={radius + 12}
                        fill="none"
                        stroke={
                          impact.changed.has(node.id)
                            ? "var(--danger)"
                            : "var(--accent)"
                        }
                        strokeWidth="2.5"
                        strokeDasharray={
                          impact.affected.has(node.id) &&
                          !impact.direct.has(node.id)
                            ? "4 4"
                            : undefined
                        }
                      />
                    )}
                    {active && (
                      <circle
                        r={radius + 8}
                        stroke={node.color}
                        strokeWidth="1"
                        fill={node.color}
                        fillOpacity=".12"
                      />
                    )}
                    <circle
                      r={radius}
                      fill={node.color}
                      stroke="var(--theme-surface-161925,#161925)"
                      strokeWidth="3"
                    />
                    {node.type === "project" && (
                      <circle
                        r="4"
                        fill="var(--theme-surface-151722,#151722)"
                      />
                    )}
                    <text
                      y={radius + 19}
                      textAnchor="middle"
                      fill={
                        active
                          ? "var(--theme-ink-f6f3ff,#f6f3ff)"
                          : "var(--theme-ink-c2c4d5,#c2c4d5)"
                      }
                      fontSize={node.type === "project" ? 12 : 11}
                      fontWeight={node.type === "project" || active ? 600 : 450}
                    >
                      {short(node.title, 30)}
                    </text>
                    <title>
                      {node.title} · {node.subtitle}
                    </title>
                  </g>
                );
              })}
            </g>
          </svg>
          {nodes.length === 0 && (
            <div className="visual-empty-overlay">
              <Network size={34} />
              <h3>No connections to show</h3>
              <p>Create notes and tasks, or enable another filter.</p>
            </div>
          )}
          {query && (
            <div className="graph-results">
              {matches.length ? (
                matches.slice(0, 6).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setSelected(n.id);
                      const p = point(n);
                      setCamera((old) => ({
                        ...old,
                        x: -p.x * old.scale,
                        y: -p.y * old.scale,
                      }));
                    }}
                  >
                    <i style={{ background: n.color }} />
                    <span>{n.title}</span>
                    <small>{n.type}</small>
                  </button>
                ))
              ) : (
                <p>No matching items</p>
              )}
            </div>
          )}
          <div className="visual-surface-caption">
            <span className="visual-live-dot" />
            {nodes.length} nodes <span>·</span> {edges.length} connections
          </div>
          <div className="visual-zoom">
            <button
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() =>
                setCamera((old) => ({
                  ...old,
                  scale: clamp(old.scale / 1.2, 0.15, 3),
                }))
              }
            >
              <Minus size={16} />
            </button>
            <span>{Math.round(camera.scale * 100)}%</span>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() =>
                setCamera((old) => ({
                  ...old,
                  scale: clamp(old.scale * 1.2, 0.15, 3),
                }))
              }
            >
              <Plus size={16} />
            </button>
            <i />
            <button title="Fit graph" aria-label="Fit graph" onClick={fit}>
              <Maximize size={15} />
            </button>
          </div>
        </div>
        <aside className="graph-inspector">
          {selectedNode ? (
            <>
              <div className="visual-inspector-label">
                <span>EXPLORING</span>
                <button
                  className="btn-icon"
                  aria-label="Clear selection"
                  onClick={() => setSelected("")}
                >
                  <X size={15} />
                </button>
              </div>
              <div
                className="graph-selected-icon"
                style={{
                  color: selectedNode.color,
                  background: `${selectedNode.color}18`,
                }}
              >
                {selectedNode.type === "note" ? (
                  <FileText size={22} />
                ) : selectedNode.type === "task" ? (
                  <CheckSquare2 size={22} />
                ) : (
                  <Layers3 size={22} />
                )}
              </div>
              <h3>{selectedNode.title}</h3>
              <p className="graph-selected-subtitle">
                {selectedNode.subtitle} <span>· {selectedNode.type}</span>
              </p>
              <button
                className="btn graph-open"
                onClick={() => open(selectedNode)}
              >
                Open {selectedNode.type}
                <ArrowUpRight size={15} />
              </button>
              <div className="graph-connections-heading">
                Connections <span>{connected.length}</span>
              </div>
              <div className="graph-connection-list">
                {connected.map((edge) => {
                  const neighbor = nodesById.get(
                    edge.from === selected ? edge.to : edge.from,
                  );
                  const statement = edge.relationshipId
                    ? `${nodesById.get(edge.from)?.title} ${edge.kind} ${nodesById.get(edge.to)?.title}`
                    : edge.kind;
                  return neighbor ? (
                    <button
                      key={edge.id}
                      onClick={() => setSelected(neighbor.id)}
                    >
                      <i style={{ background: neighbor.color }} />
                      <span>
                        {neighbor.title}
                        <small>{statement}</small>
                      </span>
                      <ArrowUpRight size={13} />
                    </button>
                  ) : null;
                })}
                {!connected.length && (
                  <p className="visual-muted">
                    Link this note with [[another note]], or attach it to a task
                    to start connecting ideas.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="visual-inspector-label">YOUR WORK, CONNECTED</div>
              <div className="graph-intro-icon">
                <Network size={28} />
              </div>
              <h3>A bigger picture.</h3>
              <p className="visual-muted">
                Explore the connections between your notes, tasks, and projects.
              </p>
              <div className="graph-hint">
                <MousePointer2 size={15} />
                <span>Select a node to see its connections.</span>
              </div>
              <div className="graph-hint">
                <ArrowUpRight size={15} />
                <span>Double click a node to open it.</span>
              </div>
              <div className="graph-hint">
                <Link2 size={15} />
                <span>Use [[note titles]] in notes to build connections.</span>
              </div>
              <div className="graph-stats">
                <div>
                  <strong>
                    {data.nodes.filter((n) => n.type === "note").length}
                  </strong>
                  <span>notes</span>
                </div>
                <div>
                  <strong>
                    {data.nodes.filter((n) => n.type === "task").length}
                  </strong>
                  <span>tasks</span>
                </div>
                <div>
                  <strong>{data.edges.length}</strong>
                  <span>links</span>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      <div className="graph-impact-legend" data-tour="graph-impact">
        <span>
          <i className="source-change" />
          Changed source ({impact.changed.size})
        </span>
        <span>
          <i />
          Direct impact ({impact.direct.size})
        </span>
        <span>
          <i className="downstream-impact" />
          Downstream impact (
          {Math.max(0, impact.affected.size - impact.direct.size)})
        </span>
      </div>
      <GraphRelationships
        workspace={props.workspace}
        mutate={props.mutate}
        notify={props.notify}
        impact={impact}
        selectedKey={selected}
        onSelect={locateEntity}
        onOpen={openEntity}
      />
      <div className="visual-footer">
        <span>
          <MousePointer2 size={13} /> Drag to explore · Scroll to zoom · Double
          click to open
        </span>
        <span>Connect your ideas to the work ahead.</span>
      </div>
    </div>
  );
}

const cardColors = [
  "#9b88ff",
  "#70bddb",
  "#77c7a8",
  "#e6b670",
  "#df8bb6",
  "#858da8",
];
const cardColorNames = ["Purple", "Blue", "Green", "Gold", "Pink", "Slate"];
const isHttp = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const blankCanvas = (projectId = ""): Canvas => ({
  id: uid(),
  title: "Untitled canvas",
  projectId,
  cards: [],
  edges: [],
});
const sanitizeCanvas = (canvas: Canvas): Canvas =>
  canvas.cards.some((card) => card.entityId === "")
    ? {
        ...canvas,
        cards: canvas.cards.map((card) => {
          if (card.entityId !== "") return card;
          const unlinked = { ...card };
          delete unlinked.entityId;
          return unlinked;
        }),
      }
    : canvas;
type CanvasDrag = {
  type: "pan" | "move" | "resize";
  id?: string;
  start: Point;
  origin: Point;
  width?: number;
  height?: number;
  moved: boolean;
};

interface CanvasViewProps extends FeatureProps {
  resumeContext?: {
    token: string;
    canvasId: string;
    viewport?: { x: number; y: number; zoom: number };
  };
  onContextChange?: (context: {
    canvasId: string;
    viewport: { x: number; y: number; zoom: number };
  }) => void;
}

export function CanvasView(props: CanvasViewProps) {
  const scopedFetch = useWorkspaceFetch();
  const { workspace, mutate, notify, resumeContext, onContextChange } = props;
  const {
    canvasId,
    canvas,
    canvasRef,
    local,
    save: persistCanvas,
    switchCanvas: selectCanvas,
    discard,
    draftOptions,
    saving,
    unsaved,
    recovered,
    error,
    storageError,
  } = useCanvasPersistence({
    canvases: workspace.canvases,
    revision: workspace.revision,
    mutate,
    notify,
    preferredId: resumeContext?.canvasId,
  });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 0.85 });
  const resumedRoom = useRef("");
  const { ref, width, height } = useSize();
  const [selected, setSelected] = useState("");
  const [selectedEdge, setSelectedEdge] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectFrom, setConnectFrom] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const addDialog = useRef<HTMLDivElement>(null);
  const [addType, setAddType] = useState<CanvasCard["type"]>("note");
  const [addSearch, setAddSearch] = useState("");
  const [newText, setNewText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [uploadMedia, setUploadMedia] = useState<Media[]>([]);
  useDialog(addDialog, () => setShowAdd(false), false, showAdd);
  const drag = useRef<CanvasDrag | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const restoredCameraFor = useRef<string | null>(null);
  const fittedCanvas = useRef("");
  const canvasOptions = [
    ...new Map(
      [...workspace.canvases, ...draftOptions].map((item) => [item.id, item]),
    ).values(),
  ];
  const allMedia = [
    ...uploadMedia,
    ...workspace.media.filter((m) => !uploadMedia.some((u) => u.id === m.id)),
  ];
  const canvasCardsById = useMemo(
    () => new Map(canvas?.cards.map((card) => [card.id, card]) || []),
    [canvas],
  );
  const notesById = useMemo(
    () => new Map(workspace.notes.map((note) => [note.id, note])),
    [workspace.notes],
  );
  const tasksById = useMemo(
    () => new Map(workspace.tasks.map((task) => [task.id, task])),
    [workspace.tasks],
  );
  const peopleById = useMemo(
    () => new Map(workspace.people.map((person) => [person.id, person])),
    [workspace.people],
  );
  const mediaById = new Map(allMedia.map((media) => [media.id, media]));
  const selectedCard = canvasCardsById.get(selected);
  const edge = canvas?.edges.find((e) => e.id === selectedEdge);

  useEffect(() => {
    onContextChange?.({
      canvasId,
      viewport: { x: camera.x, y: camera.y, zoom: camera.scale },
    });
  }, [canvasId, camera, onContextChange]);

  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const zoom = (event: WheelEvent) => {
      if (
        (event.target as Element).closest(
          "textarea, input, iframe, audio, video",
        )
      )
        return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2,
        py = event.clientY - rect.top - rect.height / 2;
      setCamera((old) => {
        const scale = clamp(
          old.scale * (event.deltaY > 0 ? 0.92 : 1.08),
          0.15,
          2.5,
        );
        return {
          scale,
          x: px - ((px - old.x) * scale) / old.scale,
          y: py - ((py - old.y) * scale) / old.scale,
        };
      });
    };
    surface.addEventListener("wheel", zoom, { passive: false });
    return () => surface.removeEventListener("wheel", zoom);
  }, [ref]);

  const save = useCallback(
    (input: Canvas) => persistCanvas(sanitizeCanvas(input)),
    [persistCanvas],
  );
  const updateCard = (
    id: string,
    patch: Partial<CanvasCard>,
    persist = true,
  ) => {
    const current = canvasRef.current;
    if (!current) return;
    const next = {
      ...current,
      cards: current.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    if (persist) save(next);
    else local(next);
  };
  const switchCanvas = useCallback(
    (id: string) => {
      if (!selectCanvas(id)) return;
      setSelected("");
      setSelectedEdge("");
      setConnecting(false);
      setConnectFrom("");
      drag.current = null;
      setEditingTitle(false);
      restoredCameraFor.current = null;
      setCamera({ x: 0, y: 0, scale: 0.85 });
    },
    [selectCanvas],
  );

  useEffect(() => {
    if (!resumeContext || resumedRoom.current === resumeContext.token) return;
    if (!workspace.canvases.some((item) => item.id === resumeContext.canvasId))
      return;
    const frame = requestAnimationFrame(() => {
      if (resumedRoom.current === resumeContext.token) return;
      resumedRoom.current = resumeContext.token;
      switchCanvas(resumeContext.canvasId);
      restoredCameraFor.current = resumeContext.canvasId;
      fittedCanvas.current = resumeContext.canvasId;
      setCamera(
        resumeContext.viewport
          ? {
              x: resumeContext.viewport.x,
              y: resumeContext.viewport.y,
              scale: resumeContext.viewport.zoom,
            }
          : { x: 0, y: 0, scale: 0.85 },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [resumeContext, workspace.canvases, switchCanvas]);
  const createCanvas = () => {
    const next = blankCanvas(
      workspace.projects.some((project) => project.id === props.projectFilter)
        ? props.projectFilter
        : "",
    );
    next.title = `Canvas ${workspace.canvases.length + 1}`;
    setSelected("");
    setSelectedEdge("");
    setCamera({ x: 0, y: 0, scale: 1 });
    void save(next);
  };
  const removeSelection = () => {
    const current = canvasRef.current;
    if (!current) return;
    if (selected)
      save({
        ...current,
        cards: current.cards.filter((c) => c.id !== selected),
        edges: current.edges.filter(
          (e) => e.from !== selected && e.to !== selected,
        ),
      });
    else if (selectedEdge)
      save({
        ...current,
        edges: current.edges.filter((e) => e.id !== selectedEdge),
      });
    setSelected("");
    setSelectedEdge("");
    setConnectFrom("");
  };
  const addCard = (type: CanvasCard["type"], entityId = "", text = "") => {
    let current = canvasRef.current;
    if (!current)
      current = blankCanvas(
        workspace.projects.some((project) => project.id === props.projectFilter)
          ? props.projectFilter
          : "",
      );
    const offset = (current.cards.length % 4) * 22;
    const card: CanvasCard = {
      id: uid(),
      type,
      ...(entityId ? { entityId } : {}),
      text,
      color: cardColors[current.cards.length % cardColors.length],
      x: -camera.x / camera.scale - 140 + offset,
      y: -camera.y / camera.scale - 100 + offset,
      width: 280,
      height: type === "media" ? 260 : 210,
    };
    save({ ...current, cards: [...current.cards, card] });
    setSelected(card.id);
    setSelectedEdge("");
    setShowAdd(false);
    setNewText("");
    setAddSearch("");
  };
  const upload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      notify("Choose a file smaller than 20 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await scopedFetch("/api/media", {
        method: "POST",
        body: form,
      });
      const body = (await result.json()) as {
        media?: Media;
        workspace?: Workspace;
        error?: string;
      };
      if (!result.ok || !body.media)
        throw new Error(body.error || "Upload failed");
      const media: Media = body.media;
      if (!body.workspace)
        await mutate({ action: "upsert", entity: "media", item: media });
      setUploadMedia((old) => [...old, media]);
      addCard("media", media.id, media.name);
      notify(`${media.name} added to canvas`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (mediaInput.current) mediaInput.current.value = "";
    }
  };
  const fit = useCallback(() => {
    const current = canvasRef.current;
    if (!current?.cards.length) {
      setCamera({ x: 0, y: 0, scale: 1 });
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    const left = Math.min(...current.cards.map((c) => c.x)) - 65,
      right = Math.max(...current.cards.map((c) => c.x + c.width)) + 65;
    const top = Math.min(...current.cards.map((c) => c.y)) - 65,
      bottom = Math.max(...current.cards.map((c) => c.y + c.height)) + 65;
    const scale = clamp(
      Math.min(
        (rect?.width || width) / (right - left),
        (rect?.height || height) / (bottom - top),
      ),
      0.15,
      1.5,
    );
    setCamera({
      x: (-(left + right) / 2) * scale,
      y: (-(top + bottom) / 2) * scale,
      scale,
    });
  }, [canvasRef, ref, width, height]);
  useEffect(() => {
    if (fittedCanvas.current === canvasId) return;
    fittedCanvas.current = canvasId;
    if (!canvasId || restoredCameraFor.current === canvasId) return;
    const frame = requestAnimationFrame(() => {
      if (restoredCameraFor.current !== canvasId) fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasId, fit]);
  const start = (
    event: ReactPointerEvent,
    type: CanvasDrag["type"],
    card?: CanvasCard,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (card) {
      setSelected(card.id);
      setSelectedEdge("");
    }
    drag.current = {
      type,
      id: card?.id,
      start: { x: event.clientX, y: event.clientY },
      origin: card ? { x: card.x, y: card.y } : camera,
      width: card?.width,
      height: card?.height,
      moved: false,
    };
  };
  const move = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const dx = event.clientX - active.start.x,
      dy = event.clientY - active.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    if (active.type === "pan")
      setCamera((old) => ({
        ...old,
        x: active.origin.x + dx,
        y: active.origin.y + dy,
      }));
    else if (active.type === "move")
      updateCard(
        active.id!,
        {
          x: active.origin.x + dx / camera.scale,
          y: active.origin.y + dy / camera.scale,
        },
        false,
      );
    else
      updateCard(
        active.id!,
        {
          width: Math.max(200, active.width! + dx / camera.scale),
          height: Math.max(150, active.height! + dy / camera.scale),
        },
        false,
      );
  };
  const end = () => {
    if (drag.current?.moved && drag.current.type !== "pan" && canvasRef.current)
      save(canvasRef.current);
    drag.current = null;
  };
  const selectCard = (id: string) => {
    if (connecting) {
      if (!connectFrom) {
        setConnectFrom(id);
        notify("Choose another card to connect it.");
      } else if (connectFrom !== id && canvasRef.current) {
        const current = canvasRef.current;
        if (!current.edges.some((e) => e.from === connectFrom && e.to === id))
          save({
            ...current,
            edges: [
              ...current.edges,
              { id: uid(), from: connectFrom, to: id, label: "" },
            ],
          });
        setConnecting(false);
        setConnectFrom("");
      }
    }
    setSelected(id);
    setSelectedEdge("");
  };
  const openCard = (card: CanvasCard) => {
    if (card.type === "note" && card.entityId) props.openNote(card.entityId);
    if (card.type === "task" && card.entityId) props.openTask(card.entityId);
  };
  const rename = () => {
    setEditingTitle(false);
    if (canvasRef.current && titleDraft.trim())
      void save({ ...canvasRef.current, title: titleDraft.trim() });
  };
  const visibleItems =
    addType === "note"
      ? workspace.notes.filter((n) =>
          `${n.title} ${n.folder}`
            .toLowerCase()
            .includes(addSearch.toLowerCase()),
        )
      : addType === "task"
        ? workspace.tasks.filter((t) =>
            `${t.title} ${t.key}`
              .toLowerCase()
              .includes(addSearch.toLowerCase()),
          )
        : [];

  return (
    <div className="visual-feature canvas-feature">
      <div className="visual-heading">
        <div>
          <div className="visual-eyebrow">ROOM TO THINK</div>
          <h1>
            Canvas{" "}
            <span className="visual-count">{workspace.canvases.length}</span>
          </h1>
          <p>Arrange your ideas. Connect the pieces. Plan your next step.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowAdd(true);
            setAddType("note");
          }}
        >
          <Plus size={16} /> Add to canvas
        </button>
      </div>
      <div className="canvas-toolbar">
        <div className="canvas-selector">
          <Layers3 size={16} />
          <select
            aria-label="Select canvas"
            value={canvasId}
            onChange={(e) => switchCanvas(e.target.value)}
          >
            {!canvasId && <option value="">Your first canvas</option>}
            {canvasOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {draftOptions.some((draft) => draft.id === item.id)
                  ? " · Unsaved"
                  : ""}
              </option>
            ))}
            {canvas && !canvasOptions.some((item) => item.id === canvas.id) && (
              <option value={canvas.id}>{canvas.title}</option>
            )}
          </select>
        </div>
        <button
          className="btn-icon"
          title="New canvas"
          aria-label="New canvas"
          onClick={createCanvas}
        >
          <Plus size={16} />
        </button>
        <span className="canvas-toolbar-divider" />
        {canvas && (
          <label className="canvas-project-control" data-tour="canvas-project">
            <span>Project</span>
            <select
              aria-label="Canvas project"
              value={canvas.projectId || ""}
              onChange={(event) => {
                const current = canvasRef.current;
                if (current)
                  void save({ ...current, projectId: event.target.value });
              }}
            >
              <option value="">No project</option>
              {canvas.projectId &&
                !workspace.projects.some(
                  (project) => project.id === canvas.projectId,
                ) && (
                  <option value={canvas.projectId}>
                    Unavailable project · choose another
                  </option>
                )}
              {workspace.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className={`canvas-tool ${connecting ? "active" : ""}`}
          aria-pressed={connecting}
          aria-label={connecting ? "Cancel connecting cards" : "Connect cards"}
          title={connecting ? "Cancel connecting cards" : "Connect cards"}
          onClick={() => {
            setConnecting(!connecting);
            setConnectFrom("");
          }}
        >
          <Link2 size={15} />
          <span>
            {connecting
              ? connectFrom
                ? "Choose target card"
                : "Choose first card"
              : "Connect cards"}
          </span>
        </button>
        <button
          className="canvas-tool"
          onClick={fit}
          aria-label="Fit canvas"
          title="Fit canvas"
        >
          <Focus size={15} />
          <span>Fit canvas</span>
        </button>
        <div
          className="canvas-save-state"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {saving ? (
            <>
              <Loader2 size={13} className="visual-spin" /> Saving…
            </>
          ) : error ? (
            <button
              onClick={() => canvasRef.current && void save(canvasRef.current)}
            >
              Retry save
            </button>
          ) : unsaved ? (
            <button
              onClick={() => canvasRef.current && void save(canvasRef.current)}
            >
              Unsaved · Save now
            </button>
          ) : (
            <>
              <Check size={13} /> Saved
            </>
          )}
        </div>
        <button
          className={`btn-icon ${showInspector ? "canvas-button-active" : ""}`}
          title={showInspector ? "Hide canvas details" : "Show canvas details"}
          aria-label={
            showInspector ? "Hide canvas details" : "Show canvas details"
          }
          aria-expanded={showInspector}
          aria-controls="canvas-details"
          onClick={() => setShowInspector(!showInspector)}
        >
          <Layers3 size={16} />
        </button>
      </div>
      {(recovered || error || storageError) && (
        <div
          className="canvas-recovery-notice"
          role={error || storageError ? "alert" : "status"}
        >
          <div>
            <strong>
              {error
                ? "Canvas changes need attention"
                : recovered
                  ? "Recovered unsaved canvas changes"
                  : "Recovery copy unavailable"}
            </strong>
            <p>
              {error ||
                storageError ||
                "Review this recovery copy, then save it or load the latest saved canvas."}
            </p>
            {error && storageError && <p>{storageError}</p>}
          </div>
          <button className="btn" disabled={saving} onClick={discard}>
            Discard local changes
          </button>
        </div>
      )}
      <div className={`canvas-layout ${showInspector ? "with-inspector" : ""}`}>
        <div
          className={`canvas-surface ${connecting ? "connecting" : ""}`}
          ref={ref}
          tabIndex={0}
          role="region"
          aria-label="Visual planning canvas. Select a card to edit its details."
          aria-describedby="canvas-keyboard-help"
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              removeSelection();
            }
            if (e.key === "Escape") {
              setConnecting(false);
              setConnectFrom("");
              setSelected("");
              setSelectedEdge("");
            }
            if (e.key === "+" || e.key === "=")
              setCamera((c) => ({
                ...c,
                scale: clamp(c.scale * 1.2, 0.15, 2.5),
              }));
            if (e.key === "-")
              setCamera((c) => ({
                ...c,
                scale: clamp(c.scale / 1.2, 0.15, 2.5),
              }));
          }}
          onPointerDown={(e) => {
            if (
              (e.target as Element).closest(
                ".canvas-card, .canvas-edge-target, .visual-zoom, .canvas-quick-add",
              )
            )
              return;
            setSelected("");
            setSelectedEdge("");
            start(e, "pan");
          }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <div
            className="canvas-dot-grid"
            style={{
              backgroundSize: `${22 * camera.scale}px ${22 * camera.scale}px`,
              backgroundPosition: `${width / 2 + camera.x}px ${height / 2 + camera.y}px`,
            }}
          />
          <div
            className="canvas-world"
            style={{
              transform: `translate(${width / 2 + camera.x}px,${height / 2 + camera.y}px) scale(${camera.scale})`,
            }}
          >
            <svg className="canvas-edges">
              <defs>
                <marker
                  id="canvas-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="var(--theme-line-7e769f,#7e769f)"
                  />
                </marker>
                <marker
                  id="canvas-arrow-active"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="var(--theme-ink-c4b7ff,#c4b7ff)"
                  />
                </marker>
              </defs>
              {canvas?.edges.map((connection) => {
                const from = canvasCardsById.get(connection.from),
                  to = canvasCardsById.get(connection.to);
                if (!from || !to) return null;
                const right = to.x + to.width / 2 >= from.x + from.width / 2;
                const a = {
                    x: right ? from.x + from.width : from.x,
                    y: from.y + from.height / 2,
                  },
                  b = {
                    x: right ? to.x : to.x + to.width,
                    y: to.y + to.height / 2,
                  };
                const curve = Math.max(60, Math.abs(b.x - a.x) * 0.45),
                  direction = right ? 1 : -1;
                const path = `M ${a.x},${a.y} C ${a.x + curve * direction},${a.y} ${b.x - curve * direction},${b.y} ${b.x},${b.y}`;
                return (
                  <g
                    key={connection.id}
                    className="canvas-edge-target"
                    role="button"
                    tabIndex={0}
                    aria-label={`Connection${connection.label ? `: ${connection.label}` : ""}. Enter to view details.`}
                    aria-pressed={selectedEdge === connection.id}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedEdge(connection.id);
                      setSelected("");
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdge(connection.id);
                      setSelected("");
                    }}
                  >
                    <path
                      d={path}
                      stroke="transparent"
                      strokeWidth="18"
                      fill="none"
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    />
                    <path
                      d={path}
                      stroke={
                        selectedEdge === connection.id
                          ? "var(--theme-ink-c4b7ff,#c4b7ff)"
                          : "var(--theme-line-6d648b,#6d648b)"
                      }
                      strokeWidth={selectedEdge === connection.id ? 2.5 : 1.7}
                      fill="none"
                      markerEnd={`url(#canvas-arrow${selectedEdge === connection.id ? "-active" : ""})`}
                    />
                    {connection.label && (
                      <g
                        transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}
                      >
                        <rect
                          x={-Math.min(160, connection.label.length * 3.5 + 13)}
                          y="-13"
                          width={Math.min(
                            320,
                            connection.label.length * 7 + 26,
                          )}
                          height="26"
                          rx="7"
                          fill="var(--theme-surface-242333,#242333)"
                          stroke="var(--theme-line-47415e,#47415e)"
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="var(--theme-ink-c6bce1,#c6bce1)"
                          fontSize="11"
                        >
                          {short(connection.label, 42)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
            {canvas?.cards.map((card) => {
              const note =
                card.type === "note"
                  ? notesById.get(card.entityId || "")
                  : undefined;
              const task =
                card.type === "task"
                  ? tasksById.get(card.entityId || "")
                  : undefined;
              const media =
                card.type === "media"
                  ? mediaById.get(card.entityId || "")
                  : undefined;
              const person = task ? peopleById.get(task.assigneeId) : undefined;
              const title =
                note?.title ||
                task?.title ||
                media?.name ||
                (card.type === "url"
                  ? "Web reference"
                  : card.text.split("\n")[0] || "Untitled thought");
              const style = {
                left: card.x,
                top: card.y,
                width: card.width,
                height: card.height,
                "--card-color": cssColor(card.color),
              } as CSSProperties;
              return (
                <article
                  key={card.id}
                  className={`canvas-card canvas-card-${card.type} ${selected === card.id ? "selected" : ""} ${connectFrom === card.id ? "connection-source" : ""}`}
                  style={style}
                  tabIndex={0}
                  role="group"
                  aria-label={`${card.type}: ${title}. Enter to select, arrow keys to move.`}
                  onFocus={() => {
                    setSelected(card.id);
                    setSelectedEdge("");
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      selectCard(card.id);
                    }
                    if (e.key === "Escape") {
                      setConnecting(false);
                      setConnectFrom("");
                    }
                    if (e.key.startsWith("Arrow")) {
                      e.preventDefault();
                      e.stopPropagation();
                      const amount = e.shiftKey ? 40 : 10;
                      updateCard(card.id, {
                        x:
                          card.x +
                          (e.key === "ArrowRight"
                            ? amount
                            : e.key === "ArrowLeft"
                              ? -amount
                              : 0),
                        y:
                          card.y +
                          (e.key === "ArrowDown"
                            ? amount
                            : e.key === "ArrowUp"
                              ? -amount
                              : 0),
                      });
                    }
                    if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      e.stopPropagation();
                      removeSelection();
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectCard(card.id);
                  }}
                  onDoubleClick={() => openCard(card)}
                >
                  <div
                    className="canvas-card-header"
                    onPointerDown={(e) => {
                      if (connecting) {
                        e.stopPropagation();
                        return;
                      }
                      start(e, "move", card);
                    }}
                  >
                    <span>
                      {card.type === "note" ? (
                        <FileText size={13} />
                      ) : card.type === "task" ? (
                        <CheckSquare2 size={13} />
                      ) : card.type === "media" ? (
                        <ImagePlus size={13} />
                      ) : card.type === "url" ? (
                        <Globe2 size={13} />
                      ) : (
                        <StickyNote size={13} />
                      )}
                      <small>
                        {card.type === "note"
                          ? note?.folder || "Note"
                          : card.type === "task"
                            ? task?.key || "Task"
                            : card.type === "text"
                              ? "Thought"
                              : card.type === "url"
                                ? "Reference"
                                : "Attachment"}
                      </small>
                    </span>
                    {(note || task) && (
                      <button
                        aria-label={`Open ${title}`}
                        title="Open"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCard(card);
                        }}
                      >
                        <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                  <div className="canvas-card-content">
                    {card.type === "text" ? (
                      <div className="canvas-text-content">
                        {card.text || "Select this card to add your thoughts."}
                      </div>
                    ) : (
                      <>
                        {card.type !== "media" && <h3>{title}</h3>}
                        {note && (
                          <>
                            <p className="canvas-note-preview">
                              {note.content
                                .replace(/^#{1,6}\s/gm, "")
                                .replace(
                                  /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
                                  (
                                    _match: string,
                                    title: string,
                                    alias: string,
                                  ) => alias || title,
                                )
                                .replace(/[*`]/g, "")
                                .slice(0, 700) ||
                                "This note is waiting for your ideas."}
                            </p>
                            <div className="canvas-card-tags">
                              {note.tags.slice(0, 3).map((tag) => (
                                <span key={tag}>#{tag}</span>
                              ))}
                            </div>
                          </>
                        )}
                        {task && (
                          <>
                            <p className="canvas-task-description">
                              {task.description.slice(0, 250)}
                            </p>
                            <div className="canvas-task-chips">
                              <span
                                className={`canvas-status status-${task.status}`}
                              >
                                <CircleDot size={10} />
                                {task.status.replace(/-/g, " ")}
                              </span>
                              <span
                                className={`canvas-priority priority-${task.priority}`}
                              >
                                {task.priority}
                              </span>
                            </div>
                            {person && (
                              <div className="canvas-task-person">
                                <i
                                  style={{ background: cssColor(person.color) }}
                                >
                                  {person.name.slice(0, 1)}
                                </i>
                                {person.name}
                              </div>
                            )}
                          </>
                        )}
                        {media && <MediaContent media={media} />}
                        {card.type === "media" && !media && (
                          <p className="visual-muted">
                            Attachment unavailable.
                          </p>
                        )}
                        {card.type === "url" &&
                          (isHttp(card.text) ? (
                            <>
                              <a
                                className="canvas-url-link"
                                href={card.text}
                                target="_blank"
                                rel="noopener noreferrer"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {card.text}
                                <ArrowUpRight size={13} />
                              </a>
                              <div className="canvas-web-preview">
                                <iframe
                                  src={card.text}
                                  title={`Reference: ${new URL(card.text).hostname}`}
                                  sandbox="allow-scripts allow-forms"
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                />
                                <small>
                                  Some websites require opening the reference
                                  above.
                                </small>
                              </div>
                            </>
                          ) : (
                            <p className="visual-muted">
                              Select the card and enter a complete https://
                              link.
                            </p>
                          ))}
                        {(card.type === "note" && !note) ||
                        (card.type === "task" && !task) ? (
                          <p className="visual-muted">
                            The linked item has been removed.
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                  <button
                    className="canvas-resize"
                    aria-label={`Resize ${title}. Use arrow keys to adjust its size.`}
                    title="Drag or use arrow keys to resize"
                    onKeyDown={(event) => {
                      if (!event.key.startsWith("Arrow")) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const amount = event.shiftKey ? 40 : 10;
                      updateCard(card.id, {
                        width: Math.max(
                          200,
                          card.width +
                            (event.key === "ArrowRight"
                              ? amount
                              : event.key === "ArrowLeft"
                                ? -amount
                                : 0),
                        ),
                        height: Math.max(
                          150,
                          card.height +
                            (event.key === "ArrowDown"
                              ? amount
                              : event.key === "ArrowUp"
                                ? -amount
                                : 0),
                        ),
                      });
                    }}
                    onPointerDown={(e) => start(e, "resize", card)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span />
                  </button>
                </article>
              );
            })}
          </div>
          {!canvas?.cards.length && (
            <div className="visual-empty-overlay canvas-empty">
              <div className="canvas-empty-icon">
                <Layers3 size={32} />
              </div>
              <h3>Give your ideas some space.</h3>
              <p>
                Bring notes, tasks, references, and loose thoughts together.
                <br />
                Connect them to see what comes next.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setShowAdd(true)}
              >
                <Plus size={15} /> Add your first card
              </button>
            </div>
          )}
          {connecting && (
            <div
              className="canvas-connect-notice"
              role="status"
              aria-live="polite"
            >
              <Link2 size={14} />
              {connectFrom
                ? "Select the card you want to connect to"
                : "Select a source card, then a target card"}
              <button
                aria-label="Cancel connecting"
                onClick={() => {
                  setConnecting(false);
                  setConnectFrom("");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="canvas-quick-add">
            <button
              aria-label="Add text card"
              title="Add a thought"
              onClick={() => {
                setAddType("text");
                setShowAdd(true);
              }}
            >
              <StickyNote size={18} />
            </button>
            <button
              aria-label="Add note card"
              title="Add a note"
              onClick={() => {
                setAddType("note");
                setShowAdd(true);
              }}
            >
              <FileText size={18} />
            </button>
            <button
              aria-label="Add task card"
              title="Add a task"
              onClick={() => {
                setAddType("task");
                setShowAdd(true);
              }}
            >
              <CheckSquare2 size={18} />
            </button>
            <i />
            <button
              aria-label="Upload media"
              title="Add media"
              disabled={uploading}
              onClick={() => mediaInput.current?.click()}
            >
              {uploading ? (
                <Loader2 className="visual-spin" size={18} />
              ) : (
                <ImagePlus size={18} />
              )}
            </button>
          </div>
          <div className="visual-surface-caption">
            {canvas?.cards.length || 0} cards <span>·</span>{" "}
            {canvas?.edges.length || 0} connections
          </div>
          <div className="visual-zoom">
            <button
              aria-label="Zoom out"
              onClick={() =>
                setCamera((c) => ({
                  ...c,
                  scale: clamp(c.scale / 1.2, 0.15, 2.5),
                }))
              }
            >
              <Minus size={16} />
            </button>
            <span>{Math.round(camera.scale * 100)}%</span>
            <button
              aria-label="Zoom in"
              onClick={() =>
                setCamera((c) => ({
                  ...c,
                  scale: clamp(c.scale * 1.2, 0.15, 2.5),
                }))
              }
            >
              <Plus size={16} />
            </button>
            <i />
            <button aria-label="Fit canvas" onClick={fit}>
              <Maximize size={15} />
            </button>
          </div>
        </div>
        {showInspector && (
          <aside
            className="canvas-inspector"
            id="canvas-details"
            aria-label="Canvas details"
          >
            <div className="visual-inspector-label">
              {selectedCard
                ? "CARD DETAILS"
                : edge
                  ? "CONNECTION"
                  : "CANVAS DETAILS"}
            </div>
            {selectedCard ? (
              <>
                <div className="canvas-inspector-type">
                  <span style={{ color: cssColor(selectedCard.color) }}>
                    {selectedCard.type === "text"
                      ? "Thought"
                      : selectedCard.type === "url"
                        ? "Web reference"
                        : selectedCard.type}
                  </span>
                  <button
                    className="btn-icon visual-danger"
                    aria-label="Delete card"
                    title="Delete card"
                    onClick={removeSelection}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <label className="visual-field-label">Accent color</label>
                <div
                  className="canvas-colors"
                  role="group"
                  aria-label="Card accent color"
                >
                  {cardColors.map((color, index) => (
                    <button
                      key={color}
                      aria-label={`${cardColorNames[index]} accent`}
                      aria-pressed={selectedCard.color === color}
                      title={`${cardColorNames[index]} accent`}
                      style={{ background: color }}
                      className={selectedCard.color === color ? "active" : ""}
                      onClick={() => updateCard(selectedCard.id, { color })}
                    >
                      {selectedCard.color === color && <Check size={12} />}
                    </button>
                  ))}
                </div>
                {(selectedCard.type === "text" ||
                  selectedCard.type === "url") && (
                  <>
                    <label
                      className="visual-field-label"
                      htmlFor="canvas-card-text"
                    >
                      {selectedCard.type === "url"
                        ? "Website address"
                        : "Your thoughts"}
                    </label>
                    <textarea
                      id="canvas-card-text"
                      className="field canvas-edit-text"
                      value={selectedCard.text}
                      placeholder={
                        selectedCard.type === "url"
                          ? "https://…"
                          : "An idea worth exploring…"
                      }
                      onChange={(e) => {
                        updateCard(
                          selectedCard.id,
                          { text: e.target.value },
                          false,
                        );
                      }}
                      onBlur={() =>
                        canvasRef.current && save(canvasRef.current)
                      }
                    />
                    <p className="visual-input-hint">
                      {selectedCard.type === "url"
                        ? "Use a complete http:// or https:// address."
                        : "Changes save when you leave this field."}
                    </p>
                  </>
                )}
                {(selectedCard.type === "note" ||
                  selectedCard.type === "task") && (
                  <button
                    className="btn graph-open"
                    onClick={() => openCard(selectedCard)}
                  >
                    Open {selectedCard.type}
                    <ArrowUpRight size={14} />
                  </button>
                )}
                <div className="canvas-card-size">
                  <label>
                    Width
                    <input
                      type="number"
                      className="field"
                      min={200}
                      value={Math.round(selectedCard.width)}
                      onChange={(e) =>
                        updateCard(
                          selectedCard.id,
                          {
                            width: Math.max(200, Number(e.target.value) || 200),
                          },
                          false,
                        )
                      }
                      onBlur={() =>
                        canvasRef.current && save(canvasRef.current)
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      type="number"
                      className="field"
                      min={150}
                      value={Math.round(selectedCard.height)}
                      onChange={(e) =>
                        updateCard(
                          selectedCard.id,
                          {
                            height: Math.max(
                              150,
                              Number(e.target.value) || 150,
                            ),
                          },
                          false,
                        )
                      }
                      onBlur={() =>
                        canvasRef.current && save(canvasRef.current)
                      }
                    />
                  </label>
                </div>
                <label className="visual-field-label">Position</label>
                <div className="canvas-card-size">
                  <label>
                    X
                    <input
                      type="number"
                      className="field"
                      value={Math.round(selectedCard.x)}
                      onChange={(e) =>
                        updateCard(
                          selectedCard.id,
                          { x: Number(e.target.value) || 0 },
                          false,
                        )
                      }
                      onBlur={() =>
                        canvasRef.current && save(canvasRef.current)
                      }
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      className="field"
                      value={Math.round(selectedCard.y)}
                      onChange={(e) =>
                        updateCard(
                          selectedCard.id,
                          { y: Number(e.target.value) || 0 },
                          false,
                        )
                      }
                      onBlur={() =>
                        canvasRef.current && save(canvasRef.current)
                      }
                    />
                  </label>
                </div>
                <button
                  className="btn canvas-connect-button"
                  aria-pressed={connecting && connectFrom === selectedCard.id}
                  onClick={() => {
                    setConnecting(true);
                    setConnectFrom(selectedCard.id);
                  }}
                >
                  <Link2 size={14} /> Connect this card
                </button>
                <p className="visual-muted canvas-detail-hint">
                  Drag the header to move, or use arrow keys on the card. Adjust
                  width, height, and position above for precise placement.
                </p>
              </>
            ) : edge ? (
              <>
                <div className="canvas-inspector-type">
                  <span>Directed connection</span>
                  <button
                    className="btn-icon visual-danger"
                    aria-label="Delete connection"
                    onClick={removeSelection}
                  >
                    <Unlink size={15} />
                  </button>
                </div>
                <label
                  className="visual-field-label"
                  htmlFor="canvas-edge-label"
                >
                  Connection label
                </label>
                <input
                  key={edge.id}
                  id="canvas-edge-label"
                  className="field"
                  defaultValue={edge.label}
                  placeholder="e.g. inspires, depends on…"
                  onBlur={(e) => {
                    const current = canvasRef.current;
                    if (current)
                      save({
                        ...current,
                        edges: current.edges.map((item) =>
                          item.id === edge.id
                            ? { ...item, label: e.target.value }
                            : item,
                        ),
                      });
                  }}
                />
                <p className="visual-muted canvas-detail-hint">
                  Give the connection a name to explain how these ideas relate.
                </p>
              </>
            ) : (
              <>
                <div className="canvas-detail-icon">
                  <Layers3 size={25} />
                </div>
                {editingTitle ? (
                  <input
                    className="field canvas-title-input"
                    aria-label="Canvas title"
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={rename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename();
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                  />
                ) : (
                  <button
                    className="canvas-title-button"
                    onClick={() => {
                      setEditingTitle(true);
                      setTitleDraft(canvas?.title || "Untitled canvas");
                    }}
                  >
                    {canvas?.title || "Your first canvas"}
                    <span>Click to rename</span>
                  </button>
                )}
                <p className="visual-muted">
                  A living map of your ideas. Bring related work closer and
                  connect the dots.
                </p>
                <div className="graph-stats canvas-stats">
                  <div>
                    <strong>{canvas?.cards.length || 0}</strong>
                    <span>cards</span>
                  </div>
                  <div>
                    <strong>{canvas?.edges.length || 0}</strong>
                    <span>connections</span>
                  </div>
                </div>
                <div className="visual-inspector-label canvas-guide-heading">
                  MAKE IT YOURS
                </div>
                <div className="graph-hint">
                  <StickyNote size={15} />
                  <span>Add a thought, reminder, or project idea.</span>
                </div>
                <div className="graph-hint">
                  <Link2 size={15} />
                  <span>Connect cards and label their relationships.</span>
                </div>
                <div className="graph-hint">
                  <ImagePlus size={15} />
                  <span>Bring in concept art, audio, videos, and PDFs.</span>
                </div>
                <button className="btn graph-open" onClick={createCanvas}>
                  <Plus size={14} /> New canvas
                </button>
              </>
            )}
          </aside>
        )}
      </div>
      <div className="visual-footer">
        <span id="canvas-keyboard-help">
          <MousePointer2 size={13} /> Drag to pan · Scroll or +/− to zoom ·
          Arrow keys move a focused card
        </span>
        <span>
          {error
            ? "Unsaved changes — retry saving above"
            : "A space for the ideas between the tasks."}
        </span>
      </div>
      <input
        ref={mediaInput}
        type="file"
        className="visual-hidden-input"
        accept="image/*,audio/*,video/*,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
      {showAdd && (
        <div
          className="visual-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false);
          }}
        >
          <div
            ref={addDialog}
            className="visual-add-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-add-title"
          >
            <div className="visual-modal-heading">
              <div>
                <h2 id="canvas-add-title">Add to your canvas</h2>
                <p>Another piece of the bigger picture.</p>
              </div>
              <button
                className="btn-icon"
                aria-label="Close add card"
                onClick={() => setShowAdd(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div
              className="canvas-add-types"
              role="group"
              aria-label="Card type"
            >
              {(
                [
                  { type: "note", label: "Note", icon: FileText },
                  { type: "task", label: "Task", icon: CheckSquare2 },
                  { type: "text", label: "Thought", icon: StickyNote },
                  { type: "media", label: "Media", icon: ImagePlus },
                  { type: "url", label: "Website", icon: Globe2 },
                ] as const
              ).map((item) => (
                <button
                  key={item.type}
                  aria-pressed={addType === item.type}
                  className={addType === item.type ? "active" : ""}
                  onClick={() => {
                    setAddType(item.type);
                    setAddSearch("");
                    setNewText("");
                  }}
                >
                  <item.icon size={17} />
                  {item.label}
                </button>
              ))}
            </div>
            {(addType === "note" || addType === "task") && (
              <>
                <label className="visual-search canvas-add-search">
                  <Search size={15} />
                  <input
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder={`Find a ${addType}…`}
                    aria-label={`Search ${addType}s`}
                  />
                </label>
                <div className="canvas-add-list">
                  {visibleItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => addCard(addType, item.id)}
                    >
                      <span className="canvas-add-item-icon">
                        {addType === "note" ? (
                          <FileText size={17} />
                        ) : (
                          <CheckSquare2 size={17} />
                        )}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {"key" in item ? item.key : item.folder || item.kind}
                        </small>
                      </span>
                      <Plus size={16} />
                    </button>
                  ))}
                  {!visibleItems.length && (
                    <div className="canvas-no-results">
                      No {addType}s found. Create one from the workspace first.
                    </div>
                  )}
                </div>
              </>
            )}
            {addType === "text" && (
              <div className="canvas-add-form">
                <label
                  className="visual-field-label"
                  htmlFor="new-canvas-thought"
                >
                  What are you thinking?
                </label>
                <textarea
                  id="new-canvas-thought"
                  className="field"
                  rows={7}
                  placeholder="An idea, a useful detail, a question worth exploring…"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => addCard("text", "", newText)}
                >
                  <Plus size={15} /> Add thought
                </button>
              </div>
            )}
            {addType === "url" && (
              <div className="canvas-add-form">
                <label className="visual-field-label" htmlFor="new-canvas-url">
                  Reference website
                </label>
                <input
                  id="new-canvas-url"
                  className="field"
                  placeholder="https://example.com"
                  type="url"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isHttp(newText))
                      addCard("url", "", newText);
                  }}
                />
                <p className="visual-muted">
                  Keep useful references close to the ideas they inspire.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={!isHttp(newText)}
                  onClick={() => addCard("url", "", newText)}
                >
                  <Plus size={15} /> Add website
                </button>
              </div>
            )}
            {addType === "media" && (
              <div className="canvas-add-form">
                <button
                  className="canvas-upload-zone"
                  onClick={() => mediaInput.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 size={28} className="visual-spin" />
                  ) : (
                    <ImagePlus size={28} />
                  )}
                  <strong>
                    {uploading
                      ? "Uploading your file…"
                      : "Bring your references in"}
                  </strong>
                  <span>
                    Images, PDFs, audio, and video · Up to 20 MB per file
                  </span>
                </button>
                {allMedia.length > 0 && (
                  <>
                    <label className="visual-field-label">
                      Or use an existing attachment
                    </label>
                    <div className="canvas-add-list canvas-existing-media">
                      {allMedia.map((media) => (
                        <button
                          key={media.id}
                          onClick={() => addCard("media", media.id, media.name)}
                        >
                          <ImagePlus size={17} />
                          <span>
                            <strong>{media.name}</strong>
                            <small>
                              {(media.size / 1024 / 1024).toFixed(1)} MB
                            </small>
                          </span>
                          <Plus size={15} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaContent({ media }: { media: Media }) {
  // Media addresses come from the authenticated upload endpoint, never from card text.
  // Local authenticated media URLs need their original response; image optimization would add a second fetch path.
  if (media.type.startsWith("image/"))
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={media.url} alt={media.name} draggable={false} loading="lazy" />
    );
  if (media.type.startsWith("video/"))
    return (
      <video
        controls
        preload="metadata"
        src={media.url}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  if (media.type.startsWith("audio/"))
    return (
      <div className="canvas-audio">
        <span>Audio reference</span>
        <audio
          controls
          preload="metadata"
          src={media.url}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <small>{media.name}</small>
      </div>
    );
  if (media.type === "application/pdf")
    return (
      <object data={media.url} type="application/pdf">
        <a href={media.url} target="_blank" rel="noopener noreferrer">
          Open {media.name}
        </a>
      </object>
    );
  return (
    <a href={media.url} target="_blank" rel="noopener noreferrer">
      <ArrowDownToLine size={16} /> Open {media.name}
    </a>
  );
}
