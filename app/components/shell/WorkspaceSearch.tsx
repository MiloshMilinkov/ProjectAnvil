"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CircleHelp,
  FolderKanban,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import type { Workspace } from "../../lib/types";
import { useDialog } from "../useDialog";
import { StatusIcon } from "../WorkspacePrimitives";
import { workspaceNavigation, type WorkspacePage } from "./navigation";

const destinations = [
  ...workspaceNavigation,
  { id: "team" as const, title: "Teams & workspaces", icon: Users },
  { id: "settings" as const, title: "Workspace settings", icon: Settings },
];
interface Props {
  workspace: Workspace;
  canCreateTask: boolean;
  shortcut: string;
  onClose: () => void;
  onNavigate: (page: WorkspacePage) => void;
  onTask: (id: string) => void;
  onNote: (id: string) => void;
  onProject: (id: string) => void;
  onCreateTask: () => void;
  onGuide: () => void;
}

/** Search work and destinations together, with workspace access already applied. */
export default function WorkspaceSearch({
  workspace,
  canCreateTask,
  shortcut,
  onClose,
  onNavigate,
  onTask,
  onNote,
  onProject,
  onCreateTask,
  onGuide,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, onClose);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const index = useMemo(
    () => ({
      tasks: workspace.tasks.map((item) => ({
        item,
        text: [item.title, item.key, item.description, ...item.tags]
          .join(" ")
          .toLowerCase(),
      })),
      notes: workspace.notes.map((item) => ({
        item,
        text: [item.title, item.content, ...item.tags].join(" ").toLowerCase(),
      })),
      projects: workspace.projects.map((item) => ({
        item,
        text: item.name.toLowerCase(),
      })),
    }),
    [workspace.tasks, workspace.notes, workspace.projects],
  );
  const tasks = index.tasks
    .filter((entry) => entry.text.includes(query))
    .slice(0, 7);
  const notes = index.notes
    .filter((entry) => entry.text.includes(query))
    .slice(0, 6);
  const projects = index.projects
    .filter((entry) => entry.text.includes(query))
    .slice(0, 4);
  const tools = query
    ? destinations.filter((item) => item.title.toLowerCase().includes(query))
    : [];
  const hasResults =
    tasks.length + notes.length + projects.length + tools.length > 0;
  function choose(action: () => void) {
    onClose();
    action();
  }
  return (
    <div
      className="modal-shade palette-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
        className="command-palette"
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "k"
          ) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="palette-input">
          <Search size={20} />
          <input
            data-initial-focus
            aria-label="Search tasks, notes, and projects"
            placeholder="Search work or find a tool…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            className="key-button"
            aria-label="Close search"
            onClick={onClose}
          >
            esc
          </button>
        </div>
        <div className="palette-results">
          {!query && (
            <>
              <span className="section-label">Quick actions</span>
              <button
                disabled={!canCreateTask}
                onClick={() => choose(onCreateTask)}
              >
                <Plus size={16} />
                Create a task<kbd>{shortcut.toUpperCase()}</kbd>
              </button>
              <button onClick={() => choose(() => onNavigate("daily"))}>
                <CalendarDays size={16} />
                Open today&apos;s note
              </button>
              <button onClick={() => choose(onGuide)}>
                <CircleHelp size={16} />
                Open guides
              </button>
            </>
          )}
          {tools.length > 0 && (
            <>
              <span className="section-label">Go to</span>
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => choose(() => onNavigate(tool.id))}
                >
                  <tool.icon size={16} />
                  {tool.title}
                </button>
              ))}
            </>
          )}
          {tasks.length + notes.length + projects.length > 0 && (
            <span className="section-label">
              {query ? "Matching work" : "Your work"}
            </span>
          )}
          {tasks.map(({ item }) => (
            <button key={item.id} onClick={() => choose(() => onTask(item.id))}>
              <StatusIcon status={item.status} />
              <span className="muted">{item.key}</span>
              <span className="palette-result-title">{item.title}</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ))}
          {notes.map(({ item }) => (
            <button key={item.id} onClick={() => choose(() => onNote(item.id))}>
              <BookOpen size={15} />
              <span className="palette-result-title">
                {item.title || "Untitled note"}
              </span>
              <span className="badge">Note</span>
            </button>
          ))}
          {projects.map(({ item }) => (
            <button
              key={item.id}
              onClick={() => choose(() => onProject(item.id))}
            >
              <FolderKanban size={15} />
              <span className="palette-result-title">{item.name}</span>
              <span className="badge">Project</span>
            </button>
          ))}
          {!hasResults && (
            <p className="palette-empty">
              {query
                ? "No matches. Try a title, tag, task key, or tool name."
                : "Your tasks, notes, and projects will appear here. Start with a quick action above."}
            </p>
          )}
        </div>
        <footer>
          <span>
            <Search size={12} />
            Work and tools in this workspace
          </span>
          <span>Tab to choose · Enter to open</span>
        </footer>
      </section>
    </div>
  );
}
