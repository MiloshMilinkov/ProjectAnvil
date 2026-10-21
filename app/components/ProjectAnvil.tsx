"use client";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  BookOpen,
  Network,
  PanelsTopLeft,
  CalendarDays,
  Users,
  Settings,
  X,
  ChevronRight,
  Check,
  MoreHorizontal,
  List,
  Columns3,
  Bookmark,
  Database,
  Command,
  Menu,
  Sparkles,
  Download,
  Upload,
  Link2,
  Target,
  Bug,
  Layers,
  CircleDashed,
  CircleCheck,
  WifiOff,
  RefreshCw,
  Zap,
  CircleHelp,
  Anvil,
} from "lucide-react";
import {
  Workspace,
  Task,
  Person,
  Project,
  FeatureProps,
  Status,
  Priority,
  statuses,
  priorities,
  uid,
  today,
} from "../lib/types";
import Knowledge from "./Knowledge";
import { AppearancePicker, AppearanceMenu } from "./ThemeControls";
import Collections from "./Collections";
import { GraphView, CanvasView } from "./Visuals";
import GuidedTour, { type TourPage } from "./GuidedTour";
import WorkRooms, { ResumeWorkCard, WorkRoomShelf } from "./WorkRooms";
import TaskDialog from "./TaskDialog";
import ProjectDialog from "./ProjectDialog";
import PersonDialog from "./PersonDialog";
import { Avatar, Empty, StatusIcon } from "./WorkspacePrimitives";
import { useWorkRoomNavigation } from "./useWorkRoomNavigation";
import type { WorkRoom } from "../lib/workrooms";
import "./guest.css";
import { AccountMenu, WorkspaceSwitcher, TeamManager } from "./AccountControls";
import { useWorkspaceScope } from "./WorkspaceScope";
import { readBrowserPreference } from "../lib/browser-preferences";
import { useWorkspaceData } from "./useWorkspaceData";
import {
  defaultPreferences,
  parseWorkspacePreferences,
  type WorkspacePreferences,
} from "../lib/workspace-preferences";
import {
  flushDraftGuards,
  hasUnpersistedDrafts,
  listDrafts,
  subscribeDrafts,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import StorageHealth from "./StorageHealth";
import PendingChanges from "./PendingChanges";
import { useMediaQuery } from "./useMediaQuery";
import { useDialog } from "./useDialog";

type Page = TourPage;
const nav = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "my-work", title: "My work", icon: CheckSquare },
  { id: "tasks", title: "Task board", icon: Columns3 },
  { id: "projects", title: "Projects", icon: FolderKanban },
  { id: "rooms", title: "Work rooms", icon: PanelsTopLeft },
  { id: "notes", title: "Knowledge", icon: BookOpen },
  { id: "graph", title: "Relationship graph", icon: Network },
  { id: "canvas", title: "Canvas", icon: PanelsTopLeft },
  { id: "collections", title: "Collections", icon: Database },
  { id: "daily", title: "Daily planner", icon: CalendarDays },
] as const;
const priorityColor: Record<Priority, string> = {
  urgent: "#ef878b",
  high: "#edb36e",
  medium: "#a397f8",
  low: "#7fa7c5",
};
const dateLabel = (d: string) =>
  d
    ? new Date(d + "T12:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "No date";
function PriorityMark({ value }: { value: Priority }) {
  return (
    <span
      className="priority-mark"
      style={{ color: priorityColor[value] }}
      title={value}
    >
      <span style={{ height: value === "low" ? 5 : 8 }} />
      <span
        style={{
          height: value === "low" ? 8 : value === "medium" ? 11 : 12,
          opacity: value === "low" ? 0.3 : 1,
        }}
      />
      <span
        style={{
          height: 15,
          opacity: value === "low" || value === "medium" ? 0.25 : 1,
        }}
      />
    </span>
  );
}
export default function ProjectAnvil() {
  const phoneLayout = useMediaQuery("(max-width: 760px)");
  const sidebarRef = useRef<HTMLElement>(null);
  const { account, activeId, onSwitch, onAuthChanged, onChanged } =
    useWorkspaceScope();
  const {
    workspace,
    load,
    loadError,
    mutate,
    pending,
    syncError,
    outboxSize,
    retrySaves,
  } = useWorkspaceData();
  const draftScope = useDraftScope();
  const recoveryCount = useSyncExternalStore(
    subscribeDrafts,
    useCallback(
      () => listDrafts(draftScope, "recovery-copies").length,
      [draftScope],
    ),
    () => 0,
  );
  const [startup] = useState(() => {
    let preferences = defaultPreferences;
    try {
      preferences = parseWorkspacePreferences(
        JSON.parse(readBrowserPreference("projectanvil-preferences") || "null"),
      );
    } catch {}
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    return {
      preferences,
      note: params.get("note") || "",
      focus: params.get("focus") === "1",
    };
  });
  const [prefs, setPrefs] = useState<WorkspacePreferences>(startup.preferences);
  const [page, setPage] = useState<Page>(
      startup.note ? "notes" : startup.preferences.savedPage,
    ),
    [mobile, setMobile] = useState(false),
    [projectFilter, setProjectFilter] = useState(""),
    [selectedNote, setSelectedNote] = useState(startup.note),
    [selectedTask, setSelectedTask] = useState<string | null>(null),
    [newTask, setNewTask] = useState(false),
    [newTaskStatus, setNewTaskStatus] = useState<Status>("todo"),
    [newProject, setNewProject] = useState(false),
    [editingProject, setEditingProject] = useState<Project | null>(null),
    [personModal, setPersonModal] = useState<Person | "new" | null>(null),
    [palette, setPalette] = useState(false),
    [search, setSearch] = useState(""),
    [toast, setToast] = useState(""),
    [focus, setFocus] = useState(startup.focus),
    [shortcuts, setShortcuts] = useState(false),
    [tourOpen, setTourOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [tourPending, setTourPending] = useState(
    () => !readBrowserPreference("projectanvil-tour-v1"),
  );
  useDialog(sidebarRef, () => setMobile(false), false, phoneLayout && mobile);
  const currentPerson =
    workspace?.people.find(
      (person) => person.userId === account.user?.id && !!account.user,
    )?.id || "";
  const tourChecked = useRef(false),
    tourReturnPage = useRef<Page>("overview"),
    tourReturnFocus = useRef(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 4200);
  }, []);
  useEffect(
    () => () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!workspace || tourChecked.current) return;
    const seen = !!readBrowserPreference("projectanvil-tour-v1");
    const frame = requestAnimationFrame(() => {
      tourChecked.current = true;
      setTourPending(false);
      if (seen) return;
      tourReturnPage.current = page;
      tourReturnFocus.current = focus;
      setFocus(false);
      setTourOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace, page, focus]);
  const beforeNavigation = useCallback(async () => {
    await flushDraftGuards(draftScope);
    if (hasUnpersistedDrafts(draftScope)) {
      notify(
        "Keep this page open until your recording or unsaved recovery copy can be saved.",
      );
      return false;
    }
    return true;
  }, [draftScope, notify]);
  const closeTransientViews = useCallback(() => {
    setMobile(false);
    setPalette(false);
    setNewTask(false);
    setNewProject(false);
    setPersonModal(null);
    setShortcuts(false);
  }, []);
  const rooms = useWorkRoomNavigation({
    workspace,
    page,
    projectFilter,
    selectedNote,
    setPage,
    setProjectFilter,
    setSelectedNote,
    setSelectedTask,
    closeTransientViews,
    beforeNavigation,
    notify,
  });
  const openTask = useCallback((id: string) => {
      setSelectedTask(id);
      setNewTask(false);
    }, []),
    openNote = useCallback(
      (id: string) => {
        void (async () => {
          if (!(await beforeNavigation())) return;
          setSelectedNote(id);
          setPage("notes");
          setMobile(false);
        })();
      },
      [beforeNavigation],
    );
  const captureRoomContext = rooms.captureRoomContext;
  const go = useCallback(
    (nextPage: Page) => {
      void (async () => {
        if (nextPage !== page && !(await beforeNavigation())) return;
        if (nextPage === "rooms") captureRoomContext();
        setPage(nextPage);
        setMobile(false);
        setSearch("");
      })();
    },
    [page, beforeNavigation, captureRoomContext],
  );
  const closeTour = useCallback(() => {
    try {
      localStorage.setItem("projectanvil-tour-v1", "seen");
    } catch {}
    setPage(tourReturnPage.current);
    setFocus(tourReturnFocus.current);
    setTourOpen(false);
  }, []);
  function startTour() {
    void (async () => {
      if (!(await beforeNavigation())) return;
      tourReturnPage.current = page;
      tourReturnFocus.current = focus;
      setFocus(false);
      setMobile(false);
      setPalette(false);
      setShortcuts(false);
      setTourOpen(true);
    })();
  }
  function savePrefs(input: WorkspacePreferences) {
    const preferences = parseWorkspacePreferences(input);
    setPrefs(preferences);
    try {
      localStorage.setItem(
        "projectanvil-preferences",
        JSON.stringify(preferences),
      );
    } catch {
      notify(
        "Preferences apply for this session; this browser could not store them.",
      );
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        tourOpen ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      const input = (e.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setMobile(false);
        setShortcuts(false);
      }
      if (!input && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key.toLowerCase() === prefs.taskShortcut) {
          e.preventDefault();
          setNewTask(true);
          setSelectedTask(null);
        }
        if (e.key === "?") setShortcuts(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefs.taskShortcut, tourOpen]);
  if (!workspace)
    return (
      <main className="loading-page">
        <div className="brand-mark">
          <Anvil size={25} />
        </div>
        <h1>ProjectAnvil</h1>
        <p>{loadError || "Opening your workspace…"}</p>
        {loadError ? (
          <button className="btn" onClick={load}>
            <RefreshCw size={15} /> Try again
          </button>
        ) : (
          <div className="loading-line" />
        )}
      </main>
    );
  const w = workspace,
    project = w.projects.find((p) => p.id === projectFilter);
  const featureProps: FeatureProps = {
    workspace: w,
    mutate,
    openTask,
    openNote,
    currentPerson,
    projectFilter,
    notify,
  };
  const activeNav = nav.find((n) => n.id === page);
  return (
    <div
      className={
        "app-shell " +
        (prefs.compact ? "compact " : "") +
        (focus ? "focus-mode" : "")
      }
    >
      {!focus && (
        <>
          <div
            className={"mobile-scrim " + (mobile ? "visible" : "")}
            onClick={() => setMobile(false)}
          />
          <aside
            ref={sidebarRef}
            className={"sidebar " + (mobile ? "is-open" : "")}
            inert={phoneLayout && !mobile}
            role={phoneLayout && mobile ? "dialog" : undefined}
            aria-modal={phoneLayout && mobile ? true : undefined}
            aria-label="Workspace navigation"
          >
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                go("overview");
              }}
            >
              <span className="brand-mark">
                <Anvil size={19} />
              </span>
              ProjectAnvil<span className="brand-beta">BETA</span>
            </a>
            <WorkspaceSwitcher
              account={account}
              activeId={activeId}
              onSwitch={onSwitch}
              onManage={() => go("team")}
            />
            <button
              data-tour="search"
              className="sidebar-search"
              onClick={() => setPalette(true)}
            >
              <Search size={15} />
              <span>Search anything</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="nav-caption">WORKSPACE</div>
            <nav>
              {nav.slice(0, 5).map((n) => (
                <button
                  key={n.id}
                  data-tour={"nav-" + n.id}
                  className={"nav-item " + (page === n.id ? "active" : "")}
                  onClick={() => go(n.id)}
                >
                  <n.icon size={17} />
                  <span>{n.title}</span>
                  {n.id === "my-work" && (
                    <small>
                      {
                        w.tasks.filter(
                          (t) =>
                            t.assigneeId === currentPerson &&
                            t.status !== "done",
                        ).length
                      }
                    </small>
                  )}
                </button>
              ))}
              <div className="nav-caption knowledge-caption">
                IDEAS & KNOWLEDGE
              </div>
              {nav.slice(5).map((n) => (
                <button
                  key={n.id}
                  data-tour={"nav-" + n.id}
                  className={"nav-item " + (page === n.id ? "active" : "")}
                  onClick={() => go(n.id)}
                >
                  <n.icon size={17} />
                  <span>{n.title}</span>
                  {n.id === "graph" && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-projects">
              <div className="nav-caption">
                YOUR PROJECTS
                <button
                  title="Create project"
                  aria-label="Create project"
                  onClick={() => {
                    setEditingProject(null);
                    setNewProject(true);
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
              {w.projects.map((p) => (
                <button
                  key={p.id}
                  className={
                    "project-nav " + (projectFilter === p.id ? "selected" : "")
                  }
                  onClick={() => {
                    setProjectFilter(projectFilter === p.id ? "" : p.id);
                    go("tasks");
                  }}
                >
                  <span
                    className="project-dot"
                    style={{ background: p.color }}
                  />
                  {p.name}
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
            <div className="sidebar-bottom">
              <div className="connected-callout">
                <Network size={20} />
                <p>
                  <strong>Big ideas need connections.</strong>
                  <span>Explore your workspace’s knowledge.</span>
                </p>
                <button
                  title="Open relationship graph"
                  onClick={() => go("graph")}
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <button
                data-tour="nav-team"
                className={"nav-item " + (page === "team" ? "active" : "")}
                onClick={() => go("team")}
              >
                <Users size={17} />
                Teams & people<span className="nav-end">{w.people.length}</span>
              </button>
              <button
                data-tour="nav-settings"
                className={"nav-item " + (page === "settings" ? "active" : "")}
                onClick={() => go("settings")}
              >
                <Settings size={17} />
                Workspace settings
              </button>
              <div className="sidebar-footer">
                <span
                  className={
                    "connection-dot " +
                    (syncError || loadError ? "offline" : "")
                  }
                />
                {loadError
                  ? "Connection needs attention"
                  : syncError
                    ? "Save needs attention"
                    : pending
                      ? "Saving changes…"
                      : "Local workspace ready"}
                <button
                  title="Keyboard shortcuts"
                  onClick={() => setShortcuts(true)}
                >
                  <Command size={13} />
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="btn-icon mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>{project?.name || "Workspace"}</span>
            <ChevronRight size={13} />
            <strong>
              {activeNav?.title ||
                (page === "team" ? "Team & people" : "Settings")}
            </strong>
          </div>
          <div className="topbar-actions">
            <div data-tour="appearance">
              <AppearanceMenu />
            </div>
            <button
              type="button"
              className="btn-icon tour-trigger"
              data-tour="tour-button"
              title="Guide to ProjectAnvil"
              aria-label="Start guided tour"
              onClick={startTour}
            >
              <CircleHelp size={18} />
            </button>
            {focus && (
              <button className="btn" onClick={() => setFocus(false)}>
                Show workspace
              </button>
            )}
            <span className="live-indicator">
              <span />
              Local workspace
            </span>
            <button
              className="top-search btn-icon"
              title="Search (Ctrl K)"
              aria-label="Search workspace"
              onClick={() => setPalette(true)}
            >
              <Search size={17} />
            </button>
            <div data-tour="guest">
              <AccountMenu
                account={account}
                onAuthChanged={onAuthChanged}
                onOpenTeams={() => go("team")}
              />
            </div>
          </div>
        </header>
        {rooms.activeRoom && page !== "rooms" && (
          <WorkRoomShelf
            room={rooms.activeRoom}
            workspace={w}
            onOpenNote={openNote}
            onOpenTask={openTask}
            onOpenCanvas={(id) =>
              rooms.openRoomCanvas(id, rooms.activeRoom ?? undefined)
            }
            onManage={() => go("rooms")}
            onDismiss={rooms.dismissRoom}
          />
        )}
        {loadError && (
          <div className="error-banner" role="status">
            <WifiOff size={15} />
            Connection interrupted. Displayed information may be out of date.{" "}
            {loadError}
            <button onClick={() => void load()}>Retry connection</button>
          </div>
        )}
        {syncError && (
          <div className="error-banner" role="alert">
            <WifiOff size={15} />
            {syncError}
            <button disabled={pending > 0} onClick={() => void retrySaves()}>
              Retry saves{outboxSize ? ` (${outboxSize})` : ""}
            </button>
            <button onClick={() => setReviewPending(true)}>
              Review unsaved changes
            </button>
          </div>
        )}
        {recoveryCount > 0 && (
          <div className="error-banner" role="status">
            {recoveryCount}{" "}
            {recoveryCount === 1 ? "draft copy was" : "draft copies were"} kept
            from another window.
            <button onClick={() => setReviewPending(true)}>
              Review recovery copies
            </button>
          </div>
        )}
        <main
          data-tour="workspace-content"
          className={"main-content view-" + page}
        >
          {page === "overview" && (
            <Overview
              {...featureProps}
              onGo={go}
              onCreate={() => {
                setNewTask(true);
                setSelectedTask(null);
              }}
              onProject={(p) => {
                setProjectFilter(p);
                go("tasks");
              }}
              onResumeRoom={rooms.resumeRoom}
            />
          )}
          {page === "rooms" && (
            <WorkRooms
              workspace={w}
              location={rooms.roomLocation}
              onResume={rooms.resumeRoom}
              onRoomsChanged={rooms.syncRooms}
              notify={notify}
            />
          )}
          {(page === "tasks" || page === "my-work") && (
            <TaskView
              {...featureProps}
              mine={page === "my-work"}
              onCreate={(status) => {
                setNewTaskStatus(status || "todo");
                setNewTask(true);
                setSelectedTask(null);
              }}
              setProjectFilter={setProjectFilter}
            />
          )}
          {page === "projects" && (
            <div className="page">
              <PageHeader
                eyebrow="THE BIG PICTURE"
                title="Projects"
                description="From the first spark to the final build."
                action={
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setEditingProject(null);
                      setNewProject(true);
                    }}
                  >
                    <Plus size={16} />
                    New project
                  </button>
                }
              />
              <div className="projects-grid">
                {w.projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    workspace={w}
                    onOpen={() => {
                      setProjectFilter(p.id);
                      go("tasks");
                    }}
                    onEdit={() => {
                      setEditingProject(p);
                      setNewProject(true);
                    }}
                  />
                ))}
                <button
                  className="project-add"
                  onClick={() => {
                    setEditingProject(null);
                    setNewProject(true);
                  }}
                >
                  <Plus size={25} />
                  <strong>Start something new</strong>
                  <span>Create a project for your next idea</span>
                </button>
              </div>
            </div>
          )}
          {(page === "notes" || page === "daily") && (
            <Knowledge
              {...featureProps}
              selectedNote={selectedNote}
              onSelectNote={setSelectedNote}
              mode={page === "daily" ? "daily" : "notes"}
              tourActive={tourPending || tourOpen}
            />
          )}
          {page === "graph" && (
            <GraphView
              {...featureProps}
              onClearProjectFilter={() => setProjectFilter("")}
            />
          )}
          {page === "canvas" && (
            <CanvasView
              {...featureProps}
              resumeContext={rooms.canvasResume}
              onContextChange={rooms.trackCanvas}
            />
          )}
          {page === "collections" && <Collections {...featureProps} />}
          {page === "team" && (
            <TeamManager
              account={account}
              activeId={activeId}
              onChanged={onChanged}
              onSwitch={onSwitch}
              notify={notify}
            />
          )}
          {page === "settings" && (
            <SettingsView
              {...featureProps}
              onPerson={setPersonModal}
              prefs={prefs}
              savePrefs={savePrefs}
              page={page}
              onShortcuts={() => setShortcuts(true)}
            />
          )}
        </main>
      </div>
      {(newTask || selectedTask) && (
        <TaskDialog
          key={selectedTask || "new-task"}
          workspace={w}
          task={w.tasks.find((t) => t.id === selectedTask)}
          projectId={projectFilter}
          personId={currentPerson}
          initialStatus={newTaskStatus}
          mutate={mutate}
          onClose={() => {
            setSelectedTask(null);
            setNewTask(false);
          }}
          openNote={openNote}
          notify={notify}
        />
      )}
      {newProject && (
        <ProjectDialog
          project={editingProject}
          mutate={mutate}
          onClose={() => setNewProject(false)}
          notify={notify}
        />
      )}
      {personModal && (
        <PersonDialog
          person={personModal === "new" ? null : personModal}
          mutate={mutate}
          onClose={() => setPersonModal(null)}
          notify={notify}
        />
      )}
      {palette && (
        <div
          className="modal-shade palette-shade"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPalette(false);
          }}
        >
          <section
            role="dialog"
            aria-label="Search workspace"
            className="command-palette"
          >
            <div className="palette-input">
              <Search size={20} />
              <input
                autoFocus
                placeholder="Search tasks, knowledge, projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="key-button" onClick={() => setPalette(false)}>
                esc
              </button>
            </div>
            <div className="palette-results">
              {!search && (
                <>
                  <span className="section-label">QUICK ACTIONS</span>
                  <button
                    onClick={() => {
                      setPalette(false);
                      setSelectedTask(null);
                      setNewTask(true);
                    }}
                  >
                    <Plus size={16} />
                    Create a task<kbd>{prefs.taskShortcut.toUpperCase()}</kbd>
                  </button>
                  <button
                    onClick={() => {
                      setPalette(false);
                      go("daily");
                    }}
                  >
                    <CalendarDays size={16} />
                    Open today’s planner
                  </button>
                </>
              )}
              <span className="section-label">
                {search ? "RESULTS" : "RECENT WORK"}
              </span>
              {w.tasks
                .filter((t) =>
                  [t.title, t.key, t.description, ...t.tags]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .slice(0, 7)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      openTask(t.id);
                      setPalette(false);
                    }}
                  >
                    <StatusIcon status={t.status} />
                    <span className="muted">{t.key}</span>
                    {t.title}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              {w.notes
                .filter((n) =>
                  [n.title, n.content, ...n.tags]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .slice(0, 6)
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      openNote(n.id);
                      setPalette(false);
                    }}
                  >
                    <BookOpen size={15} />
                    {n.title}
                    <span className="badge">{n.kind}</span>
                  </button>
                ))}
              {w.projects
                .filter((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 4)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProjectFilter(p.id);
                      go("tasks");
                      setPalette(false);
                    }}
                  >
                    <FolderKanban size={15} />
                    {p.name}
                    <span className="badge">Project</span>
                  </button>
                ))}
              {search &&
                !w.tasks.some((t) =>
                  (t.title + t.description + t.key + t.tags.join())
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) &&
                !w.notes.some((n) =>
                  (n.title + n.content + n.tags.join())
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) &&
                !w.projects.some((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()),
                ) && (
                  <p className="palette-empty">
                    No matches. Try a title, tag, or task key.
                  </p>
                )}
            </div>
            <footer>
              <span>
                <Search size={12} />
                Searches your entire workspace
              </span>
              <span>Click to open</span>
            </footer>
          </section>
        </div>
      )}
      {shortcuts && (
        <div className="modal-shade" onClick={() => setShortcuts(false)}>
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="small-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2>Make yourself at home</h2>
              <button className="btn-icon" onClick={() => setShortcuts(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="muted">A few shortcuts to keep your flow.</p>
            <div className="shortcut-row">
              Search & quick actions <kbd>Ctrl / ⌘ K</kbd>
            </div>
            <div className="shortcut-row">
              Create a task <kbd>{prefs.taskShortcut.toUpperCase()}</kbd>
            </div>
            <div className="shortcut-row">
              Show shortcuts <kbd>?</kbd>
            </div>
            <div className="shortcut-row">
              Close search or menu <kbd>Esc</kbd>
            </div>
            <p className="muted small-text">
              Task shortcuts are paused while typing. Change your task shortcut
              in workspace settings.
            </p>
          </div>
        </div>
      )}
      {reviewPending && (
        <PendingChanges
          workspace={w}
          busy={pending > 0}
          onClose={() => setReviewPending(false)}
        />
      )}
      {tourOpen && <GuidedTour onNavigate={go} onClose={closeTour} />}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{action}</div>
    </div>
  );
}
function Overview(
  props: FeatureProps & {
    onGo: (p: Page) => void;
    onCreate: () => void;
    onProject: (id: string) => void;
    onResumeRoom: (room: WorkRoom) => void;
  },
) {
  const {
      workspace: w,
      currentPerson,
      openNote,
      onGo,
      onCreate,
      onProject,
    } = props,
    tasks = w.tasks.filter(
      (t) => !props.projectFilter || t.projectId === props.projectFilter,
    ),
    active = tasks.filter((t) => t.status !== "done"),
    mine = active.filter((t) => t.assigneeId === currentPerson),
    done = tasks.filter((t) => t.status === "done"),
    overdue = active.filter((t) => t.dueDate && t.dueDate < today()),
    upcoming = [...active]
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
      .slice(0, 5),
    projects = w.projects.filter(
      (p) => !props.projectFilter || p.id === props.projectFilter,
    ),
    notes = [...w.notes]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 4);
  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow={new Date()
          .toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          .toUpperCase()}
        title="Workspace overview"
        description="A little less scattered. A lot more connected."
        action={
          <>
            <button className="btn" onClick={() => onGo("tasks")}>
              <Columns3 size={15} />
              View board
            </button>
            <button className="btn btn-primary" onClick={onCreate}>
              <Plus size={16} />
              Create task
            </button>
          </>
        }
      />
      <section className="overview-hero">
        <div className="hero-copy">
          <span className="hero-label">
            <span />
            YOUR PROJECT WORKSPACE
          </span>
          <h2>
            Plan clearly.
            <br />
            <span>Make progress.</span>
          </h2>
          <p>Your projects, tasks, and ideas—connected in one place.</p>
          <button onClick={() => onGo("canvas")}>
            Open your canvas <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 520 220">
            <defs>
              <radialGradient id="halo">
                <stop
                  stopColor="var(--theme-ink-9272db,#9272db)"
                  stopOpacity=".24"
                />
                <stop
                  offset="1"
                  stopColor="var(--theme-ink-9272db,#9272db)"
                  stopOpacity="0"
                />
              </radialGradient>
              <linearGradient id="edge">
                <stop
                  stopColor="var(--theme-ink-6e5b95,#6e5b95)"
                  stopOpacity=".1"
                />
                <stop
                  offset=".5"
                  stopColor="var(--theme-ink-9e8bc4,#9e8bc4)"
                  stopOpacity=".6"
                />
                <stop
                  offset="1"
                  stopColor="var(--theme-ink-6e5b95,#6e5b95)"
                  stopOpacity=".1"
                />
              </linearGradient>
            </defs>
            <ellipse cx="285" cy="115" rx="220" ry="110" fill="url(#halo)" />
            {[
              [80, 80, 258, 103],
              [138, 174, 258, 103],
              [258, 103, 416, 51],
              [258, 103, 427, 159],
              [258, 103, 325, 207],
              [416, 51, 427, 159],
              [80, 80, 138, 174],
            ].map((l, i) => (
              <line
                key={i}
                x1={l[0]}
                y1={l[1]}
                x2={l[2]}
                y2={l[3]}
                stroke="url(#edge)"
                strokeWidth="1.5"
              />
            ))}
            <circle
              cx="258"
              cy="103"
              r="54"
              fill="none"
              stroke="var(--theme-line-a084d1,#a084d1)"
              opacity=".12"
            />
            <circle
              cx="258"
              cy="103"
              r="40"
              fill="var(--theme-surface-292331,#292331)"
              stroke="var(--theme-line-a086d0,#a086d0)"
              strokeWidth="1"
            />
            <path
              d="M258 80l21 12v24l-21 12-21-12V92zm0 0v24m-21-12 21 12 21-12m-21 12v24"
              stroke="var(--theme-line-c3a7f2,#c3a7f2)"
              fill="none"
              strokeWidth="1.6"
            />
            {[
              [80, 80],
              [138, 174],
              [416, 51],
              [427, 159],
              [325, 207],
            ].map((p, i) => (
              <g key={i}>
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r={i === 2 ? 23 : 17}
                  fill="var(--theme-surface-24212c,#24212c)"
                  stroke="var(--theme-line-645572,#645572)"
                />
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r="4"
                  fill={i % 2 ? "#9ac7ae" : "#ad98ce"}
                />
              </g>
            ))}
          </svg>
          <div className="hero-note note-a">
            <BookOpen size={13} />
            Project notes
          </div>
          <div className="hero-note note-b">
            <CheckSquare size={13} />
            Next milestone
          </div>
          <div className="hero-note note-c">
            <Sparkles size={13} />
            The next big idea
          </div>
        </div>
      </section>
      <ResumeWorkCard
        onResume={props.onResumeRoom}
        onManage={() => onGo("rooms")}
        notify={props.notify}
      />
      <div className="stat-grid">
        {[
          {
            label: "Active tasks",
            value: active.length,
            sub: tasks.length + " tasks across your projects",
            icon: Layers,
            color: "violet",
            action: () => onGo("tasks"),
          },
          {
            label: "In progress",
            value: tasks.filter((t) => t.status === "in-progress").length,
            sub: "Ideas becoming something real",
            icon: CircleDashed,
            color: "blue",
            action: () => onGo("tasks"),
          },
          {
            label: "Completed",
            value: done.length,
            sub: `${tasks.length ? Math.round((done.length / tasks.length) * 100) : 0}% of all tasks finished`,
            icon: CircleCheck,
            color: "green",
            action: () => onGo("tasks"),
          },
          {
            label: "Assigned to you",
            value: mine.length,
            sub: overdue.length
              ? `${overdue.length} overdue across the workspace`
              : "You have room to make progress",
            icon: Target,
            color: "orange",
            action: () => onGo("my-work"),
          },
        ].map((s) => (
          <button className="stat-card" key={s.label} onClick={s.action}>
            <div className="stat-top">
              <span>{s.label}</span>
              <s.icon size={17} className={"color-" + s.color} />
            </div>
            <strong>
              {s.value}
              <ArrowUpRight size={17} />
            </strong>
            <small>{s.sub}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel project-section">
          <div className="section-heading">
            <h2>
              <FolderKanban size={17} />
              On the drawing board
            </h2>
            <button className="text-button" onClick={() => onGo("projects")}>
              All projects <ArrowRight size={13} />
            </button>
          </div>
          <div className="project-summaries">
            {projects.map((p) => {
              const pt = tasks.filter((t) => t.projectId === p.id),
                pd = pt.filter((t) => t.status === "done").length,
                percent = pt.length ? Math.round((pd / pt.length) * 100) : 0;
              return (
                <button
                  className="project-summary"
                  key={p.id}
                  onClick={() => onProject(p.id)}
                >
                  <div
                    className="project-summary-icon"
                    style={{ background: p.color + "18", color: p.color }}
                  >
                    <FolderKanban size={21} />
                  </div>
                  <div className="project-summary-copy">
                    <div>
                      <h3>{p.name}</h3>
                      <span className="badge">{p.status}</span>
                    </div>
                    <p>{p.goal || p.description}</p>
                    <div className="progress-label">
                      <span>
                        {pd} of {pt.length} tasks complete
                      </span>
                      <strong>{percent}%</strong>
                    </div>
                    <div className="mini-progress">
                      <span
                        style={{ width: percent + "%", background: p.color }}
                      />
                    </div>
                  </div>
                  <ChevronRight size={15} />
                </button>
              );
            })}
            {!projects.length && (
              <Empty
                title="Your next project starts here"
                text="Create a project to connect its tasks and ideas."
              />
            )}
          </div>
        </section>
        <section className="panel knowledge-peek">
          <div className="section-heading">
            <h2>
              <BookOpen size={17} />
              Recently in your mind
            </h2>
            <button
              className="icon-link"
              aria-label="Open knowledge"
              onClick={() => onGo("notes")}
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
          {notes.map((n) => (
            <button
              className="note-peek"
              key={n.id}
              onClick={() => openNote(n.id)}
            >
              <span className={"note-kind kind-" + n.kind}>
                <BookOpen size={15} />
              </span>
              <div>
                <strong>{n.title}</strong>
                <small>
                  {n.folder} <span>·</span> {n.kind}
                </small>
              </div>
              {n.bookmarked ? (
                <Bookmark size={13} className="muted" />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          ))}
          <button className="knowledge-footer" onClick={() => onGo("graph")}>
            <Network size={16} />
            <span>See how your ideas connect</span>
            <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel due-section">
        <div className="section-heading">
          <h2>
            <CheckSquare size={17} />
            Coming into focus{" "}
            <span className="count-badge">{upcoming.length}</span>
          </h2>
          <button className="text-button" onClick={() => onGo("tasks")}>
            All tasks <ArrowRight size={13} />
          </button>
        </div>
        <TaskTable {...props} tasks={upcoming} />
        {!upcoming.length && (
          <Empty
            title="A clear horizon"
            text="Create a task to plan what comes next."
            action={
              <button className="btn" onClick={onCreate}>
                <Plus size={15} />
                Create task
              </button>
            }
          />
        )}
      </section>
      <div className="dashboard-foot">
        <span>
          <span className="connection-dot" />
          One workspace. Every connection.
        </span>
        <span>ProjectAnvil / Built for the way you work.</span>
      </div>
    </div>
  );
}
function TaskTable({
  workspace: w,
  tasks,
  openTask,
  mutate,
}: {
  workspace: Workspace;
  tasks: Task[];
  openTask: (id: string) => void;
  mutate: FeatureProps["mutate"];
  notify: FeatureProps["notify"];
}) {
  return (
    <div className="table-scroll">
      <table className="task-table">
        <thead>
          <tr>
            <th className="task-name-cell">Task</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>
                <button
                  className="task-title-button"
                  onClick={() => openTask(t.id)}
                >
                  <StatusIcon status={t.status} />
                  <span className="task-key">{t.key}</span>
                  <strong>{t.title}</strong>
                  {t.blockedBy.some(
                    (id) => w.tasks.find((x) => x.id === id)?.status !== "done",
                  ) && (
                    <span title="Blocked by a dependency">
                      <Link2 size={13} />
                    </span>
                  )}
                </button>
              </td>
              <td>
                <select
                  className={"status-select status-" + t.status}
                  aria-label={"Status for " + t.key}
                  value={t.status}
                  onChange={(e) =>
                    mutate({
                      action: "upsert",
                      entity: "tasks",
                      item: { id: t.id, status: e.target.value },
                    }).catch(() => {})
                  }
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <span className="priority-inline">
                  <PriorityMark value={t.priority} />
                  <span>{t.priority}</span>
                </span>
              </td>
              <td>
                <span className="assignee-inline">
                  <Avatar
                    person={w.people.find((p) => p.id === t.assigneeId)}
                    small
                  />
                  <span>
                    {w.people
                      .find((p) => p.id === t.assigneeId)
                      ?.name.split(" ")[0] || "Unassigned"}
                  </span>
                </span>
              </td>
              <td>
                <span
                  className={
                    "due-date " +
                    (t.dueDate && t.dueDate < today() && t.status !== "done"
                      ? "overdue"
                      : "")
                  }
                >
                  <CalendarDays size={12} />
                  {dateLabel(t.dueDate)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TaskView(
  props: FeatureProps & {
    mine: boolean;
    onCreate: (status?: Status) => void;
    setProjectFilter: (id: string) => void;
  },
) {
  const {
    workspace: w,
    mine,
    currentPerson,
    projectFilter,
    setProjectFilter,
    openTask,
    mutate,
    notify,
  } = props;
  const [view, setView] = useState("board"),
    [query, setQuery] = useState(""),
    [assignee, setAssignee] = useState(""),
    [priority, setPriority] = useState(""),
    [status, setStatus] = useState(""),
    [viewName, setViewName] = useState(""),
    [savingView, setSavingView] = useState(false),
    [dragging, setDragging] = useState(""),
    [dragOver, setDragOver] = useState("");
  const tasks = w.tasks
    .filter(
      (t) =>
        (!projectFilter || t.projectId === projectFilter) &&
        (!mine || t.assigneeId === currentPerson) &&
        (!assignee || t.assigneeId === assignee) &&
        (!priority || t.priority === priority) &&
        (!status || t.status === status) &&
        [t.title, t.description, t.key, ...t.tags]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority),
    );
  function clear() {
    setQuery("");
    setAssignee("");
    setPriority("");
    setStatus("");
    setProjectFilter("");
  }
  async function saveView() {
    if (!viewName.trim()) return;
    await mutate({
      action: "upsert",
      entity: "savedViews",
      item: {
        id: uid(),
        name: viewName.trim(),
        query,
        assignee,
        priority,
        project: projectFilter,
        status,
      },
    });
    setSavingView(false);
    setViewName("");
    notify("View saved");
  }
  return (
    <div className="page tasks-page">
      <PageHeader
        eyebrow={mine ? "YOUR NEXT STEPS" : "FROM PLANNING TO PROGRESS"}
        title={mine ? "My work" : "Task board"}
        description={
          mine
            ? currentPerson
              ? "Tasks assigned to you in this workspace."
              : "Your unassigned tasks, ready to work on as a guest."
            : "Plan the next step. Keep your projects moving."
        }
        action={
          <button className="btn btn-primary" onClick={() => props.onCreate()}>
            <Plus size={16} />
            Create task
          </button>
        }
      />
      <div className="task-view-toolbar">
        <div className="view-tabs">
          <button
            className={view === "board" ? "selected" : ""}
            onClick={() => setView("board")}
          >
            <Columns3 size={15} />
            Board
          </button>
          <button
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
          >
            <List size={15} />
            List
          </button>
          <button
            className={view === "timeline" ? "selected" : ""}
            onClick={() => setView("timeline")}
          >
            <CalendarDays size={15} />
            Timeline
          </button>
        </div>
        <span className="result-count">{tasks.length} tasks</span>
        <button
          className="btn btn-subtle"
          onClick={() => setSavingView((p) => !p)}
        >
          <Bookmark size={14} />
          Save view
        </button>
      </div>
      <div className="filters">
        <label className="filter-search">
          <Search size={15} />
          <input
            placeholder="Filter tasks…"
            aria-label="Filter tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Project filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {w.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!mine && (
          <select
            aria-label="Assignee filter"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">All people</option>
            {w.people
              .filter((p) => !p.inactive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        )}
        <select
          aria-label="Priority filter"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">All priorities</option>
          {priorities.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="Status filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {(query || assignee || priority || status || projectFilter) && (
          <button className="text-button" onClick={clear}>
            <X size={13} />
            Clear
          </button>
        )}
      </div>
      {savingView && (
        <div className="save-view-bar">
          <Bookmark size={15} />
          <input
            autoFocus
            className="field"
            placeholder="Name this filtered view"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveView();
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => saveView().catch(() => {})}
          >
            Save
          </button>
          <button className="btn-icon" onClick={() => setSavingView(false)}>
            <X size={16} />
          </button>
        </div>
      )}
      {w.savedViews.length > 0 && (
        <div className="saved-views">
          <span>Saved views</span>
          {w.savedViews.map((v) => (
            <span key={v.id} className="saved-view-chip">
              <button
                onClick={() => {
                  setQuery(v.query);
                  setAssignee(v.assignee);
                  setPriority(v.priority);
                  setStatus(v.status);
                  setProjectFilter(v.project);
                }}
              >
                {v.name}
              </button>
              <button
                title={"Delete view " + v.name}
                onClick={() =>
                  mutate({
                    action: "delete",
                    entity: "savedViews",
                    id: v.id,
                  }).catch(() => {})
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {view === "board" && (
        <div className="kanban-board">
          {statuses.map((s) => {
            const items = tasks.filter((t) => t.status === s.id);
            return (
              <section
                className={
                  "kanban-column " + (dragOver === s.id ? "drag-over" : "")
                }
                key={s.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s.id);
                }}
                onDragLeave={() => setDragOver("")}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  if (id)
                    mutate({
                      action: "upsert",
                      entity: "tasks",
                      item: { id, status: s.id },
                    })
                      .then(() => notify("Task moved to " + s.label))
                      .catch(() => {});
                  setDragging("");
                  setDragOver("");
                }}
              >
                <header>
                  <span
                    className="column-dot"
                    style={{ background: s.color }}
                  />
                  <h2>{s.label}</h2>
                  <span>{items.length}</span>
                  <button
                    aria-label={"Create task in " + s.label}
                    onClick={() => props.onCreate(s.id)}
                  >
                    <Plus size={15} />
                  </button>
                </header>
                <div className="kanban-cards">
                  {items.map((t) => (
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        setDragging(t.id);
                      }}
                      onDragEnd={() => {
                        setDragging("");
                        setDragOver("");
                      }}
                      className={
                        "task-card " + (dragging === t.id ? "dragging" : "")
                      }
                      key={t.id}
                      onClick={() => openTask(t.id)}
                    >
                      <div className="task-card-top">
                        <span className="task-key">
                          {t.type === "bug" ? (
                            <Bug size={12} />
                          ) : t.type === "epic" ? (
                            <Zap size={12} />
                          ) : (
                            <CheckSquare size={12} />
                          )}{" "}
                          {t.key}
                        </span>
                        <PriorityMark value={t.priority} />
                      </div>
                      <h3>{t.title}</h3>
                      {t.tags.length > 0 && (
                        <div className="task-tags">
                          {t.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className={
                                "tag tag-" +
                                tag.replace(/[^a-z]/gi, "").toLowerCase()
                              }
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="task-card-bottom">
                        <span
                          className={
                            "due-date " +
                            (t.dueDate &&
                            t.dueDate < today() &&
                            t.status !== "done"
                              ? "overdue"
                              : "")
                          }
                        >
                          {t.dueDate && (
                            <>
                              <CalendarDays size={11} />
                              {dateLabel(t.dueDate)}
                            </>
                          )}
                          {t.subtasks.length > 0 && (
                            <span className="subtask-count">
                              <CheckSquare size={11} />
                              {t.subtasks.filter((x) => x.done).length}/
                              {t.subtasks.length}
                            </span>
                          )}
                          {t.blockedBy.some(
                            (id) =>
                              w.tasks.find((x) => x.id === id)?.status !==
                              "done",
                          ) && <Link2 size={12} />}
                        </span>
                        <span className="card-estimate">
                          {t.estimate > 0 && <small>{t.estimate}pt</small>}
                          <Avatar
                            person={w.people.find((p) => p.id === t.assigneeId)}
                            small
                          />
                        </span>
                      </div>
                    </button>
                  ))}
                  {!items.length && (
                    <div className="column-empty">
                      <CircleDashed size={20} />
                      <span>Room for your next step</span>
                    </div>
                  )}
                </div>
                <button
                  className="add-to-column"
                  onClick={() => props.onCreate(s.id)}
                >
                  <Plus size={14} />
                  Add task
                </button>
              </section>
            );
          })}
        </div>
      )}
      {view === "list" && (
        <section className="panel">
          <TaskTable {...props} tasks={tasks} />
          {!tasks.length && (
            <Empty
              title="No tasks match"
              text="Adjust your filters or create a new task."
              action={
                <button className="btn" onClick={clear}>
                  Clear filters
                </button>
              }
            />
          )}
        </section>
      )}
      {view === "timeline" && (
        <Timeline workspace={w} tasks={tasks} openTask={openTask} />
      )}
    </div>
  );
}
function Timeline({
  workspace: w,
  tasks,
  openTask,
}: {
  workspace: Workspace;
  tasks: Task[];
  openTask: (id: string) => void;
}) {
  const dated = tasks
    .filter((t) => t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const anchor = new Date(today() + "T12:00:00");
  anchor.setDate(anchor.getDate() - 3);
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + i);
    return d;
  });
  return (
    <section className="panel timeline-panel">
      <div className="timeline-scroll">
        <div className="timeline-header">
          <span>Scheduled work</span>
          <div>
            {days.map((d) => (
              <span
                key={d.toISOString()}
                className={
                  d.toDateString() === new Date().toDateString()
                    ? "is-today"
                    : ""
                }
              >
                <small>
                  {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                </small>
                {d.getDate()}
              </span>
            ))}
          </div>
        </div>
        {dated.map((t) => {
          const end = Math.round(
              (new Date(t.dueDate + "T12:00:00").getTime() - anchor.getTime()) /
                86400000,
            ),
            start = Math.max(0, end - Math.max(1, t.estimate || 2) + 1);
          return (
            <div key={t.id} className="timeline-row">
              <button onClick={() => openTask(t.id)}>
                <StatusIcon status={t.status} />
                <span>{t.title}</span>
              </button>
              <div className="timeline-track">
                {Array.from({ length: 28 }, (_, i) => (
                  <i key={i} />
                ))}
                {end >= 0 && start < 28 && (
                  <button
                    title={`${t.title} · due ${dateLabel(t.dueDate)}`}
                    onClick={() => openTask(t.id)}
                    className="timeline-bar"
                    style={{
                      left: `${(start / 28) * 100}%`,
                      width: `${(Math.max(1, Math.min(28, end + 1) - start) / 28) * 100}%`,
                      background:
                        (w.projects.find((p) => p.id === t.projectId)?.color ||
                          "#a192fc") + "45",
                      borderColor:
                        w.projects.find((p) => p.id === t.projectId)?.color ||
                        "#a192fc",
                    }}
                  >
                    {t.key}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="timeline-foot">
        Planning window: {dateLabel(days[0].toISOString().slice(0, 10))} –{" "}
        {dateLabel(days[27].toISOString().slice(0, 10))}. Bars show an
        approximate working span using effort points; set due dates in task
        details.{" "}
        {tasks.length - dated.length > 0 &&
          `${tasks.length - dated.length} tasks are unscheduled.`}
      </p>
    </section>
  );
}
function ProjectCard({
  project: p,
  workspace: w,
  onOpen,
  onEdit,
}: {
  project: Project;
  workspace: Workspace;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const tasks = w.tasks.filter((t) => t.projectId === p.id),
    done = tasks.filter((t) => t.status === "done").length,
    percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <article className="panel project-card">
      <div className="project-card-top">
        <span
          className="project-summary-icon"
          style={{ background: p.color + "20", color: p.color }}
        >
          <FolderKanban size={23} />
        </span>
        <span className="badge">{p.status}</span>
        <button className="btn-icon" title={"Edit " + p.name} onClick={onEdit}>
          <MoreHorizontal size={18} />
        </button>
      </div>
      <button className="project-title" onClick={onOpen}>
        <h2>{p.name}</h2>
        <ArrowUpRight size={18} />
      </button>
      <p>{p.description}</p>
      <div className="project-goal">
        <Target size={15} />
        {p.goal || "Set your next milestone"}
      </div>
      <div className="progress-label">
        <span>
          {done}/{tasks.length} tasks complete
        </span>
        <strong>{percent}%</strong>
      </div>
      <div className="mini-progress">
        <span style={{ width: percent + "%", background: p.color }} />
      </div>
      <footer>
        <span>
          <CalendarDays size={13} />
          {p.targetDate
            ? "Target " + dateLabel(p.targetDate)
            : "No target date"}
        </span>
        <span className="avatar-stack">
          {w.people
            .filter((person) => tasks.some((t) => t.assigneeId === person.id))
            .slice(0, 4)
            .map((person) => (
              <Avatar small key={person.id} person={person} />
            ))}
        </span>
      </footer>
    </article>
  );
}
function SettingsView(
  props: FeatureProps & {
    onPerson: (person: Person | "new") => void;
    prefs: WorkspacePreferences;
    savePrefs: (p: WorkspacePreferences) => void;
    page: Page;
    onShortcuts: () => void;
  },
) {
  const { workspace: w, mutate, notify, prefs, savePrefs } = props;
  const [name, setName] = useState(w.name),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const nameBaseline = useRef(w.name);
  const [renaming, setRenaming] = useState(false);
  function exportData() {
    const blob = new Blob([JSON.stringify(w, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "projectanvil-" + today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify("Workspace exported");
  }
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="Workspace settings"
        description="Your workspace, your way of working."
      />
      <section className="panel settings-section">
        <h2>Workspace</h2>
        <p>
          Your projects, knowledge, tasks, and uploaded files are stored on this
          PC.
        </p>
        <label className="form-label">
          Workspace name
          <div className="settings-inline">
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={renaming || !name.trim()}
              onClick={async () => {
                if (renaming) return;
                setRenaming(true);
                setError("");
                try {
                  const saved = await mutate({
                    action: "rename",
                    name: name.trim(),
                    base: { name: nameBaseline.current },
                  });
                  nameBaseline.current = saved.name;
                  setName(saved.name);
                  notify("Workspace renamed");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "The workspace could not be renamed.",
                  );
                } finally {
                  setRenaming(false);
                }
              }}
            >
              Save name
            </button>
          </div>
        </label>
        <div className="settings-stats">
          {w.projects.length} projects<span>·</span>
          {w.tasks.length} tasks<span>·</span>
          {w.notes.length} notes<span>·</span>
          {w.media.length} attachments
        </div>
      </section>
      <section className="panel settings-section appearance-section">
        <h2>Appearance</h2>
        <p>
          Choose a look for your workspace. Your choice is saved on this device.
        </p>
        <AppearancePicker />
      </section>
      <section className="panel settings-section">
        <h2>Your preferences</h2>
        <p>These preferences are saved on this device.</p>
        <label className="setting-toggle">
          <span>
            <strong>Compact workspace</strong>
            <small>Reduce spacing to see more work at once.</small>
          </span>
          <input
            type="checkbox"
            checked={prefs.compact}
            onChange={(e) => savePrefs({ ...prefs, compact: e.target.checked })}
          />
        </label>
        <label className="setting-toggle">
          <span>
            <strong>New task keyboard shortcut</strong>
            <small>A single letter, active when you’re not typing.</small>
          </span>
          <input
            className="field shortcut-field"
            value={prefs.taskShortcut}
            maxLength={1}
            onChange={(e) => {
              const k = e.target.value.toLowerCase().replace(/[^a-z]/g, "");
              if (k) savePrefs({ ...prefs, taskShortcut: k });
            }}
          />
        </label>
        <label className="setting-toggle">
          <span>
            <strong>Open this view on startup</strong>
            <small>Save a default workspace layout.</small>
          </span>
          <select
            className="field"
            value={prefs.savedPage}
            onChange={(e) =>
              savePrefs(
                parseWorkspacePreferences({
                  ...prefs,
                  savedPage: e.target.value,
                }),
              )
            }
          >
            {nav.map((n) => (
              <option value={n.id} key={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={props.onShortcuts}>
          <Command size={15} />
          See keyboard shortcuts
        </button>
      </section>
      <section className="panel settings-section">
        <h2>Your data stays portable</h2>
        <p>
          Export workspace records as JSON, including notes, tasks, discussions,
          relationships, and canvas layouts. Archived note history, personal
          work rooms, accounts, and attachment files require a complete local
          backup. Importing resets relationship review markers against the
          imported content.
        </p>
        <div className="settings-data-actions">
          <button className="btn" onClick={exportData}>
            <Download size={15} />
            Export workspace
          </button>
          <button
            className="btn"
            disabled={importing}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload size={15} />
            {importing ? "Importing…" : "Import workspace"}
          </button>
          <input
            type="file"
            accept="application/json,.json"
            hidden
            ref={uploadRef}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (
                !window.confirm(
                  "Replace current workspace records with this export? Download a backup first.",
                )
              ) {
                e.target.value = "";
                return;
              }
              setImporting(true);
              setError("");
              try {
                const imported = JSON.parse(await file.text());
                await mutate({
                  action: "import",
                  workspace: { ...imported, revision: w.revision },
                });
                notify("Workspace imported");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setImporting(false);
                e.target.value = "";
              }
            }}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
      <StorageHealth />
      <section className="panel settings-section">
        <h2>Assignment labels</h2>
        <p>
          Optional labels for planning. To give someone access, invite their
          registered username through Teams &amp; people.
        </p>
        <div className="settings-data-actions">
          <button className="btn" onClick={() => props.onPerson("new")}>
            <Plus size={15} />
            Add assignment label
          </button>
          {w.people
            .filter((p) => !p.userId)
            .map((p) => (
              <button
                className="btn"
                key={p.id}
                onClick={() => props.onPerson(p)}
              >
                {p.name}
              </button>
            ))}
        </div>
      </section>
      <section className="panel settings-section">
        <h2>Local access</h2>
        <p>
          ProjectAnvil runs on this PC at http://127.0.0.1:5173. Other devices
          cannot open this local address. Accounts have private personal
          workspaces. Team workspaces share their projects, tasks, notes, and
          files with accepted members. Assignment labels do not grant access.
        </p>
        <div className="info-note">
          <Network size={17} />
          <p>
            Changes are saved on this PC and refreshed across open tabs about
            every 10 seconds. Keep the ProjectAnvil console window open while
            using the app.
          </p>
        </div>
      </section>
    </div>
  );
}
