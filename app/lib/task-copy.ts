import { uid, type Task, type Workspace } from "./types";

/** Copy reusable work while leaving scheduling and completion with the original. */
export function duplicateTask(source: Task, workspace: Workspace): Task {
  const timestamp = new Date().toISOString();
  return {
    id: uid(),
    key: "",
    title: source.title,
    description: source.description,
    status: "todo",
    priority: source.priority,
    type: source.type,
    projectId: workspace.projects.some(
      (project) => project.id === source.projectId,
    )
      ? source.projectId
      : "",
    assigneeId: "",
    startDate: "",
    dueDate: "",
    estimate: source.estimate,
    tags: [...source.tags],
    noteIds: source.noteIds.filter((id) =>
      workspace.notes.some((note) => note.id === id),
    ),
    blockedBy: [],
    subtasks: source.subtasks.map(({ title }) => ({
      id: uid(),
      title,
      done: false,
    })),
    comments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
