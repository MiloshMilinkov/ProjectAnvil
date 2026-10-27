"use client";
import { Link2 } from "lucide-react";
import { useMemo } from "react";
import {
  statuses,
  type FeatureProps,
  type Task,
  type Workspace,
} from "../../lib/types";
import { TaskDates } from "../TaskSchedule";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { Avatar, StatusIcon } from "../WorkspacePrimitives";
import PriorityMark from "./PriorityMark";

export default function TaskTable({
  workspace,
  tasks,
  openTask,
  mutate,
  referenceDate,
}: {
  workspace: Workspace;
  tasks: Task[];
  openTask: (id: string) => void;
  mutate: FeatureProps["mutate"];
  referenceDate: string;
}) {
  const permissions = useWorkspacePermissions(workspace);
  const peopleById = useMemo(
    () => new Map(workspace.people.map((person) => [person.id, person])),
    [workspace.people],
  );
  const statusesByTask = useMemo(
    () => new Map(workspace.tasks.map((task) => [task.id, task.status])),
    [workspace.tasks],
  );
  return (
    <div className="table-scroll">
      <table className="task-table">
        <thead>
          <tr>
            <th className="task-name-cell">Task</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Schedule</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <button
                  className="task-title-button"
                  onClick={() => openTask(task.id)}
                >
                  <StatusIcon status={task.status} />
                  <span className="task-key">{task.key}</span>
                  <strong>{task.title}</strong>
                  {task.blockedBy.some(
                    (id) => statusesByTask.get(id) !== "done",
                  ) && (
                    <span title="Blocked by a dependency">
                      <Link2 size={13} />
                    </span>
                  )}
                </button>
              </td>
              <td data-label="Status">
                <select
                  className={"status-select status-" + task.status}
                  aria-label={"Status for " + task.key}
                  value={task.status}
                  disabled={!permissions.canEditProject(task.projectId)}
                  onChange={(e) =>
                    mutate({
                      action: "upsert",
                      entity: "tasks",
                      item: { id: task.id, status: e.target.value },
                    }).catch(() => {})
                  }
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="Priority">
                <span className="priority-inline">
                  <PriorityMark value={task.priority} />
                  <span>{task.priority}</span>
                </span>
              </td>
              <td data-label="Assignee">
                <span className="assignee-inline">
                  <Avatar person={peopleById.get(task.assigneeId)} small />
                  <span>
                    {peopleById.get(task.assigneeId)?.name || "Unassigned"}
                  </span>
                </span>
              </td>
              <td data-label="Schedule">
                <TaskDates task={task} referenceDate={referenceDate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
