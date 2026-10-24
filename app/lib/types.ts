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
  milestones?: Milestone[];
}
export interface Milestone {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  archived: boolean;
}
export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  anchorDate: string;
  timeZone: string;
  untilDate?: string;
}
export interface ReminderRule {
  date: string;
  time: string;
  timeZone: string;
}
export type TaskReminder = ReminderRule;
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
  parentId?: string;
  milestoneId?: string;
  recurrence?: RecurrenceRule | null;
  reminder?: ReminderRule | null;
  /** Server-owned successor ledger prevents a reopened task spawning twice. */
  recurrenceNextId?: string;
  recurringFromId?: string;
}
export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  projectId: string;
  kind:
    | "note"
    | "world"
    | "character"
    | "research"
    | "daily"
    | "meeting"
    | "decision";
  customTypeId?: string;
  propertyValues?: Record<string, string>;
  decision?: DecisionRecord | null;
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
  projectId?: string;
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
export interface NotePropertyField {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "checkbox" | "select";
  required: boolean;
  options: string[];
}
export interface NoteType {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  fields: NotePropertyField[];
}
export interface DecisionRecord {
  status: "proposed" | "accepted" | "rejected" | "superseded";
  context: string;
  options: string;
  outcome: string;
  consequences: string;
  decidedOn: string;
  ownerId: string;
  supersededById: string;
}
export interface RelationshipPreset {
  id: string;
  name: string;
  description: string;
  kind: RelationshipKind;
  label: string;
  fromType: "any" | EntityRef["type"];
  toType: "any" | EntityRef["type"];
  archived: boolean;
}
export interface BrainstormIdea {
  id: string;
  title: string;
  description: string;
  groupId: string;
  noteId: string;
  taskId: string;
  votes: string[];
}
export interface BrainstormBoard {
  id: string;
  title: string;
  description: string;
  projectId: string;
  groups: { id: string; title: string }[];
  ideas: BrainstormIdea[];
  votingOpen: boolean;
  createdAt: string;
  updatedAt: string;
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
  noteTypes?: NoteType[];
  relationshipPresets?: RelationshipPreset[];
  brainstorms?: BrainstormBoard[];
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
  | "relationships"
  | "noteTypes"
  | "relationshipPresets"
  | "brainstorms";
export type MutationItem =
  | Person
  | Project
  | Task
  | Note
  | Media
  | Canvas
  | SavedView
  | Relationship
  | NoteType
  | RelationshipPreset
  | BrainstormBoard
  | Record<string, unknown>;
export interface Mutation {
  action:
    | "upsert"
    | "delete"
    | "restore"
    | "rename"
    | "import"
    | "review-relationship"
    | "vote-idea";
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
  ideaId?: string;
  vote?: boolean;
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
