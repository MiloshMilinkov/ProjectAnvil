export const workspacePages = [
  "overview",
  "my-work",
  "tasks",
  "projects",
  "rooms",
  "notes",
  "brainstorm",
  "graph",
  "canvas",
  "collections",
  "daily",
  "team",
  "settings",
] as const;

export type WorkspacePage = (typeof workspacePages)[number];
export interface WorkspacePreferences {
  compact: boolean;
  taskShortcut: string;
  savedPage: WorkspacePage;
}

export const defaultPreferences: WorkspacePreferences = {
  compact: false,
  taskShortcut: "n",
  savedPage: "overview",
};

/** Old or malformed browser preferences must never select a missing page. */
export function parseWorkspacePreferences(
  value: unknown,
): WorkspacePreferences {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    compact: typeof input.compact === "boolean" ? input.compact : false,
    taskShortcut:
      typeof input.taskShortcut === "string" &&
      /^[a-z]$/i.test(input.taskShortcut)
        ? input.taskShortcut.toLowerCase()
        : "n",
    savedPage:
      typeof input.savedPage === "string" &&
      workspacePages.includes(input.savedPage as WorkspacePage)
        ? (input.savedPage as WorkspacePage)
        : "overview",
  };
}
