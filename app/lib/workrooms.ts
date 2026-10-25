export type WorkPage =
  | "overview"
  | "my-work"
  | "tasks"
  | "projects"
  | "notes"
  | "brainstorm"
  | "activity"
  | "graph"
  | "canvas"
  | "collections"
  | "daily";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkLocation {
  page: WorkPage;
  projectFilter: string;
  noteId: string;
  canvasId: string;
  canvasViewport?: CanvasViewport;
}

export interface WorkCheckpoint {
  summary: string;
  nextStep: string;
  question: string;
  savedAt: string;
}

export interface WorkRoom {
  id: string;
  name: string;
  projectId: string;
  taskId: string;
  noteIds: string[];
  canvasId: string;
  location: WorkLocation;
  checkpoint: WorkCheckpoint | null;
  updatedAt: string;
  revision: number;
}
