import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Columns3,
  Database,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Network,
  PanelsTopLeft,
  Zap,
} from "lucide-react";

export const workspaceNavigation = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "my-work", title: "My work", icon: CheckSquare },
  { id: "tasks", title: "Task board", icon: Columns3 },
  { id: "projects", title: "Projects", icon: FolderKanban },
  { id: "rooms", title: "Work rooms", icon: PanelsTopLeft },
  { id: "notes", title: "Notes", icon: BookOpen },
  { id: "brainstorm", title: "Brainstorming", icon: Zap },
  { id: "activity", title: "Activity", icon: ListChecks },
  { id: "graph", title: "Relationship graph", icon: Network },
  { id: "canvas", title: "Canvas", icon: PanelsTopLeft },
  { id: "collections", title: "Collections", icon: Database },
  { id: "daily", title: "Daily planner", icon: CalendarDays },
] as const;

export type WorkspacePage =
  | (typeof workspaceNavigation)[number]["id"]
  | "team"
  | "settings";
