"use client";
import {
  ArrowUpRight,
  CalendarDays,
  FolderKanban,
  MoreHorizontal,
  Target,
} from "lucide-react";
import { projectProgress } from "../../lib/planning-progress";
import type { Project, Workspace } from "../../lib/types";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { Avatar } from "../WorkspacePrimitives";

const dateLabel = (date: string) =>
  date
    ? new Date(date + "T12:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "No date";

export default function ProjectCard({
  project,
  workspace,
  onOpen,
  onEdit,
}: {
  project: Project;
  workspace: Workspace;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const permissions = useWorkspacePermissions(workspace);
  const tasks = workspace.tasks.filter((task) => task.projectId === project.id);
  const assigneeIds = new Set(tasks.map((task) => task.assigneeId));
  const progress = projectProgress(workspace, project.id);
  const { completed, percent } = progress;
  return (
    <article className="panel project-card">
      <div className="project-card-top">
        <span
          className="project-summary-icon"
          style={{ background: project.color + "20", color: project.color }}
        >
          <FolderKanban size={23} />
        </span>
        <span className="badge">{project.status}</span>
        <button
          className="btn-icon"
          title={"Edit " + project.name}
          onClick={onEdit}
          disabled={!permissions.canEditProject(project.id)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <button className="project-title" onClick={onOpen}>
        <h2>{project.name}</h2>
        <ArrowUpRight size={18} />
      </button>
      <p>{project.description}</p>
      <div className="project-goal">
        <Target size={15} />
        {project.goal || "Set your next milestone"}
      </div>
      <div className="progress-label">
        <span>
          {completed}/{progress.total} tasks complete
        </span>
        <strong>{percent}%</strong>
      </div>
      <div className="mini-progress">
        <span style={{ width: percent + "%", background: project.color }} />
      </div>
      <footer>
        <span>
          <CalendarDays size={13} />
          {project.targetDate
            ? "Target " + dateLabel(project.targetDate)
            : "No target date"}
        </span>
        <span className="avatar-stack">
          {workspace.people
            .filter((person) => assigneeIds.has(person.id))
            .slice(0, 4)
            .map((person) => (
              <Avatar small key={person.id} person={person} />
            ))}
        </span>
      </footer>
    </article>
  );
}
