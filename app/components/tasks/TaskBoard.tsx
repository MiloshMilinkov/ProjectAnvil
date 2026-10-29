"use client";
import { Bug, CheckSquare, CircleDashed, Link2, Plus, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import {
  statuses,
  type FeatureProps,
  type Status,
  type Task,
} from "../../lib/types";
import { TaskDates } from "../TaskSchedule";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { Avatar } from "../WorkspacePrimitives";
import PriorityMark from "./PriorityMark";

interface TaskBoardProps extends Pick<
  FeatureProps,
  "workspace" | "projectFilter" | "openTask" | "mutate" | "notify"
> {
  tasks: Task[];
  filtered: boolean;
  referenceDate: string;
  onCreate: (status?: Status) => void;
}

/** Owns board-only dragging, so pointer movement does not rebuild task filters. */
export default function TaskBoard({
  workspace,
  tasks,
  filtered,
  projectFilter,
  openTask,
  mutate,
  notify,
  referenceDate,
  onCreate,
}: TaskBoardProps) {
  const permissions = useWorkspacePermissions(workspace);
  const [dragging, setDragging] = useState("");
  const [dragOver, setDragOver] = useState("");
  const [visibleCounts, setVisibleCounts] = useState<
    Partial<Record<Status, number>>
  >({});
  const peopleById = useMemo(
    () => new Map(workspace.people.map((person) => [person.id, person])),
    [workspace.people],
  );
  const statusesByTask = useMemo(
    () => new Map(workspace.tasks.map((task) => [task.id, task.status])),
    [workspace.tasks],
  );
  const tasksByStatus = useMemo(() => {
    const grouped = new Map<Status, Task[]>();
    for (const status of statuses) grouped.set(status.id, []);
    for (const task of tasks) grouped.get(task.status)?.push(task);
    return grouped;
  }, [tasks]);
  return (
    <div
      className="kanban-board"
      tabIndex={0}
      role="region"
      aria-label="Task status columns. Scroll horizontally to see more statuses."
    >
      {statuses.map((status) => {
        const items = tasksByStatus.get(status.id) || [];
        const visibleCount = visibleCounts[status.id] || 40;
        return (
          <section
            className={
              "kanban-column " + (dragOver === status.id ? "drag-over" : "")
            }
            key={status.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(status.id);
            }}
            onDragLeave={() => setDragOver("")}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragging;
              if (
                id &&
                workspace.tasks.some(
                  (task) =>
                    task.id === id &&
                    permissions.canEditProject(task.projectId),
                )
              )
                mutate({
                  action: "upsert",
                  entity: "tasks",
                  item: { id, status: status.id },
                })
                  .then(() => notify("Task moved to " + status.label))
                  .catch(() => {});
              setDragging("");
              setDragOver("");
            }}
          >
            <header>
              <span
                className="column-dot"
                style={{ background: status.color }}
              />
              <h2>{status.label}</h2>
              <span>{items.length}</span>
              <button
                aria-label={"Create task in " + status.label}
                disabled={!permissions.canEditProject(projectFilter)}
                onClick={() => onCreate(status.id)}
              >
                <Plus size={15} />
              </button>
            </header>
            <div className="kanban-cards">
              {items.slice(0, visibleCount).map((task) => (
                <button
                  draggable={permissions.canEditProject(task.projectId)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", task.id);
                    setDragging(task.id);
                  }}
                  onDragEnd={() => {
                    setDragging("");
                    setDragOver("");
                  }}
                  className={
                    "task-card " + (dragging === task.id ? "dragging" : "")
                  }
                  key={task.id}
                  onClick={() => openTask(task.id)}
                >
                  <div className="task-card-top">
                    <span className="task-key">
                      {task.type === "bug" ? (
                        <Bug size={12} role="img" aria-label="Bug" />
                      ) : task.type === "epic" ? (
                        <Zap size={12} role="img" aria-label="Epic" />
                      ) : (
                        <CheckSquare
                          size={12}
                          role="img"
                          aria-label={task.type === "story" ? "Story" : "Task"}
                        />
                      )}{" "}
                      {task.key}
                    </span>
                    <PriorityMark value={task.priority} />
                  </div>
                  <h3>{task.title}</h3>
                  {task.tags.length > 0 && (
                    <div className="task-tags">
                      {task.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className={
                            "tag tag-" +
                            tag.replace(/[^a-z]/gi, "").toLowerCase()
                          }
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="task-card-bottom">
                    <span className="task-card-schedule">
                      <TaskDates task={task} referenceDate={referenceDate} />
                      {task.subtasks.length > 0 && (
                        <span className="subtask-count">
                          <CheckSquare size={11} />
                          {task.subtasks.filter((item) => item.done).length}/
                          {task.subtasks.length}
                        </span>
                      )}
                      {task.blockedBy.some(
                        (id) => statusesByTask.get(id) !== "done",
                      ) && <Link2 size={12} />}
                    </span>
                    <span className="card-estimate">
                      {task.estimate > 0 && <small>{task.estimate}pt</small>}
                      <Avatar person={peopleById.get(task.assigneeId)} small />
                    </span>
                  </div>
                </button>
              ))}
              {items.length > visibleCount && (
                <button
                  className="btn task-show-more"
                  onClick={(event) => {
                    const cards = event.currentTarget.parentElement;
                    setVisibleCounts((counts) => ({
                      ...counts,
                      [status.id]: visibleCount + 40,
                    }));
                    requestAnimationFrame(() => {
                      if (!cards?.isConnected) return;
                      const firstNewCard = cards
                        .querySelectorAll<HTMLButtonElement>(".task-card")
                        .item(visibleCount);
                      firstNewCard?.focus();
                    });
                  }}
                >
                  Show more in {status.label} ({items.length - visibleCount}{" "}
                  remaining)
                </button>
              )}
              {!items.length && (
                <div className="column-empty">
                  <CircleDashed size={20} />
                  <span>{filtered ? "No matching tasks" : "No tasks yet"}</span>
                </div>
              )}
            </div>
            <button
              className="add-to-column"
              onClick={() => onCreate(status.id)}
            >
              <Plus size={14} />
              Add task
            </button>
          </section>
        );
      })}
    </div>
  );
}
