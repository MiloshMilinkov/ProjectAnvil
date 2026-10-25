"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Flag,
  Layers3,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  uid,
  statuses,
  type FeatureProps,
  type Milestone,
  type Project,
  type Task,
  type Media,
} from "../lib/types";
import {
  effectiveMilestoneId,
  milestoneProgress,
  projectProgress,
  taskChildrenProgress,
  type PlanningProgress,
} from "../lib/planning-progress";
import { TaskDates, useCalendarToday } from "./TaskSchedule";
import MilestoneEditor from "./MilestoneEditor";
import ProjectAccessPanel from "./ProjectAccessPanel";
import WatchControl from "./WatchControl";
import { useWorkspacePermissions } from "./WorkspacePermissions";
import { useDraftScope } from "./useRecoverableDraft";
import { moveToTrash } from "../lib/trash-actions";
import "./project-planning.css";

type Props = FeatureProps & {
  projectId: string;
  onBack: () => void;
  onEdit: () => void;
  onCreateTask: (projectId: string, milestoneId?: string) => void;
  onOpenCanvas: (id: string) => void;
};
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function Progress({
  progress,
  label,
}: {
  progress: PlanningProgress;
  label: string;
}) {
  return (
    <div className="project-planning-progress">
      <div>
        <span>
          {progress.completed} of {progress.total} tasks complete
        </span>
        <strong>{progress.percent}%</strong>
      </div>
      <progress
        aria-label={label}
        value={progress.completed}
        max={progress.total || 1}
      />
    </div>
  );
}

