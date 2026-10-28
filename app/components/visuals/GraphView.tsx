"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUpRight,
  CheckSquare2,
  FileText,
  Focus,
  Globe2,
  Layers3,
  Link2,
  Maximize,
  Minus,
  MousePointer2,
  Network,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { FeatureProps, EntityRef } from "../../lib/types";
import { entityKey, relationshipImpact } from "../../lib/relationships";
import GraphRelationships from "../GraphRelationships";
import { clamp, short, type Camera, type Point } from "./visual-helpers";
import { useSurfaceSize } from "./useSurfaceSize";
import {
  graphData,
  layoutGraph,
  nodeRadius,
  type GraphNode,
} from "./graph-model";
import "../visuals.css";
import "../project-planning.css";

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
  const { ref, width, height } = useSurfaceSize();
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
          <h1>
            Relationship graph{" "}
            <span className="visual-count">{data.nodes.length}</span>
          </h1>
          <p>View links between notes, tasks, and projects.</p>
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
                <span>Selected item</span>
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
                    No connections yet. Add note links or relationships to
                    connect items.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="visual-inspector-label">Graph controls</div>
              <div className="graph-intro-icon">
                <Network size={28} />
              </div>
              <h3>Connections</h3>
              <p className="visual-muted">
                Select an item to see its details and links.
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
