"use client";
import { Search, X } from "lucide-react";
import { dateFilterOptions, type DateFilter } from "../../lib/task-scheduling";
import { priorities, statuses, type Workspace } from "../../lib/types";

export interface TaskFilterValues {
  query: string;
  assignee: string;
  priority: string;
  status: string;
  dateFilter: DateFilter;
}
export const emptyTaskFilters: TaskFilterValues = {
  query: "",
  assignee: "",
  priority: "",
  status: "",
  dateFilter: "all",
};

interface TaskFiltersProps {
  workspace: Pick<Workspace, "projects" | "people">;
  mine: boolean;
  projectFilter: string;
  onProjectFilter: (id: string) => void;
  values: TaskFilterValues;
  onChange: (patch: Partial<TaskFilterValues>) => void;
  filtered: boolean;
  onClear: () => void;
}

export default function TaskFilters({
  workspace,
  mine,
  projectFilter,
  onProjectFilter,
  values,
  onChange,
  filtered,
  onClear,
}: TaskFiltersProps) {
  const { query, assignee, priority, status, dateFilter } = values;
  return (
    <div
      className="filters"
      data-tour="task-filters"
      role="group"
      aria-label="Task filters"
    >
      <label className="filter-search">
        <Search size={15} />
        <input
          placeholder="Filter tasks…"
          aria-label="Filter tasks"
          value={query}
          onChange={(e) => onChange({ query: e.target.value })}
        />
      </label>
      <select
        aria-label="Project filter"
        value={projectFilter}
        onChange={(e) => onProjectFilter(e.target.value)}
      >
        <option value="">All projects</option>
        {workspace.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!mine && (
        <select
          aria-label="Assignee filter"
          value={assignee}
          onChange={(e) => onChange({ assignee: e.target.value })}
        >
          <option value="">All people</option>
          {workspace.people
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
        onChange={(e) => onChange({ priority: e.target.value })}
      >
        <option value="">All priorities</option>
        {priorities.map((p) => (
          <option key={p} value={p}>
            {p[0].toUpperCase() + p.slice(1)}
          </option>
        ))}
      </select>
      <select
        aria-label="Status filter"
        value={status}
        onChange={(e) => onChange({ status: e.target.value })}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <label className="task-date-filter" data-tour="task-date-filter">
        <span>Dates</span>
        <select
          aria-label="Task date filter"
          value={dateFilter}
          onChange={(event) =>
            onChange({ dateFilter: event.target.value as DateFilter })
          }
        >
          {dateFilterOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {filtered && (
        <button className="text-button" onClick={onClear}>
          <X size={13} />
          Clear filters
        </button>
      )}
    </div>
  );
}