function taskOrder(tasks: Task[]) {
  const children = new Map<string, Task[]>();
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const parent = task.parentId && ids.has(task.parentId) ? task.parentId : "";
    const siblings = children.get(parent) || [];
    siblings.push(task);
    children.set(parent, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  const pending = (children.get("") || [])
    .map((task) => ({ task, depth: 0 }))
    .reverse();
  const ordered: { task: Task; depth: number }[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const entry = pending.pop()!;
    if (seen.has(entry.task.id)) continue;
    seen.add(entry.task.id);
    ordered.push(entry);
    pending.push(
      ...(children.get(entry.task.id) || [])
        .map((task) => ({ task, depth: entry.depth + 1 }))
        .reverse(),
    );
  }
  return ordered;
}

export default function ProjectHome({
  workspace,
  projectId,
  mutate,
  notify,
  openTask,
  openNote,
  onBack,
  onEdit,
  onCreateTask,
  onOpenCanvas,
}: Props) {
  const referenceDate = useCalendarToday();
  const permissions = useWorkspacePermissions(workspace);
  const readOnly = !permissions.canEditProject(projectId);
  const draftScope = useDraftScope();
  const project = workspace.projects.find((item) => item.id === projectId);
  const tasks = useMemo(
    () =>
      taskOrder(workspace.tasks.filter((task) => task.projectId === projectId)),
    [workspace.tasks, projectId],
  );
  const taskMap = useMemo(
    () => new Map(workspace.tasks.map((task) => [task.id, task])),
    [workspace.tasks],
  );
  const notes = useMemo(
    () =>
      workspace.notes
        .filter((note) => note.projectId === projectId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [workspace.notes, projectId],
  );
  const canvases = workspace.canvases.filter(
    (canvas) => canvas.projectId === projectId,
  );
  const unattached = workspace.canvases.filter((canvas) => !canvas.projectId);
  const [milestoneEditor, setMilestoneEditor] = useState<
    Milestone | "new" | null
  >(null);
  const [archived, setArchived] = useState(false);
  const [taskLimit, setTaskLimit] = useState(20);
  const [noteLimit, setNoteLimit] = useState(6);
  const [canvasLimit, setCanvasLimit] = useState(6);
  const [attachmentLimit, setAttachmentLimit] = useState(12);
  const [attachId, setAttachId] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const guard = useRef(false);
  const canvasCreateId = useRef(uid());
  const collectionButton = useRef<HTMLButtonElement>(null);
  const attachSelect = useRef<HTMLSelectElement>(null);
  const newCanvasButton = useRef<HTMLButtonElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const attachmentsHeading = useRef<HTMLHeadingElement>(null);
  const milestoneOpener = useRef<HTMLButtonElement | null>(null);
  const restoreMilestoneFocus = useRef(false);
  const focusAfter = useRef<"milestones" | "canvases" | "attachments" | null>(
    null,
  );
  useEffect(() => {
    if (pending) return;
    if (error) errorRegion.current?.focus();
    else if (focusAfter.current === "milestones")
      collectionButton.current?.focus();
    else if (focusAfter.current === "canvases")
      (attachSelect.current || newCanvasButton.current)?.focus();
    else if (focusAfter.current === "attachments")
      attachmentsHeading.current?.focus();
    focusAfter.current = null;
  }, [pending, error]);
  useEffect(() => {
    if (milestoneEditor || !restoreMilestoneFocus.current) return;
    const opener = milestoneOpener.current;
    (opener?.isConnected && !opener.disabled
      ? opener
      : collectionButton.current
    )?.focus();
    restoreMilestoneFocus.current = false;
  }, [milestoneEditor]);
  if (!project)
    return (
      <div className="page project-home">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          All projects
        </button>
        <h1>Project unavailable</h1>
        <p>
          This project may have moved to Trash or your workspace access may have
          changed.
        </p>
      </div>
    );
  const progress = projectProgress(workspace, projectId);
  const milestones = (project.milestones || []).filter(
    (item) => item.archived === archived,
  );
  const activeMilestones = (project.milestones || []).filter(
    (item) => !item.archived,
  );

  async function archiveMilestone(item: Milestone) {
    if (guard.current || !project || readOnly) return;
    guard.current = true;
    setPending(item.id);
    setError("");
    try {
      await mutate({
        action: "upsert",
        entity: "projects",
        item: {
          id: project.id,
          milestones: (project.milestones || []).map((entry) =>
            entry.id === item.id
              ? { ...entry, archived: !entry.archived }
              : entry,
          ),
        },
        base: { ...project },
      });
      notify(
        item.archived
          ? "Milestone restored"
          : "Milestone archived. Its task assignments are kept.",
      );
      focusAfter.current = "milestones";
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The milestone could not be changed. Try again after refreshing the project.",
      );
    } finally {
      guard.current = false;
      setPending("");
    }
  }
  async function attachCanvas() {
    const canvas = workspace.canvases.find((item) => item.id === attachId);
    if (!canvas || !project || guard.current || readOnly) return;
    guard.current = true;
    setPending("attach");
    setError("");
    try {
      await mutate({
        action: "upsert",
        entity: "canvases",
        item: { id: canvas.id, projectId },
        base: { ...canvas, projectId: canvas.projectId || "" },
      });
      setAttachId("");
      focusAfter.current = "canvases";
      notify("Canvas attached to project");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The canvas could not be attached.",
      );
    } finally {
      guard.current = false;
      setPending("");
    }
  }
  async function removeAttachment(file: Media) {
    if (guard.current || readOnly) return;
    guard.current = true;
    setPending(file.id);
    setError("");
    try {
      await moveToTrash(
        mutate,
        notify,
        { entity: "media", id: file.id, base: { ...file } },
        "Attachment",
        draftScope,
      );
      focusAfter.current = "attachments";
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This attachment could not be moved to Trash.",
      );
    } finally {
      guard.current = false;
      setPending("");
    }
  }
  async function createCanvas() {
    if (guard.current || !project || readOnly) return;
    guard.current = true;
    setPending("canvas");
    setError("");
    const id = canvasCreateId.current;
    try {
      await mutate({
        action: "upsert",
        entity: "canvases",
        item: {
          id,
          title: `${project.name} canvas`.slice(0, 300),
          projectId,
          cards: [],
          edges: [],
        },
        base: null,
      });
      canvasCreateId.current = uid();
      notify("Project canvas created");
      onOpenCanvas(id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The canvas could not be created.",
      );
    } finally {
      guard.current = false;
      setPending("");
    }
  }

  return (
    <div className="page project-home" data-tour="project-home">
      <button className="text-button project-home-back" onClick={onBack}>
        <ArrowLeft size={16} />
        All projects
      </button>
      <header className="project-home-heading">
        <div>
          <span className="eyebrow">PROJECT HOME · {project.key}</span>
          <h1>{project.name}</h1>
          <p>
            {project.description ||
              "Bring the tasks, notes, and canvases for this project together."}
          </p>
        </div>
        <div className="project-home-heading-actions">
          <WatchControl
            reference={{ type: "project", id: projectId }}
            notify={notify}
          />
          <button
            className="btn btn-secondary"
            onClick={onEdit}
            disabled={readOnly}
          >
            <Pencil size={15} />
            Edit project
          </button>
          <button
            className="btn btn-primary"
            disabled={readOnly}
            onClick={() => onCreateTask(projectId)}
          >
            <Plus size={16} />
            Create task
          </button>
        </div>
      </header>
      <ProjectAccessPanel projectId={projectId} notify={notify} />
      <section className="project-home-summary" aria-label="Project overview">
        <div>
          <span className="project-status-label">
            {project.status || "Planning"}
          </span>
          {project.targetDate && (
            <span>
              <CalendarDays size={15} />
              Target {dateLabel(project.targetDate)}
            </span>
          )}
          <span>
            <Flag size={15} />
            {activeMilestones.length} active milestones
          </span>
        </div>
        {project.goal && (
          <p className="project-home-goal">
            <strong>Goal</strong>
            {project.goal}
          </p>
        )}
        <Progress
          progress={progress}
          label={`${project.name} task completion`}
        />
        <p className="project-progress-help">
          Parent tasks group the work; totals count tasks without child tasks.
        </p>
      </section>
      {error && (
        <div
          ref={errorRegion}
          className="form-error"
          role="alert"
          tabIndex={-1}
        >
          {error}
        </div>
      )}
      <section className="project-home-section" data-tour="milestones">
        <header>
          <div>
            <h2>
              <Flag size={19} />
              Milestones
            </h2>
            <p>Clear outcomes along the way, with progress from their tasks.</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={(event) => {
              milestoneOpener.current = event.currentTarget;
              setMilestoneEditor("new");
            }}
            disabled={
              readOnly || !!pending || (project.milestones || []).length >= 100
            }
          >
            <Plus size={15} />
            Add milestone
          </button>
        </header>
        <div
          className="project-milestone-tabs"
          role="group"
          aria-label="Milestone collection"
        >
          <button
            ref={!archived ? collectionButton : undefined}
            className="btn btn-subtle"
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            Active ({activeMilestones.length})
          </button>
          <button
            ref={archived ? collectionButton : undefined}
            className="btn btn-subtle"
            aria-pressed={archived}
            onClick={() => setArchived(true)}
          >
            Archived (
            {(project.milestones || []).length - activeMilestones.length})
          </button>
        </div>
        <div className="project-milestones">
          {milestones.map((item) => (
            <article className="project-milestone" key={item.id}>
              <div className="project-milestone-heading">
                <h3>{item.title}</h3>
                {item.archived && (
                  <span className="project-status-label">Archived</span>
                )}
              </div>
              {item.description && <p>{item.description}</p>}
              {item.targetDate && (
                <span className="project-milestone-date">
                  <CalendarDays size={14} />
                  {dateLabel(item.targetDate)}
                </span>
              )}
              <Progress
                progress={milestoneProgress(workspace, projectId, item.id)}
                label={`${item.title} task completion`}
              />
              <div className="project-milestone-actions">
                {!item.archived && (
                  <>
                    <button
                      className="btn btn-subtle"
                      onClick={() => onCreateTask(projectId, item.id)}
                      disabled={readOnly}
                    >
                      <Plus size={14} />
                      Add task
                    </button>
                    <button
                      className="btn btn-subtle"
                      onClick={(event) => {
                        milestoneOpener.current = event.currentTarget;
                        setMilestoneEditor(item);
                      }}
                      disabled={readOnly || !!pending}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  </>
                )}
                <button
                  className="btn btn-subtle"
                  disabled={readOnly || !!pending}
                  onClick={() => void archiveMilestone(item)}
                >
                  {item.archived ? (
                    <RotateCcw size={14} />
                  ) : (
                    <Archive size={14} />
                  )}
                  {pending === item.id
                    ? "Saving…"
                    : item.archived
                      ? "Restore"
                      : "Archive"}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!milestones.length && (
          <div className="project-planning-empty">
            <Flag size={23} />
            <p>
              {archived
                ? "Archived milestones will stay here with their task assignments."
                : "Add a milestone, then assign tasks to track each outcome."}
            </p>
          </div>
        )}
        {(project.milestones || []).length >= 100 && (
          <p className="project-progress-help">
            This project has reached its limit of 100 milestones, including
            archived items. Restore or edit an existing milestone to reuse it.
          </p>
        )}
      </section>
      <section className="project-home-section">
        <header>
          <div>
            <h2>
              <CheckSquare size={19} />
              Project tasks <span>{tasks.length}</span>
            </h2>
            <p>Open a task to plan its work, milestones, or child tasks.</p>
          </div>
        </header>
        <div className="project-task-list">
          {tasks.slice(0, taskLimit).map(({ task, depth }) => {
            const parent = task.parentId
              ? taskMap.get(task.parentId)
              : undefined;
            const childProgress = taskChildrenProgress(workspace, task.id);
            const milestone = project.milestones?.find(
              (item) => item.id === effectiveMilestoneId(workspace, task),
            );
            return (
              <button
                className="project-task-row"
                key={task.id}
                style={{ "--task-depth": Math.min(depth, 4) } as CSSProperties}
                onClick={() => openTask(task.id)}
              >
                <div>
                  <span className="project-task-key">{task.key}</span>
                  <strong>{task.title}</strong>
                  <span className="project-task-context">
                    {parent && (
                      <span>
                        <Layers3 size={13} />
                        Child of {parent.key}
                      </span>
                    )}
                    {milestone && (
                      <span>
                        <Flag size={13} />
                        {milestone.title}
                        {milestone.archived ? " · Archived" : ""}
                      </span>
                    )}
                    {childProgress.total > 0 && (
                      <span>
                        {childProgress.completed}/{childProgress.total} child
                        tasks complete
                      </span>
                    )}
                  </span>
                </div>
                <span className="project-task-status">
                  {statuses.find((status) => status.id === task.status)
                    ?.label || task.status}
                </span>
                <TaskDates task={task} referenceDate={referenceDate} />
              </button>
            );
          })}
        </div>
        {!tasks.length && (
          <div className="project-planning-empty">
            <CheckSquare size={24} />
            <p>
              Your project tasks will appear here. Start with one clear next
              step.
            </p>
          </div>
        )}
        {tasks.length > taskLimit && (
          <button
            className="btn btn-subtle project-show-more"
            onClick={() => setTaskLimit((value) => value + 20)}
          >
            Show 20 more tasks
          </button>
        )}
      </section>
      <div className="project-home-content">
        <section className="project-home-section">
          <header>
            <div>
              <h2>
                <BookOpen size={19} />
                Project notes <span>{notes.length}</span>
              </h2>
              <p>
                Plans, research, and reference material linked to this project.
              </p>
            </div>
          </header>
          <div className="project-resource-list">
            {notes.slice(0, noteLimit).map((note) => (
              <button key={note.id} onClick={() => openNote(note.id)}>
                <BookOpen size={17} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{note.folder || "Notes"}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          {!notes.length && (
            <p className="project-resource-empty">
              Assign a note to this project from its Details panel to keep it
              here.
            </p>
          )}
          {notes.length > noteLimit && (
            <button
              className="btn btn-subtle project-show-more"
              onClick={() => setNoteLimit((value) => value + 12)}
            >
              Show more notes
            </button>
          )}
        </section>
        <section className="project-home-section" data-tour="project-canvases">
          <header>
            <div>
              <h2>
                <Layers3 size={19} />
                Project canvases <span>{canvases.length}</span>
              </h2>
              <p>Visual plans attached to this project.</p>
            </div>
            <button
              ref={newCanvasButton}
              className="btn btn-subtle"
              disabled={readOnly || !!pending}
              onClick={() => void createCanvas()}
            >
              <Plus size={15} />
              {pending === "canvas" ? "Creating…" : "New canvas"}
            </button>
          </header>
          <div className="project-resource-list">
            {canvases.slice(0, canvasLimit).map((canvas) => (
              <button key={canvas.id} onClick={() => onOpenCanvas(canvas.id)}>
                <Layers3 size={17} />
                <span>
                  <strong>{canvas.title}</strong>
                  <small>
                    {canvas.cards.length} cards · {canvas.edges.length}{" "}
                    connections
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          {!canvases.length && (
            <p className="project-resource-empty">
              Create a project canvas or attach an existing one.
            </p>
          )}
          {canvases.length > canvasLimit && (
            <button
              className="btn btn-subtle project-show-more"
              onClick={() => setCanvasLimit((value) => value + 12)}
            >
              Show more canvases
            </button>
          )}
          {unattached.length > 0 && (
            <form
              className="project-canvas-attach"
              onSubmit={(event) => {
                event.preventDefault();
                void attachCanvas();
              }}
            >
              <label htmlFor={`attach-canvas-${projectId}`}>
                Attach an existing canvas
              </label>
              <div>
                <select
                  ref={attachSelect}
                  id={`attach-canvas-${projectId}`}
                  className="field"
                  value={attachId}
                  disabled={readOnly || !!pending}
                  onChange={(event) => setAttachId(event.target.value)}
                >
                  <option value="">Choose an unattached canvas…</option>
                  {unattached.map((canvas) => (
                    <option key={canvas.id} value={canvas.id}>
                      {canvas.title}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  disabled={readOnly || !attachId || !!pending}
                >
                  <Link2 size={15} />
                  {pending === "attach" ? "Attaching…" : "Attach"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
      {workspace.media.some((file) => file.projectId === projectId) && (
        <section
          className="project-home-section"
          data-tour="project-attachments"
        >
          <header>
            <div>
              <h2 ref={attachmentsHeading} tabIndex={-1}>
                Project attachments
              </h2>
              <p>
                Files uploaded from this project keep its access rules. Move
                unused files to Trash before deleting the project.
              </p>
            </div>
          </header>
          <div className="project-attachment-list">
            {workspace.media
              .filter((file) => file.projectId === projectId)
              .slice(0, attachmentLimit)
              .map((file) => (
                <article key={file.id}>
                  <a href={file.url} target="_blank" rel="noopener noreferrer">
                    {file.name}
                    <ArrowUpRight size={16} />
                  </a>
                  <button
                    className="btn"
                    disabled={readOnly || !!pending}
                    aria-label={`Move attachment to Trash: ${file.name}`}
                    onClick={() => void removeAttachment(file)}
                  >
                    <Trash2 size={16} />
                    Trash
                  </button>
                </article>
              ))}
          </div>
          {workspace.media.filter((file) => file.projectId === projectId)
            .length > attachmentLimit && (
            <button
              className="btn"
              onClick={() => setAttachmentLimit((value) => value + 12)}
            >
              Show more attachments
            </button>
          )}
        </section>
      )}
      {milestoneEditor && !readOnly && (
        <MilestoneEditor
          key={milestoneEditor === "new" ? "new" : milestoneEditor.id}
          project={project as Project}
          milestone={milestoneEditor === "new" ? undefined : milestoneEditor}
          mutate={mutate}
          notify={notify}
          onClose={() => {
            restoreMilestoneFocus.current = true;
            setMilestoneEditor(null);
          }}
        />
      )}
    </div>
  );
}
