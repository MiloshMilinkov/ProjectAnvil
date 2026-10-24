import type { Task, Workspace } from "./types";

export interface PlanningProgress {
  total: number;
  completed: number;
  percent: number;
  taskIds: string[];
}
interface PlanningIndex {
  tasks: Map<string, Task>;
  children: Map<string, string[]>;
  leaves: Task[];
  milestones: Map<string, string>;
}
// Workspace reads are immutable snapshots. Reuse their indexes across cards.
const indexes = new WeakMap<Workspace, PlanningIndex>();
function index(workspace: Workspace): PlanningIndex {
  const existing = indexes.get(workspace);
  if (existing) return existing;
  const children = new Map<string, string[]>();
  for (const task of workspace.tasks) {
    if (!task.parentId) continue;
    const values = children.get(task.parentId) || [];
    values.push(task.id);
    children.set(task.parentId, values);
  }
  const result = {
    tasks: new Map(workspace.tasks.map((task) => [task.id, task])),
    children,
    leaves: workspace.tasks.filter((task) => !children.has(task.id)),
    milestones: new Map<string, string>(),
  };
  indexes.set(workspace, result);
  return result;
}

function summarize(tasks: Task[]): PlanningProgress {
  const completed = tasks.filter((task) => task.status === "done").length;
  return {
    total: tasks.length,
    completed,
    percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
    taskIds: tasks.map((task) => task.id),
  };
}

/** Containers describe work; only their lowest-level tasks count toward totals. */
export function leafTasks(workspace: Workspace, projectId?: string): Task[] {
  return index(workspace).leaves.filter(
    (task) => projectId === undefined || task.projectId === projectId,
  );
}

export function effectiveMilestoneId(workspace: Workspace, task: Task): string {
  const lookup = index(workspace);
  const stored = lookup.tasks.get(task.id) === task;
  if (stored && lookup.milestones.has(task.id))
    return lookup.milestones.get(task.id)!;
  const seen = new Set<string>();
  let current: Task | undefined = task;
  let result = "";
  while (current && !seen.has(current.id)) {
    if (current.milestoneId) {
      result = current.milestoneId;
      break;
    }
    if (
      lookup.tasks.get(current.id) === current &&
      lookup.milestones.has(current.id)
    ) {
      result = lookup.milestones.get(current.id)!;
      break;
    }
    seen.add(current.id);
    current = current.parentId ? lookup.tasks.get(current.parentId) : undefined;
  }
  for (const id of seen) {
    if (stored || id !== task.id) lookup.milestones.set(id, result);
  }
  if (stored) lookup.milestones.set(task.id, result);
  return result;
}

export function projectProgress(
  workspace: Workspace,
  projectId: string,
): PlanningProgress {
  return summarize(leafTasks(workspace, projectId));
}

export function milestoneProgress(
  workspace: Workspace,
  projectId: string,
  milestoneId: string,
): PlanningProgress {
  return summarize(
    leafTasks(workspace, projectId).filter(
      (task) => effectiveMilestoneId(workspace, task) === milestoneId,
    ),
  );
}

export function taskChildrenProgress(
  workspace: Workspace,
  taskId: string,
): PlanningProgress {
  const descendants = new Set<string>();
  const lookup = index(workspace);
  const pending = [...(lookup.children.get(taskId) || [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    pending.push(...(lookup.children.get(id) || []));
  }
  return summarize(lookup.leaves.filter((task) => descendants.has(task.id)));
}
