"use client";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  CheckSquare,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  FolderKanban,
  ListTodo,
  Network,
  Plus,
  UserRound,
} from "lucide-react";
import { projectProgress } from "../../lib/planning-progress";
import type { FeatureProps } from "../../lib/types";
import type { WorkRoom } from "../../lib/workrooms";
import PageHeader from "../PageHeader";
import { useCalendarToday } from "../TaskSchedule";
import { ResumeWorkCard } from "../WorkRooms";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { Empty } from "../WorkspacePrimitives";
import type { WorkspacePage } from "../shell/navigation";
import TaskTable from "../tasks/TaskTable";

export default function WorkspaceOverview(
  props: FeatureProps & {
    onGo: (page: WorkspacePage) => void;
    onCreate: () => void;
    onProject: (id: string) => void;
    onResumeRoom: (room: WorkRoom) => void;
  },
) {
  const referenceDate = useCalendarToday();
  const permissions = useWorkspacePermissions(props.workspace);
  const { workspace, currentPerson, openNote, onGo, onCreate, onProject } = props;
  const parentIds = new Set(
    workspace.tasks.map((task) => task.parentId).filter(Boolean),
  );
  const tasks = workspace.tasks.filter(
    (task) =>
      (!props.projectFilter || task.projectId === props.projectFilter) &&
      !parentIds.has(task.id),
  );
  const active = tasks.filter((task) => task.status !== "done");
  const mine = active.filter((task) => task.assigneeId === currentPerson);
  const done = tasks.filter((task) => task.status === "done");
  const overdue = mine.filter(
    (task) => task.dueDate && task.dueDate < referenceDate,
  );
  const upcoming = [...active]
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
    .slice(0, 5);
  const projects = workspace.projects.filter(
    (project) => !props.projectFilter || project.id === props.projectFilter,
  );
  const notes = workspace.notes
    .filter(
      (note) => !props.projectFilter || note.projectId === props.projectFilter,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow={new Date()
          .toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          .toUpperCase()}
        title="Workspace overview"
        description="Track project progress, upcoming work, and recent notes."
        action={
          <>
            <button className="btn" onClick={() => onGo("tasks")}>
              <ListTodo size={15} aria-hidden="true" />
              View tasks
            </button>
            <button
              className="btn btn-primary"
              onClick={onCreate}
              disabled={!permissions.canEditProject(props.projectFilter)}
            >
              <Plus size={16} />
              Create task
            </button>
          </>
        }
      />
      <div className="stat-grid">
        {[
          {
            label: "Active tasks",
            value: active.length,
            sub:
              tasks.length +
              (tasks.length === 1
                ? " task in this view"
                : " tasks in this view"),
            icon: ListTodo,
            color: "violet",
          },
          {
            label: "In progress",
            value: tasks.filter((task) => task.status === "in-progress").length,
            sub: "In this view",
            icon: CircleDashed,
            color: "blue",
          },
          {
            label: "Completed",
            value: done.length,
            sub: `${tasks.length ? Math.round((done.length / tasks.length) * 100) : 0}% of tasks in this view`,
            icon: CircleCheck,
            color: "green",
          },
          {
            label: currentPerson ? "Assigned to you" : "Unassigned tasks",
            value: mine.length,
            sub: overdue.length
              ? `${overdue.length} overdue`
              : "None overdue",
            icon: UserRound,
            color: "orange",
          },
        ].map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <stat.icon
                size={17}
                className={"color-" + stat.color}
                aria-hidden="true"
              />
            </div>
            <strong>{stat.value}</strong>
            <small>{stat.sub}</small>
          </div>
        ))}
      </div>
      <ResumeWorkCard
        onResume={props.onResumeRoom}
        onManage={() => onGo("rooms")}
        notify={props.notify}
      />
      <div className="dashboard-columns">
        <section className="panel project-section">
          <div className="section-heading">
            <h2>
              <FolderKanban size={17} />
              Projects
            </h2>
            <button className="text-button" onClick={() => onGo("projects")}>
              All projects <ArrowRight size={13} />
            </button>
          </div>
          <div className="project-summaries">
            {projects.map((project) => {
              const progress = projectProgress(workspace, project.id);
              const { completed, percent } = progress;
              return (
                <button
                  className="project-summary"
                  key={project.id}
                  onClick={() => onProject(project.id)}
                >
                  <div
                    className="project-summary-icon"
                    style={{
                      background: project.color + "18",
                      color: project.color,
                    }}
                  >
                    <FolderKanban size={21} />
                  </div>
                  <div className="project-summary-copy">
                    <div>
                      <h3>{project.name}</h3>
                      <span className="badge">{project.status}</span>
                    </div>
                    <p>{project.goal || project.description}</p>
                    <div className="progress-label">
                      <span>
                        {completed} of {progress.total} tasks complete
                      </span>
                      <strong>{percent}%</strong>
                    </div>
                    <div className="mini-progress">
                      <span
                        style={{
                          width: percent + "%",
                          background: project.color,
                        }}
                      />
                    </div>
                  </div>
                  <ChevronRight size={15} />
                </button>
              );
            })}
            {!projects.length && (
              <Empty
                title="No projects yet"
                text="Create a project to group its tasks, notes, and canvases."
              />
            )}
          </div>
        </section>
        <section className="panel knowledge-peek">
          <div className="section-heading">
            <h2>
              <BookOpen size={17} />
              Recent notes
            </h2>
            <button
              className="icon-link"
              aria-label="Open notes"
              onClick={() => onGo("notes")}
            >
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
          {notes.map((note) => (
            <button
              className="note-peek"
              key={note.id}
              onClick={() => openNote(note.id)}
            >
              <span className={"note-kind kind-" + note.kind}>
                <BookOpen size={15} />
              </span>
              <div>
                <strong>{note.title}</strong>
                <small>
                  {note.folder} <span>·</span> {note.kind}
                </small>
              </div>
              {note.bookmarked ? (
                <Bookmark size={13} className="muted" />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          ))}
          {!notes.length && (
            <Empty
              title="No notes yet"
              text="Add project details or reference material in Notes."
            />
          )}
          <button className="knowledge-footer" onClick={() => onGo("graph")}>
            <Network size={16} />
            <span>Open relationship graph</span>
            <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel due-section">
        <div className="section-heading">
          <h2>
            <CheckSquare size={17} />
            Upcoming tasks{" "}
            <span className="count-badge">{upcoming.length}</span>
          </h2>
          <button className="text-button" onClick={() => onGo("tasks")}>
            All tasks <ArrowRight size={13} />
          </button>
        </div>
        <TaskTable {...props} tasks={upcoming} referenceDate={referenceDate} />
        {!upcoming.length && (
          <Empty
            title="No upcoming tasks"
            text="Create a task to add it here."
            action={
              <button className="btn" onClick={onCreate}>
                <Plus size={15} />
                Create task
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}
