import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ListTodo,
  TableProperties,
  FolderKanban,
  LayoutDashboard,
  History,
  Network,
  PanelsTopLeft,
  Lightbulb,
  Frame,
} from "lucide-react";

export const workspaceNavigation = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "my-work", title: "My work", icon: CheckSquare },
  { id: "tasks", title: "Tasks", icon: ListTodo },
  { id: "projects", title: "Projects", icon: FolderKanban },
  { id: "rooms", title: "Work rooms", icon: PanelsTopLeft },
  { id: "notes", title: "Notes", icon: BookOpen },
  { id: "brainstorm", title: "Brainstorming", icon: Lightbulb },
  { id: "activity", title: "Activity", icon: History },
  { id: "graph", title: "Relationship graph", icon: Network },
  { id: "canvas", title: "Canvas", icon: Frame },
  { id: "collections", title: "Collections", icon: TableProperties },
  { id: "daily", title: "Daily notes", icon: CalendarDays },
] as const;

export type WorkspacePage =
  | (typeof workspaceNavigation)[number]["id"]
  | "team"
  | "settings";

export const navigationGroups = [
  {
    title: "Work",
    pages: ["overview", "my-work", "tasks", "projects", "daily"],
  },
  {
    title: "Notes & ideas",
    pages: ["notes", "brainstorm", "canvas", "graph"],
  },
  { title: "More tools", pages: ["rooms", "collections", "activity"] },
] as const;
