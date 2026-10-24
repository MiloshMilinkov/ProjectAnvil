import { uid, type Task, type Workspace } from "./types";

/** Copy reusable work while leaving scheduling and completion with the original. */
export function duplicateTask(source: Task, workspace: Workspace): Task {
  const timestamp = new Date().toISOString();
  const project = workspace.projects.find(
    (project) => project.id === source.projectId,
  );
  return {
    id: uid(),
    key: "",
    title: source.title,
    description: source.description,
    status: "todo",
    priority: source.priority,
    type: source.type,
    projectId: project?.id || "",
    parentId: "",
    milestoneId: project?.milestones?.some(
      (milestone) => milestone.id === source.milestoneId && !milestone.archived,
    )
      ? source.milestoneId
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
