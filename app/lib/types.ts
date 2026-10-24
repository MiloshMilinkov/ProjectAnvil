export type Status = "backlog" | "todo" | "in-progress" | "review" | "done";
export type Priority = "urgent" | "high" | "medium" | "low";
export const taskDateFilters = [
  "all",
  "due-today",
  "overdue",
  "due-next-7-days",
  "no-due-date",
  "start-today",
  "start-next-7-days",
  "no-start-date",
] as const;
export type DateFilter = (typeof taskDateFilters)[number];
export const taskSorts = [
  "priority",
  "due-date",
  "start-date",
  "updated",
] as const;
export type TaskSort = (typeof taskSorts)[number];
export const taskLayouts = ["board", "list", "timeline"] as const;
export type TaskLayout = (typeof taskLayouts)[number];
export interface Person {
  id: string;
  name: string;
  role: string;
  color: string;
  userId?: string;
  inactive?: boolean;
}
export interface Project {
  id: string;
  name: string;
  key: string;
  description: string;
  color: string;
  status: string;
  goal: string;
  targetDate: string;
}
export interface TaskSource {
  noteId: string;
  excerpt: string;
}
export interface Task {
  id: string;
  key: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  type: "task" | "bug" | "story" | "epic";
  projectId: string;
  assigneeId: string;
  startDate: string;
  dueDate: string;
  estimate: number;
  tags: string[];
  noteIds: string[];
  blockedBy: string[];
  subtasks: { id: string; title: string; done: boolean }[];
  comments: { id: string; personId: string; body: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
  source?: TaskSource;
}
export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  projectId: string;
  kind: "note" | "world" | "character" | "research" | "daily" | "meeting";
  bookmarked: boolean;
  properties: Record<string, string>;
  snapshots: { id: string; content: string; savedAt: string }[];
  createdAt: string;
  updatedAt: string;
}
export interface Media {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  createdAt: string;
}
export interface CanvasCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "note" | "task" | "text" | "media" | "url";
  entityId?: string;
  text: string;
  color: string;
}
export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}
export interface Canvas {
  id: string;
  title: string;
  cards: CanvasCard[];
  edges: CanvasEdge[];
}
export interface SavedView {
  id: string;
  name: string;
  query: string;
  assignee: string;
  priority: string;
  project: string;
  status: string;
  dateFilter?: DateFilter;
  sort?: TaskSort;
  layout?: TaskLayout;
}
export interface EntityRef {
  type: "note" | "task" | "project";
  id: string;
}
export type RelationshipKind =
  | "depends-on"
  | "supports"
  | "contradicts"
  | "decided-because";
export interface Relationship {
  id: string;
  from: EntityRef;
  to: EntityRef;
  kind: RelationshipKind;
  label: string;
  createdAt: string;
  reviewedAt: string;
  fromSignature: string;
  toSignature: string;
}
export interface Workspace {
  name: string;
  people: Person[];
  projects: Project[];
  tasks: Task[];
  notes: Note[];
  media: Media[];
  canvases: Canvas[];
  savedViews: SavedView[];
  relationships: Relationship[];
  revision: number;
}
export type Entity =
  | "people"
  | "projects"
  | "tasks"
  | "notes"
  | "media"
  | "canvases"
  | "savedViews"
  | "relationships";
export type MutationItem =
  | Person
  | Project
  | Task
  | Note
  | Media
  | Canvas
  | SavedView
  | Relationship
  | Record<string, unknown>;
export interface Mutation {
  action:
    | "upsert"
    | "delete"
    | "restore"
    | "rename"
    | "import"
    | "review-relationship";
  entity?: Entity;
  item?: MutationItem;
  id?: string;
  name?: string;
  workspace?: Workspace;
  base?: Record<string, unknown> | null;
  operationId?: string;
  restoreSnapshotId?: string;
  expectedFromSignature?: string;
  expectedToSignature?: string;
}
export type Mutate = (mutation: Mutation) => Promise<Workspace>;
export type Notify = (message: string, options?: { undoId: string }) => void;
export interface FeatureProps {
  workspace: Workspace;
  mutate: Mutate;
  openTask: (id: string) => void;
  openNote: (id: string) => void;
  currentPerson: string;
  projectFilter: string;
  notify: Notify;
}
export const statuses: { id: Status; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "#8c91a5" },
  { id: "todo", label: "To do", color: "#a6adbf" },
  { id: "in-progress", label: "In progress", color: "#8a78fa" },
  { id: "review", label: "In review", color: "#f4bd62" },
  { id: "done", label: "Done", color: "#63c9a0" },
];
export const priorities: Priority[] = ["urgent", "high", "medium", "low"];
export const uid = () => crypto.randomUUID();
export const initials = (name: string) =>
  name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
