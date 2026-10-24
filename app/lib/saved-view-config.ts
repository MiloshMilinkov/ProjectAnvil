import type { SavedView, TaskLayout } from "./types";

export type SavedViewConfig = Omit<SavedView, "id" | "name"> & {
  layout: TaskLayout;
};

/** Old saved views predate date controls and layouts. Keep their original board. */
export function savedViewConfig(
  view: Omit<SavedView, "id" | "name">,
): SavedViewConfig {
  return {
    query: view.query,
    assignee: view.assignee,
    priority: view.priority,
    project: view.project,
    status: view.status,
    dateFilter: view.dateFilter || "all",
    sort: view.sort || "priority",
    layout: view.layout || "board",
  };
}

export function matchesSavedView(view: SavedView, config: SavedViewConfig) {
  return (
    JSON.stringify(savedViewConfig(view)) ===
    JSON.stringify(savedViewConfig(config))
  );
}
