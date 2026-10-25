"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { statuses, today, type FeatureProps, type Task } from "../lib/types";
import { useDialog } from "./useDialog";
import Markdown from "./Markdown";
import WatchControl from "./WatchControl";
import { TaskDates } from "./TaskSchedule";

export default function TaskReadOnlyDialog({
  task,
  workspace,
  openTask,
  openNote,
  notify,
  onClose,
}: Pick<FeatureProps, "workspace" | "openTask" | "openNote" | "notify"> & {
  task: Task;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, onClose);
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`View task: ${task.title}`}
        className="small-dialog readonly-task-dialog"
      >
        <div className="dialog-heading">
          <h2>{task.key}</h2>
          <button
            className="btn-icon"
            aria-label="Close task"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <h3>{task.title}</h3>
        <p className="muted">
          Viewer access ·{" "}
          {statuses.find((status) => status.id === task.status)?.label} ·{" "}
          {task.priority} priority
        </p>
        <TaskDates task={task} referenceDate={today()} />
        <WatchControl
          reference={{ type: "task", id: task.id }}
          notify={notify}
        />
        <Markdown
          content={task.description || "No description yet."}
          workspace={workspace}
          onNoteClick={openNote}
        />
        {!!task.subtasks.length && (
          <section>
            <h4>Checklist</h4>
            <ul>
              {task.subtasks.map((item) => (
                <li key={item.id}>
                  {item.done ? "✓" : "○"} {item.title}
                </li>
              ))}
            </ul>
          </section>
        )}
        {task.parentId && (
          <button className="btn" onClick={() => openTask(task.parentId!)}>
            Open parent task
          </button>
        )}
        {workspace.tasks
          .filter((child) => child.parentId === task.id)
          .map((child) => (
            <button
              key={child.id}
              className="btn"
              onClick={() => openTask(child.id)}
            >
              {child.key} · {child.title}
            </button>
          ))}
        {!!task.noteIds.length && (
          <section>
            <h4>Linked notes</h4>
            {task.noteIds.map((id) => (
              <button key={id} className="btn" onClick={() => openNote(id)}>
                {workspace.notes.find((note) => note.id === id)?.title ||
                  "Note"}
              </button>
            ))}
          </section>
        )}
        {!!task.blockedBy.length && (
          <section>
            <h4>Depends on</h4>
            {task.blockedBy.map((id) => (
              <button key={id} className="btn" onClick={() => openTask(id)}>
                {workspace.tasks.find((item) => item.id === id)?.title ||
                  "Task"}
              </button>
            ))}
          </section>
        )}
        {!!task.comments.length && (
          <section>
            <h4>Discussion</h4>
            {task.comments.map((comment) => (
              <article key={comment.id}>
                <strong>
                  {workspace.people.find(
                    (person) => person.id === comment.personId,
                  )?.name || "Guest"}
                </strong>
                <p>{comment.body}</p>
              </article>
            ))}
          </section>
        )}
        <div className="dialog-footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
