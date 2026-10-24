import type { Task, Workspace } from "./types";

/** Hierarchy and blocking links share one completion graph. */
export function planningError(workspace: Workspace): string | null {
  const tasks = new Map(workspace.tasks.map((task) => [task.id, task]));
  const projects = new Map(
    workspace.projects.map((project) => [project.id, project]),
  );
  const children = new Map<string, string[]>();
  for (const task of workspace.tasks) {
    if (task.parentId) {
      const parent = tasks.get(task.parentId);
      if (!parent)
        return `The parent of “${task.title}” is unavailable. Choose another parent.`;
      if (parent.id === task.id) return "A task cannot be its own parent.";
      if (parent.projectId !== task.projectId)
        return "Parent and child tasks must belong to the same project. Move or detach the children first.";
      const descendants = children.get(parent.id) || [];
      descendants.push(task.id);
      children.set(parent.id, descendants);
    }
    if (
      task.milestoneId &&
      !projects
        .get(task.projectId)
        ?.milestones?.some((milestone) => milestone.id === task.milestoneId)
    )
      return `The milestone for “${task.title}” is unavailable in its project.`;
  }
  for (const task of workspace.tasks) {
    if (task.recurrence && children.has(task.id))
      return "Recurring schedules belong to tasks without child tasks. Remove the schedule or move the children first.";
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const task = tasks.get(id);
    for (const target of [
      ...(task?.blockedBy || []),
      ...(children.get(id) || []),
    ]) {
      if (!visit(target)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  for (const task of workspace.tasks)
    if (!visit(task.id))
      return "Parent and blocking links create a completion cycle. Remove one of those links.";
  for (const task of workspace.tasks) {
    if (
      task.parentId &&
      tasks.get(task.parentId)?.status === "done" &&
      task.status !== "done"
    )
      return "Complete the child tasks before completing their parent, or reopen the parent first.";
  }
  return null;
}

/** A removed parent link can be restored only if the current plan still works. */
export function canRestoreTaskLinks(
  workspace: Workspace,
  task: Task,
  patch: Partial<Task>,
): boolean {
  const before = { ...task };
  Object.assign(task, patch);
  const safe = !planningError(workspace);
  for (const key of Object.keys(patch) as (keyof Task)[]) {
    if (Object.hasOwn(before, key)) Object.assign(task, { [key]: before[key] });
    else delete task[key];
  }
  return safe;
}
