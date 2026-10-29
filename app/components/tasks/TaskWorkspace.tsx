"use client";
import { CalendarDays, Columns3, List, ListChecks, Plus } from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
  matchesTaskDate,
  sortTasks,
  taskSortOptions,
  type TaskSort,
} from "../../lib/task-scheduling";
import {
  type FeatureProps,
  type Status,
  type Task,
  type TaskLayout,
} from "../../lib/types";
import PageHeader from "../PageHeader";
import SavedTaskViews from "../SavedTaskViews";
import TaskBulkDialog from "../TaskBulkDialog";
import { useCalendarToday } from "../TaskSchedule";
import TaskTimeline from "../TaskTimeline";
import { useMediaQuery } from "../useMediaQuery";
import { useWorkspacePermissions } from "../WorkspacePermissions";
import { Empty } from "../WorkspacePrimitives";
import TaskBoard from "./TaskBoard";
import TaskFilters, {
  emptyTaskFilters,
  type TaskFilterValues,
} from "./TaskFilters";
import TaskTable from "./TaskTable";

function TaskWorkspace(
  props: FeatureProps & {
    mine: boolean;
    onCreate: (status?: Status) => void;
    setProjectFilter: (id: string) => void;
  },
) {
  const {
    workspace,
    mine,
    currentPerson,
    projectFilter,
    setProjectFilter,
    openTask,
    mutate,
    notify,
  } = props;
  const phoneLayout = useMediaQuery("(max-width: 760px)");
  const referenceDate = useCalendarToday();
  const permissions = useWorkspacePermissions(workspace);
  const [filters, setFilters] = useState<TaskFilterValues>(emptyTaskFilters);
  const { query, assignee, priority, status, dateFilter } = filters;
  const [sort, setSort] = useState<TaskSort>("priority");
  const [bulkTasks, setBulkTasks] = useState<Task[] | null>(null);
  const [chosenView, setView] = useState<TaskLayout | null>(null);
  const view = chosenView ?? (phoneLayout ? "list" : "board");
  const filtered = !!(
    query ||
    (!mine && assignee) ||
    priority ||
    status ||
    projectFilter ||
    dateFilter !== "all"
  );
  const searchTerm = query.toLowerCase();
  const tasks = useMemo(
    () =>
      sortTasks(
        workspace.tasks.filter(
          (task) =>
            (!projectFilter || task.projectId === projectFilter) &&
            (!mine || task.assigneeId === currentPerson) &&
            (mine || !assignee || task.assigneeId === assignee) &&
            (!priority || task.priority === priority) &&
            (!status || task.status === status) &&
            matchesTaskDate(task, dateFilter, referenceDate) &&
            [task.title, task.description, task.key, ...task.tags]
              .join(" ")
              .toLowerCase()
              .includes(searchTerm),
        ),
        sort,
      ),
    [
      workspace.tasks,
      projectFilter,
      mine,
      currentPerson,
      assignee,
      priority,
      status,
      dateFilter,
      referenceDate,
      searchTerm,
      sort,
    ],
  );
  function clear() {
    setFilters(emptyTaskFilters);
    setProjectFilter("");
  }
  const resultScope = JSON.stringify([
    filters,
    projectFilter,
    mine,
    currentPerson,
    sort,
  ]);
  return (
    <div className="page tasks-page">
      <PageHeader
        title={mine ? "My work" : "Tasks"}
        description={
          mine
            ? currentPerson
              ? "Tasks assigned to you in this workspace."
              : "Unassigned tasks in the guest workspace."
            : "Organize tasks by status, priority, project, and person."
        }
        action={
          <button
            className="btn btn-primary"
            onClick={() => props.onCreate()}
            disabled={!permissions.canEditProject(projectFilter)}
          >
            <Plus size={16} />
            Create task
          </button>
        }
      />
      <div className="task-view-toolbar">
        <button
          className="btn btn-secondary"
          data-tour="bulk-edit"
          disabled={
            !tasks.some((task) => permissions.canEditProject(task.projectId))
          }
          onClick={() =>
            setBulkTasks(
              structuredClone(
                tasks.filter((task) =>
                  permissions.canEditProject(task.projectId),
                ),
              ),
            )
          }
        >
          <ListChecks size={16} />
          Bulk edit
        </button>
        <div
          className="view-tabs"
          role="group"
          aria-label="Task layout"
          data-tour="task-layouts"
        >
          <button
            className={view === "board" ? "selected" : ""}
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            <Columns3 size={15} />
            Board
          </button>
          <button
            className={view === "list" ? "selected" : ""}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={15} />
            List
          </button>
          <button
            className={view === "timeline" ? "selected" : ""}
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            <CalendarDays size={15} />
            Timeline
          </button>
        </div>
        <span className="result-count" role="status">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
        <label className="task-sort-control" data-tour="task-sorting">
          <span>Sort by</span>
          <select
            aria-label="Sort tasks"
            value={sort}
            onChange={(event) => setSort(event.target.value as TaskSort)}
          >
            {taskSortOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TaskFilters
        workspace={workspace}
        mine={mine}
        projectFilter={projectFilter}
        onProjectFilter={setProjectFilter}
        values={filters}
        onChange={(patch) =>
          setFilters((current) => ({ ...current, ...patch }))
        }
        filtered={filtered}
        onClear={clear}
      />
      <SavedTaskViews
        workspace={workspace}
        mutate={mutate}
        notify={notify}
        mine={mine}
        config={{
          query,
          assignee,
          priority,
          project: projectFilter,
          status,
          dateFilter,
          sort,
          layout: view,
        }}
        onApply={(config) => {
          setFilters({
            query: config.query,
            assignee: config.assignee,
            priority: config.priority,
            status: config.status,
            dateFilter: config.dateFilter || "all",
          });
          setProjectFilter(config.project);
          setSort(config.sort || "priority");
          setView(config.layout);
        }}
      />
      {view === "board" && filtered && !tasks.length && (
        <div className="task-filter-empty" role="status">
          <span>No tasks match these filters.</span>
          <button className="text-button" onClick={clear}>
            Clear filters
          </button>
        </div>
      )}
      {view === "board" && (
        <TaskBoard
          key={resultScope}
          {...props}
          tasks={tasks}
          filtered={filtered}
          referenceDate={referenceDate}
          onCreate={props.onCreate}
        />
      )}
      {view === "list" && (
        <section className="panel">
          <TaskTable
            key={resultScope}
            {...props}
            tasks={tasks}
            referenceDate={referenceDate}
          />
          {!tasks.length && (
            <Empty
              title={filtered ? "No tasks match" : "No tasks yet"}
              text={
                filtered
                  ? "Clear a filter or change your search."
                  : "Create a task to add it here."
              }
              action={
                <button
                  className="btn"
                  onClick={filtered ? clear : () => props.onCreate()}
                >
                  {filtered ? "Clear filters" : "Create task"}
                </button>
              }
            />
          )}
        </section>
      )}
      {view === "timeline" && (
        <TaskTimeline
          tasks={tasks}
          referenceDate={referenceDate}
          openTask={openTask}
        />
      )}
      {bulkTasks && (
        <TaskBulkDialog
          tasks={bulkTasks}
          workspace={workspace}
          mutate={mutate}
          notify={notify}
          onClose={() => setBulkTasks(null)}
          openTask={openTask}
        />
      )}
    </div>
  );
}

// Shell menus and global search do not change task view inputs.
export default memo(TaskWorkspace);
