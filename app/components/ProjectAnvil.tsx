"use client";
import {
  Anvil,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Command,
  FolderKanban,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { readBrowserPreference } from "../lib/browser-preferences";
import {
  flushDraftGuards,
  hasUnpersistedDrafts,
  listDrafts,
  subscribeDrafts,
} from "../lib/draft-store";
import { instantiateTaskTemplate } from "../lib/personal-templates";
import {
  FeatureProps,
  Person,
  Project,
  Status,
  Task,
  type Notify,
} from "../lib/types";
import {
  defaultPreferences,
  parseWorkspacePreferences,
  type WorkspacePreferences,
} from "../lib/workspace-preferences";
import { AccountMenu, TeamManager, WorkspaceSwitcher } from "./AccountControls";
import ActivityCenter from "./ActivityCenter";
import Brainstorming from "./Brainstorming";
import Collections from "./Collections";
import GuidedTour from "./GuidedTour";
import Knowledge from "./Knowledge";
import NotificationCenter from "./NotificationCenter";
import { OfflineMediaProvider } from "./OfflineMediaProvider";
import PendingChanges from "./PendingChanges";
import PersonDialog from "./PersonDialog";
import ProjectDialog from "./ProjectDialog";
import ProjectHome from "./ProjectHome";
import RemindersCenter from "./RemindersCenter";
import TaskDialog from "./TaskDialog";
import TaskReadOnlyDialog from "./TaskReadOnlyDialog";
import { AppearanceMenu } from "./ThemeControls";
import TrashDialog from "./TrashDialog";
import { CanvasView } from "./visuals/CanvasView";
import { GraphView } from "./visuals/GraphView";
import WorkRooms, { WorkRoomShelf } from "./WorkRooms";
import { useWorkspacePermissions } from "./WorkspacePermissions";
import { StatusIcon } from "./WorkspacePrimitives";
import { useWorkspaceScope } from "./WorkspaceScope";
import "./guest.css";
import "./task-scheduling.css";
import { useDialog } from "./useDialog";
import { useMediaQuery } from "./useMediaQuery";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkRoomNavigation } from "./useWorkRoomNavigation";
import { useWorkspaceData } from "./useWorkspaceData";
import "./workspace-shell.css";

import PageHeader from "./PageHeader";
import ProjectCard from "./dashboard/ProjectCard";
import WorkspaceOverview from "./dashboard/WorkspaceOverview";
import WorkspaceSettings from "./settings/WorkspaceSettings";
import {
  workspaceNavigation as nav,
  type WorkspacePage,
} from "./shell/navigation";
import TaskWorkspace from "./tasks/TaskWorkspace";

