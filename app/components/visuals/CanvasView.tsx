"use client";
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
  Plus,
  StickyNote,
  X,
} from "lucide-react";
import {
  uid,
  type Canvas,
  type CanvasCard,
  type Media,
  type Workspace,
} from "../../lib/types";
import { useWorkspaceFetch } from "../WorkspaceScope";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { useCanvasPersistence } from "../useCanvasPersistence";
import { clamp, short, cssColor, type Camera } from "./visual-helpers";
import { useSurfaceSize } from "./useSurfaceSize";
import {
  blankCanvas,
  sanitizeCanvas,
  cardColors,
  canvasNotePreview,
  isHttp,
  type CanvasDrag,
  type CanvasViewProps,
} from "./canvas-model";
import { CanvasAddDialog } from "./CanvasAddDialog";
import { CanvasInspector } from "./CanvasInspector";
import { MediaContent } from "./MediaContent";
import "../visuals.css";
import "../project-planning.css";

export function CanvasView(props: CanvasViewProps) {
  const scopedFetch = useWorkspaceFetch();
  const { workspace, mutate, notify, resumeContext, onContextChange } = props;
  const { canCreate, canEditProject } = useWorkspacePermissions(workspace);
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
  const writable = canvas
    ? canEditProject(canvas.projectId || "")
    : canCreate && canEditProject(props.projectFilter || "");
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 0.85 });
  const resumedRoom = useRef("");
  const { ref, width, height } = useSurfaceSize();
  const [selected, setSelected] = useState("");
  const [selectedEdge, setSelectedEdge] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectFrom, setConnectFrom] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<CanvasCard["type"]>("note");
  const [addSearch, setAddSearch] = useState("");
  const [newText, setNewText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [uploadMedia, setUploadMedia] = useState<Media[]>([]);
  const drag = useRef<CanvasDrag | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const restoredCameraFor = useRef<string | null>(null);
  const fittedCanvas = useRef("");
  const canvasOptions = [
    ...new Map(
      [...workspace.canvases, ...draftOptions].map((item) => [item.id, item]),
    ).values(),
  ];
  const allMedia = useMemo(
    () => [
      ...uploadMedia,
      ...workspace.media.filter((m) => !uploadMedia.some((u) => u.id === m.id)),
    ],
    [uploadMedia, workspace.media],
  );
  const canvasCardsById = useMemo(
    () => new Map(canvas?.cards.map((card) => [card.id, card]) || []),
    [canvas],
  );
  const notesById = useMemo(
    () => new Map(workspace.notes.map((note) => [note.id, note])),
    [workspace.notes],
  );
  const notePreviewsById = useMemo(
    () =>
      new Map(
        workspace.notes.map((note) => [
          note.id,
          canvasNotePreview(note.content),
        ]),
      ),
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
  const mediaById = useMemo(
    () => new Map(allMedia.map((media) => [media.id, media])),
    [allMedia],
  );
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
    (input: Canvas) => {
      const saved = workspace.canvases.find((item) => item.id === input.id);
      if (
        !canEditProject(input.projectId || "") ||
        (saved && !canEditProject(saved.projectId || ""))
      ) {
        notify(
          "This canvas is view only. Ask an administrator for editing access.",
        );
        return;
      }
      return persistCanvas(sanitizeCanvas(input));
    },
    [persistCanvas, canEditProject, workspace.canvases, notify],
  );
  const updateCard = (
    id: string,
    patch: Partial<CanvasCard>,
    persist = true,
  ) => {
    const current = canvasRef.current;
    if (!current || !writable) return;
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
    if (!canCreate || !canEditProject(props.projectFilter || "")) return;
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
    if (!current || !writable) return;
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
    if (!writable) return;
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
    if (!writable) return;
    if (file.size > 20 * 1024 * 1024) {
      notify("Choose a file smaller than 20 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "projectId",
        canvasRef.current?.projectId || props.projectFilter || "",
      );
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
    if (type !== "pan" && !writable) return;
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
    if (connecting && writable) {
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
    if (writable && canvasRef.current && titleDraft.trim())
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
          disabled={!writable}
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
          disabled={!canCreate || !canEditProject(props.projectFilter || "")}
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
              disabled={!writable}
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
                <option
                  key={project.id}
                  value={project.id}
                  disabled={!canEditProject(project.id)}
                >
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
          disabled={!writable}
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
          {!writable ? (
            <span>View only</span>
          ) : saving ? (
            <>
              <Loader2 size={13} className="visual-spin" /> Saving…
            </>
          ) : error ? (
            <button
              onClick={() => canvasRef.current && void save(canvasRef.current)}
              disabled={!writable}
            >
              Retry save
            </button>
          ) : unsaved ? (
            <button
              onClick={() => canvasRef.current && void save(canvasRef.current)}
              disabled={!writable}
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
          aria-label={`Visual planning canvas. Select a card to ${writable ? "edit" : "view"} its details.`}
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
                  aria-label={`${card.type}: ${title}. Enter to select${writable ? ", arrow keys to move" : " and view details"}.`}
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
                              {notePreviewsById.get(note.id) ||
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
                    disabled={!writable}
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
                disabled={!writable}
                onClick={() => setShowAdd(true)}
              >
                <Plus size={15} /> Add your first card
              </button>
            </div>
          )}
          {connecting && writable && (
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
              disabled={!writable}
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
              disabled={!writable}
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
              disabled={!writable}
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
              disabled={!writable || uploading}
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
          <CanvasInspector
            canvas={canvas}
            selectedCard={selectedCard}
            edge={edge}
            writable={writable}
            canCreateCanvas={
              canCreate && canEditProject(props.projectFilter || "")
            }
            connectingFrom={connecting ? connectFrom : ""}
            titleEditor={{
              active: editingTitle,
              value: titleDraft,
              onChange: setTitleDraft,
              onStart: () => {
                setEditingTitle(true);
                setTitleDraft(canvas?.title || "Untitled canvas");
              },
              onCommit: rename,
              onCancel: () => setEditingTitle(false),
            }}
            updateCard={updateCard}
            onCommit={() => {
              if (canvasRef.current) void save(canvasRef.current);
            }}
            onDeleteSelection={removeSelection}
            onOpenCard={openCard}
            onConnect={(id) => {
              setConnecting(true);
              setConnectFrom(id);
            }}
            onConnectionLabelChange={(id, label) => {
              const current = canvasRef.current;
              if (current)
                void save({
                  ...current,
                  edges: current.edges.map((item) =>
                    item.id === id ? { ...item, label } : item,
                  ),
                });
            }}
            onCreateCanvas={createCanvas}
          />
        )}
      </div>
      <div className="visual-footer">
        <span id="canvas-keyboard-help">
          <MousePointer2 size={13} /> Drag to pan · Scroll or +/− to zoom ·
          {writable
            ? "Arrow keys move a focused card"
            : "View only: open linked items from their cards"}
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
        disabled={!writable}
        className="visual-hidden-input"
        accept="image/*,audio/*,video/*,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
      {showAdd && writable && (
        <CanvasAddDialog
          addType={addType}
          addSearch={addSearch}
          newText={newText}
          visibleItems={visibleItems}
          allMedia={allMedia}
          uploading={uploading}
          onClose={() => setShowAdd(false)}
          onTypeChange={setAddType}
          onSearchChange={setAddSearch}
          onTextChange={setNewText}
          addCard={addCard}
          onUploadRequest={() => mediaInput.current?.click()}
        />
      )}
    </div>
  );
}
