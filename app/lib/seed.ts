import type { Workspace } from "./types";

// Keep this initializer empty. A new local workspace starts in guest mode;
// projects, people, and other records are created only by the person using it.
export function createSeedWorkspace(): Workspace {
  return {
    name: "My workspace",
    revision: 0,
    people: [],
    projects: [],
    tasks: [],
    notes: [],
    media: [],
    canvases: [],
    savedViews: [],
    relationships: [],
  };
}