type Page = WorkspacePage;
export default function ProjectAnvil() {
  const phoneLayout = useMediaQuery("(max-width: 760px)");
  const navigationButton = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const { account, activeId, onSwitch, onAuthChanged, onChanged } =
    useWorkspaceScope();
  const data = useWorkspaceData();
  const {
    workspace,
    load,
    loadError,
    liveStatus,
    mutate,
    pending,
    syncError,
    outboxSize,
    retrySaves,
    restoreWarnings,
    clearRestoreWarnings,
  } = data;
  const permissions = useWorkspacePermissions(workspace || undefined);
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
  );
  const [mobile, setMobile] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [selectedNote, setSelectedNote] = useState(startup.note);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [taskSeed, setTaskSeed] = useState<Task | undefined>();
  const [newTaskStatus, setNewTaskStatus] = useState<Status>("todo");
  const [newProject, setNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectHomeId, setProjectHomeId] = useState("");
  const [personModal, setPersonModal] = useState<Person | "new" | null>(null);
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    undoId?: string;
  } | null>(null);
  const [focus, setFocus] = useState(startup.focus);
  const [shortcuts, setShortcuts] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoPending, setUndoPending] = useState(false);
  const undoGuard = useRef(false);
  const toastSequence = useRef(0);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page, projectHomeId]);
  const [tourPending, setTourPending] = useState(
    () => !readBrowserPreference("projectanvil-tour-v1"),
  );
  useDialog(
    sidebarRef,
    () => setMobile(false),
    false,
    !!workspace && phoneLayout && mobile,
  );
  useDialog(paletteRef, () => setPalette(false), false, !!workspace && palette);
  useDialog(
    shortcutsRef,
    () => setShortcuts(false),
    false,
    !!workspace && shortcuts,
  );
  const currentPerson =
    workspace?.people.find(
      (person) => person.userId === account.user?.id && !!account.user,
    )?.id || "";
  const tourChecked = useRef(false);
  const tourReturnPage = useRef<Page>("overview");
  const tourReturnFocus = useRef(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify: Notify = useCallback((message, options) => {
    toastSequence.current += 1;
    setToast({ message, ...options });
    if (toastRef.current) clearTimeout(toastRef.current);
    // Keep Undo available until the next notification or explicit dismissal.
    if (!options?.undoId)
      toastRef.current = setTimeout(() => setToast(null), 4200);
  }, []);
  async function undoDelete() {
    if (!toast?.undoId || undoGuard.current) return;
    const { undoId } = toast;
    const sequence = toastSequence.current;
    undoGuard.current = true;
    setUndoPending(true);
    try {
      await mutate({ action: "restore", id: undoId });
      if (sequence === toastSequence.current) notify("Item restored");
    } catch (cause) {
      if (sequence === toastSequence.current)
        notify(
          cause instanceof Error
            ? cause.message
            : "Restore failed. You can retry in Trash.",
          { undoId },
        );
    } finally {
      undoGuard.current = false;
      setUndoPending(false);
    }
  }
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
    setTaskSeed(undefined);
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
    setTaskSeed(undefined);
  }, []);
  const openNote = useCallback(
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
  const createTask = useCallback((status?: Status) => {
    setNewTaskStatus(status || "todo");
    setNewTask(true);
    setSelectedTask(null);
  }, []);
  const captureRoomContext = rooms.captureRoomContext;
  const openProjectHome = useCallback(
    (id: string) => {
      void (async () => {
        if (!(await beforeNavigation())) return;
        setProjectHomeId(id);
        setProjectFilter(id);
        setPage("projects");
        setMobile(false);
        setSearch("");
      })();
    },
    [beforeNavigation],
  );
  const go = useCallback(
    (nextPage: Page) => {
      void (async () => {
        if (nextPage !== page && !(await beforeNavigation())) return;
        if (nextPage === "rooms") captureRoomContext();
        if (nextPage === "projects") setProjectHomeId("");
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
        <p>{loadError || data.offlineError || "Opening your workspace…"}</p>
        {loadError ? (
          <button className="btn" onClick={load}>
            <RefreshCw size={15} /> Try again
          </button>
        ) : (
          <div className="loading-line" />
        )}
      </main>
    );
  const w = workspace;
  const project = w.projects.find((p) => p.id === projectFilter);
  const featureProps: FeatureProps = {
    workspace: w,
    mutate,
    openTask,
    openNote,
    currentPerson,
    projectFilter,
    notify,
    saveTarget:
      data.offlineCopy && (data.isOffline || outboxSize > 0)
        ? "device"
        : "server",
  };
  const activeNav = nav.find((n) => n.id === page);
  return (
    <OfflineMediaProvider
      scope={draftScope}
      workspace={w}
      isOffline={data.isOffline}
    >
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
                ProjectAnvil
              </a>
              <button
                className="btn-icon sidebar-close"
                aria-label="Close navigation"
                onClick={() => setMobile(false)}
              >
                <X size={20} />
              </button>
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
              <div className="sidebar-scroll">
                <div className="nav-caption">PLAN & WORK</div>
                <nav aria-label="Main navigation">
                  {nav.slice(0, 5).map((n) => (
                    <button
                      key={n.id}
                      data-tour={"nav-" + n.id}
                      className={"nav-item " + (page === n.id ? "active" : "")}
                      aria-current={page === n.id ? "page" : undefined}
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
                      aria-current={page === n.id ? "page" : undefined}
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
                      disabled={!permissions.canCreate}
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
                        "project-nav " +
                        (projectFilter === p.id ? "selected" : "")
                      }
                      aria-pressed={projectFilter === p.id}
                      onClick={() => {
                        setProjectFilter(projectFilter === p.id ? "" : p.id);
                        go("tasks");
                      }}
                    >
                      <span
                        className="project-dot"
                        style={{ background: p.color }}
                      />
                      <span className="project-nav-name">{p.name}</span>
                      <ChevronRight size={12} />
                    </button>
                  ))}
                  {!w.projects.length && (
                    <p className="sidebar-project-hint">
                      Projects you create appear here.
                    </p>
                  )}
                </div>
              </div>
              <div className="sidebar-bottom">
                <button
                  data-tour="trash"
                  className="nav-item"
                  onClick={() => {
                    setTrashOpen(true);
                    setMobile(false);
                  }}
                >
                  <Trash2 size={17} />
                  Trash
                </button>
                <button
                  data-tour="nav-team"
                  className={"nav-item " + (page === "team" ? "active" : "")}
                  aria-current={page === "team" ? "page" : undefined}
                  onClick={() => go("team")}
                >
                  <Users size={17} />
                  Teams & people
                  <span className="nav-end">{w.people.length}</span>
                </button>
                <button
                  data-tour="nav-settings"
                  className={
                    "nav-item " + (page === "settings" ? "active" : "")
                  }
                  aria-current={page === "settings" ? "page" : undefined}
                  onClick={() => go("settings")}
                >
                  <Settings size={17} />
                  Workspace settings
                </button>
                <div className="sidebar-footer" role="status">
                  <span
                    className={
                      "connection-dot " +
                      (syncError || loadError ? "offline" : "")
                    }
                  />
                  {data.isOffline && data.offlineCopy
                    ? "Working offline"
                    : loadError
                      ? "Connection needs attention"
                      : syncError
                        ? "Save needs attention"
                        : pending
                          ? "Saving changes…"
                          : "Local workspace ready"}
                  <button
                    title="Keyboard shortcuts"
                    aria-label="Keyboard shortcuts"
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
                ref={navigationButton}
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <span>{w.name || "Workspace"}</span>
              <ChevronRight size={13} />
              <strong>
                {activeNav?.title ||
                  (page === "team" ? "Team & people" : "Settings")}
              </strong>
            </div>
            <div className="topbar-actions">
              <RemindersCenter
                workspace={w}
                currentPerson={currentPerson}
                openTask={openTask}
              />
              <NotificationCenter
                openTask={openTask}
                openNote={openNote}
                notify={notify}
                onOpenProject={openProjectHome}
              />
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
              <span
                className="live-indicator"
                data-tour="live-updates"
                title="Local connection checks for changes and reconnects automatically"
                role="status"
              >
                <span />
                {liveStatus === "live"
                  ? "Live updates"
                  : liveStatus === "connecting"
                    ? "Connecting…"
                    : "Reconnecting…"}
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
          {project &&
            [
              "overview",
              "tasks",
              "my-work",
              "notes",
              "daily",
              "graph",
              "collections",
            ].includes(page) && (
              <div
                className="project-scope"
                role="region"
                aria-label="Project filter"
              >
                <FolderKanban size={16} aria-hidden="true" />
                <span>
                  Project: <strong>{project.name}</strong>
                </span>
                <button
                  className="text-button"
                  onClick={() => setProjectFilter("")}
                >
                  <X size={14} /> Clear project filter
                </button>
              </div>
            )}
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
          {!trashOpen && restoreWarnings.length > 0 && (
            <aside className="restore-notice" role="status">
              <div>
                <strong>Restored with connections to review</strong>
                <button
                  className="btn-icon"
                  aria-label="Dismiss restore details"
                  onClick={clearRestoreWarnings}
                >
                  <X size={16} />
                </button>
              </div>
              <ul>
                {restoreWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </aside>
          )}
          {(data.isOffline || (data.offlineCopy && outboxSize > 0)) && (
            <aside
              className="offline-banner"
              role="status"
              data-tour="offline-sync"
            >
              <WifiOff size={17} />
              <span>
                <strong>
                  {data.isOffline
                    ? "Working offline."
                    : "Changes waiting to synchronize."}
                </strong>{" "}
                {data.offlineCopy
                  ? `${outboxSize} ${outboxSize === 1 ? "change" : "changes"} kept on this device. ${data.offlineConflicts.length ? "Some changes need review." : "Synchronization resumes when the local server is available."}`
                  : "Save an offline copy in Workspace settings while connected to enable editing on this device."}
              </span>
              {!!outboxSize && (
                <button
                  className="btn"
                  disabled={pending > 0}
                  onClick={() => setReviewPending(true)}
                >
                  Review changes
                </button>
              )}
            </aside>
          )}
          {loadError && !data.offlineCopy && (
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
              {recoveryCount === 1 ? "recovery copy is" : "recovery copies are"}{" "}
              available for review.
              <button onClick={() => setReviewPending(true)}>
                Review recovery copies
              </button>
            </div>
          )}
          <main
            data-tour="workspace-content"
            className={"main-content view-" + page}
          >
            {!permissions.canCreate && (
              <aside className="workspace-access-notice">
                <strong>Viewer access.</strong> You can read available work,
                follow items, and manage your notifications. Ask an owner or
                admin for editing access.
              </aside>
            )}
            {page === "overview" && (
              <WorkspaceOverview
                {...featureProps}
                onGo={go}
                onCreate={() => {
                  setNewTask(true);
                  setSelectedTask(null);
                }}
                onProject={openProjectHome}
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
              <TaskWorkspace
                {...featureProps}
                mine={page === "my-work"}
                onCreate={createTask}
                setProjectFilter={setProjectFilter}
              />
            )}
            {page === "projects" &&
            projectHomeId &&
            w.projects.some((project) => project.id === projectHomeId) ? (
              <ProjectHome
                key={projectHomeId}
                {...featureProps}
                projectId={projectHomeId}
                onBack={() => {
                  setProjectHomeId("");
                  setProjectFilter("");
                }}
                onEdit={() => {
                  setEditingProject(
                    w.projects.find(
                      (project) => project.id === projectHomeId,
                    ) || null,
                  );
                  setNewProject(true);
                }}
                onCreateTask={(projectId, milestoneId) => {
                  const seed = instantiateTaskTemplate(
                    {
                      title: "",
                      description: "",
                      type: "task",
                      priority: "medium",
                      estimate: 0,
                      tags: [],
                      subtasks: [],
                    },
                    { projectId, assigneeId: currentPerson },
                  );
                  seed.milestoneId = milestoneId || "";
                  setTaskSeed(seed);
                  setSelectedTask(null);
                  setNewTaskStatus("todo");
                  setNewTask(true);
                }}
                onOpenCanvas={(id) => void rooms.openRoomCanvas(id)}
              />
            ) : (
              page === "projects" && (
                <div className="page">
                  <PageHeader
                    eyebrow="THE BIG PICTURE"
                    title="Projects"
                    description="Organize goals, tasks, and notes around a shared outcome."
                    action={
                      <button
                        className="btn btn-primary"
                        disabled={!permissions.canCreate}
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
                        onOpen={() => openProjectHome(p.id)}
                        onEdit={() => {
                          setEditingProject(p);
                          setNewProject(true);
                        }}
                      />
                    ))}
                    <button
                      className="project-add"
                      disabled={!permissions.canCreate}
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
              )
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
            {page === "brainstorm" && <Brainstorming {...featureProps} />}
            {page === "activity" && (
              <ActivityCenter
                {...featureProps}
                onOpenProject={openProjectHome}
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
              <WorkspaceSettings
                {...featureProps}
                onPerson={setPersonModal}
                prefs={prefs}
                savePrefs={savePrefs}
                onShortcuts={() => setShortcuts(true)}
                data={data}
                onReview={() => setReviewPending(true)}
              />
            )}
          </main>
        </div>
        {selectedTask &&
          w.tasks.some((task) => task.id === selectedTask) &&
          !permissions.canEditProject(
            w.tasks.find((task) => task.id === selectedTask)!.projectId,
          ) && (
            <TaskReadOnlyDialog
              task={w.tasks.find((task) => task.id === selectedTask)!}
              workspace={w}
              openTask={openTask}
              openNote={openNote}
              notify={notify}
              onClose={() => setSelectedTask(null)}
            />
          )}
        {((newTask && permissions.canCreate) ||
          (selectedTask &&
            w.tasks.some(
              (task) =>
                task.id === selectedTask &&
                permissions.canEditProject(task.projectId),
            ))) && (
          <TaskDialog
            key={selectedTask || taskSeed?.id || "new-task"}
            workspace={{
              ...w,
              projects: w.projects.filter((project) =>
                permissions.canEditProject(project.id),
              ),
            }}
            task={w.tasks.find((t) => t.id === selectedTask)}
            initialTask={taskSeed}
            onDuplicate={(copy) => {
              setSelectedTask(null);
              setTaskSeed(copy);
              setNewTask(true);
            }}
            projectId={projectFilter}
            personId={currentPerson}
            initialStatus={newTaskStatus}
            mutate={mutate}
            onClose={() => {
              setSelectedTask(null);
              setNewTask(false);
              setTaskSeed(undefined);
            }}
            openNote={openNote}
            openTask={openTask}
            notify={notify}
          />
        )}
        {newProject &&
          permissions.canCreate &&
          (!editingProject ||
            permissions.canEditProject(editingProject.id)) && (
            <ProjectDialog
              project={editingProject}
              mutate={mutate}
              onClose={() => setNewProject(false)}
              notify={notify}
            />
          )}
        {personModal && permissions.canCreate && (
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
              ref={paletteRef}
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
                  setPalette(false);
                }
              }}
            >
              <div className="palette-input">
                <Search size={20} />
                <input
                  data-initial-focus
                  aria-label="Search tasks, notes, and projects"
                  placeholder="Search tasks, notes, projects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="key-button"
                  aria-label="Close search"
                  onClick={() => setPalette(false)}
                >
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
                <span>Tab to choose · Enter to open</span>
              </footer>
            </section>
          </div>
        )}
        {shortcuts && (
          <div className="modal-shade" onClick={() => setShortcuts(false)}>
            <div
              ref={shortcutsRef}
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              className="small-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dialog-heading">
                <h2>Keyboard shortcuts</h2>
                <button
                  className="btn-icon"
                  aria-label="Close keyboard shortcuts"
                  onClick={() => setShortcuts(false)}
                >
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
                Task shortcuts are paused while typing. Change your task
                shortcut in workspace settings.
              </p>
            </div>
          </div>
        )}
        {reviewPending && (
          <PendingChanges
            workspace={w}
            busy={pending > 0}
            confirmedWorkspace={data.confirmedWorkspace}
            offline={data.isOffline}
            issues={Object.fromEntries(
              data.offlineConflicts.map((item) => [item.id, item.reason]),
            )}
            onRebase={data.rebaseQueuedChange}
            onClose={() => setReviewPending(false)}
          />
        )}
        {trashOpen && (
          <TrashDialog
            mutate={mutate}
            notify={notify}
            warnings={restoreWarnings}
            onClose={() => {
              setTrashOpen(false);
              if (phoneLayout)
                requestAnimationFrame(() => navigationButton.current?.focus());
            }}
          />
        )}
        {tourOpen && <GuidedTour onNavigate={go} onClose={closeTour} />}
        {toast && (
          <div className="toast" role="status">
            <Check size={16} />
            <span className="toast-message">{toast.message}</span>
            {toast.undoId && (
              <button
                className="toast-undo"
                disabled={undoPending}
                onClick={() => void undoDelete()}
              >
                <RotateCcw size={14} />
                {undoPending ? "Restoring…" : "Undo"}
              </button>
            )}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </OfflineMediaProvider>
  );
}
