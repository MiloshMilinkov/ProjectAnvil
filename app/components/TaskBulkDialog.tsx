"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Check, ListChecks, RefreshCw, Search, Square, X } from "lucide-react";
import {
  priorities,
  statuses,
  type FeatureProps,
  type Mutation,
  type Task,
} from "../lib/types";
import {
  buildBulkMutations,
  runBulkMutations,
  supersedeBulkFailures,
  type BulkResult,
} from "../lib/bulk-tasks";
import {
  bulkFormPatch,
  emptyBulkForm,
  parseBulkDraft,
  type BulkForm,
} from "../lib/bulk-drafts";
import {
  readDraft,
  removeDraft,
  writeDraft,
  type DraftRecord,
} from "../lib/draft-store";
import { useDraftGuard, useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";
import "./planning-actions.css";

export default function TaskBulkDialog({
  tasks,
  workspace,
  mutate,
  notify,
  onClose,
  openTask,
}: Pick<FeatureProps, "workspace" | "mutate" | "notify" | "openTask"> & {
  tasks: Task[];
  onClose: () => void;
}) {
  const scope = useDraftScope();
  const [initial] = useState(() => {
    const record = readDraft(scope, "task-bulk", "form");
    return { record, value: parseBulkDraft(record?.value) };
  });
  const [baselines, setBaselines] = useState(() => structuredClone(tasks));
  const available = useMemo(
    () => new Map(baselines.map((task) => [task.id, task])),
    [baselines],
  );
  const [form, setForm] = useState<BulkForm>(
    initial.value?.form || { ...emptyBulkForm },
  );
  const [selected, setSelected] = useState<string[]>(
    initial.value?.ids.filter((id) => available.has(id)) || [],
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const initialPlan = (initial.value?.pending || []).filter((mutation) =>
    available.has(String(mutation.item?.id)),
  );
  const [results, setResults] = useState<BulkResult[]>(() =>
    initial.value?.replacing
      ? []
      : initialPlan.map((mutation) => ({
          id: String(mutation.item?.id),
          status: "not-run",
        })),
  );
  const [replacing, setReplacing] = useState(!!initial.value?.replacing);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [recovered, setRecovered] = useState(!!initial.value);
  const busy = useRef(false);
  const stop = useRef(false);
  const dirty = useRef(!!initial.value);
  const storageError = useRef(false);
  const token = useRef(initial.record?.token);
  const plan = useRef<Mutation[]>(initialPlan);
  const capturedFailures = useRef<DraftRecord<Mutation>[]>(
    initialPlan.flatMap((mutation) => {
      const record = readDraft<Mutation>(
        scope,
        "mutations",
        mutation.operationId!,
      );
      return record ? [record] : [];
    }),
  );
  const dialog = useRef<HTMLElement>(null);
  const resultHeading = useRef<HTMLDivElement>(null);
  const errorRegion = useRef<HTMLParagraphElement>(null);
  const focusResults = useRef(false);
  useEffect(() => {
    if (pending || !focusResults.current) return;
    (error ? errorRegion.current : resultHeading.current)?.focus();
    focusResults.current = false;
  }, [pending, results, error]);
  const id = useId();
  useDialog(dialog, onClose, pending);
  useDraftGuard(scope, "task-bulk", {
    hasUnsaved: () => busy.current || dirty.current,
    hasUnpersisted: () => storageError.current,
    flush: async () => !busy.current && !storageError.current,
  });
  const shown = baselines.filter((task) =>
    `${task.key} ${task.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedSet = new Set(selected);
  const picked = baselines.filter((task) => selectedSet.has(task.id));
  const projects = new Set(picked.map((task) => task.projectId));
  const targetProject = form.project.startsWith("set:")
    ? form.project.slice(4)
    : projects.size === 1
      ? [...projects][0]
      : undefined;
  const milestones =
    workspace.projects
      .find((project) => project.id === targetProject)
      ?.milestones?.filter((milestone) => !milestone.archived) || [];
  const changed = Object.keys(bulkFormPatch(form)).length;
  const completed = results.filter((result) => result.status === "saved");
  const remaining = results.filter((result) => result.status !== "saved");

  function persist(nextForm: BulkForm, ids: string[], replace = replacing) {
    dirty.current = true;
    const result = writeDraft(
      scope,
      "task-bulk",
      "form",
      { form: nextForm, ids, pending: plan.current, replacing: replace },
      null,
    );
    token.current = result.record.token;
    storageError.current = !!result.error;
    setDraftError(result.error || "");
  }
  function change(patch: Partial<BulkForm>) {
    if (busy.current) return;
    const next = { ...form, ...patch };
    if (patch.project !== undefined) next.milestone = "keep";
    const replace = replacing || plan.current.length > 0;
    setReplacing(replace);
    setResults([]);
    setForm(next);
    persist(next, selected, replace);
  }
  function select(ids: string[]) {
    if (busy.current) return;
    if (ids.length > 100) {
      setError(
        "A batch can contain up to 100 tasks. Narrow the selection first.",
      );
      return;
    }
    const replace = replacing || plan.current.length > 0;
    setReplacing(replace);
    setSelected(ids);
    setResults([]);
    setError("");
    persist(form, ids, replace);
  }
  async function apply(retry = false, event?: FormEvent) {
    event?.preventDefault();
    if (busy.current) return;
    setError("");
    try {
      if (!retry) {
        if (
          form.milestone.startsWith("set:") &&
          form.milestone !== "set:" &&
          !targetProject
        )
          throw new Error(
            "Choose a project before assigning a milestone to tasks from different projects.",
          );
        const next = buildBulkMutations(picked, bulkFormPatch(form), scope);
        if (replacing) {
          persist(form, selected, true);
          if (storageError.current)
            throw new Error(
              "Your new choices could not be kept in recovery. The previous queued changes are still kept; free some browser storage and try again.",
            );
        }
        const retirementError = supersedeBulkFailures(
          scope,
          capturedFailures.current,
          new Set(next.map((mutation) => mutation.operationId!)),
        );
        if (retirementError) throw new Error(retirementError);
        plan.current = next;
        capturedFailures.current = [];
        setReplacing(false);
        persist(form, selected, false);
        if (storageError.current)
          throw new Error(
            "The batch could not be kept in browser recovery. Free some browser storage before applying it.",
          );
      }
      const savedIds = new Set(
        retry ? completed.map((result) => result.id) : [],
      );
      const inputs = plan.current.filter(
        (mutation) => !savedIds.has(String(mutation.item?.id)),
      );
      const previous = retry ? completed : [];
      setResults(previous);
      busy.current = true;
      stop.current = false;
      setPending(true);
      const received: BulkResult[] = [];
      let acknowledged = workspace;
      const saved = await runBulkMutations(
        inputs,
        async (mutation) => {
          const updated = await mutate(mutation);
          acknowledged = updated;
          return updated;
        },
        (result) => {
          received.push(result);
          setResults([...previous, ...received]);
        },
        () => !stop.current,
      );
      const all = [...previous, ...saved];
      const acknowledgedIds = new Set(
        all
          .filter((result) => result.status === "saved")
          .map((result) => result.id),
      );
      const acknowledgedTasks = new Map(
        acknowledged.tasks.map((task) => [task.id, task]),
      );
      setBaselines((previous) =>
        previous.map((task) =>
          acknowledgedIds.has(task.id)
            ? acknowledgedTasks.get(task.id) || task
            : task,
        ),
      );
      const failedIds = all
        .filter((result) => result.status !== "saved")
        .map((result) => result.id);
      const needsAttention = new Set(failedIds);
      plan.current = plan.current.filter((mutation) =>
        needsAttention.has(String(mutation.item?.id)),
      );
      capturedFailures.current = plan.current.flatMap((mutation) => {
        const record = readDraft<Mutation>(
          scope,
          "mutations",
          mutation.operationId!,
        );
        return record ? [record] : [];
      });
      setSelected(failedIds);
      if (failedIds.length) persist(form, failedIds, false);
      else {
        removeDraft(scope, "task-bulk", "form", token.current);
        dirty.current = false;
        storageError.current = false;
        setDraftError("");
        setRecovered(false);
      }
      const count = all.filter((result) => result.status === "saved").length;
      notify(
        `${count} ${count === 1 ? "task" : "tasks"} updated${failedIds.length ? `; ${failedIds.length} ${failedIds.length === 1 ? "needs" : "need"} attention` : ""}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The batch could not be started.",
      );
    } finally {
      busy.current = false;
      focusResults.current = true;
      setPending(false);
    }
  }
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        ref={dialog}
        className="planning-action-dialog bulk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        aria-busy={pending}
      >
        <header className="dialog-heading">
          <h2 id={`${id}-title`}>
            <ListChecks size={21} />
            Bulk edit tasks
          </h2>
          <button
            className="btn-icon"
            aria-label="Close bulk editor"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p className="muted" id={`${id}-description`}>
          Select up to 100 tasks from this view. Only selected fields change.
          Tasks save individually; review any conflicts or failed changes below.
        </p>
        {recovered && (
          <p className="bulk-recovery" role="status">
            Your previous selection and changes have been restored for tasks in
            this view.
          </p>
        )}
        {replacing && (
          <p className="bulk-recovery" role="status">
            Apply changes replaces pending changes in this batch with your new
            choices. The previous changes remain in recovery copies.
          </p>
        )}
        {(error || draftError) && (
          <p
            ref={errorRegion}
            tabIndex={-1}
            className="form-error"
            role="alert"
          >
            {error || draftError}
          </p>
        )}
        <div className="bulk-layout">
          <section className="bulk-selection" aria-label="Choose tasks">
            <h3>
              1. Choose tasks <small>{selected.length} selected</small>
            </h3>
            <label className="bulk-search">
              <Search size={16} />
              <input
                className="field"
                aria-label="Search tasks in bulk editor"
                placeholder="Find a task…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={pending}
              />
            </label>
            <div className="bulk-selection-actions">
              <button
                className="btn"
                disabled={pending || !shown.length || shown.length > 100}
                onClick={() => select(shown.map((task) => task.id))}
              >
                <Check size={15} />
                Select all shown ({shown.length})
              </button>
              <button
                className="btn"
                disabled={pending || !selected.length}
                onClick={() => select([])}
              >
                <Square size={15} />
                Clear
              </button>
            </div>
            <div className="bulk-task-list">
              {shown.map((task) => (
                <label className="bulk-task-pick" key={task.id}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(task.id)}
                    disabled={pending}
                    onChange={(event) =>
                      select(
                        event.target.checked
                          ? [...selected, task.id]
                          : selected.filter((value) => value !== task.id),
                      )
                    }
                  />
                  <span>
                    <small>{task.key}</small>
                    <strong>{task.title}</strong>
                  </span>
                </label>
              ))}
              {!shown.length && (
                <p className="muted">No tasks match this search.</p>
              )}
            </div>
            {shown.length > 100 && (
              <p className="muted">
              Search or use task filters to narrow the batch to 100
                tasks.
              </p>
            )}
          </section>
          <form
            className="bulk-fields"
            id={`${id}-form`}
            onSubmit={(event) => void apply(false, event)}
          >
            <h3>2. Choose changes</h3>
            <fieldset disabled={pending}>
              <label className="form-label">
                Status
                <select
                  className="field"
                  value={form.status}
                  onChange={(event) =>
                    change({ status: event.target.value as BulkForm["status"] })
                  }
                >
                  <option value="">Keep existing</option>
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Priority
                <select
                  className="field"
                  value={form.priority}
                  onChange={(event) =>
                    change({
                      priority: event.target.value as BulkForm["priority"],
                    })
                  }
                >
                  <option value="">Keep existing</option>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Assignee
                <select
                  className="field"
                  value={form.assignee}
                  onChange={(event) => change({ assignee: event.target.value })}
                >
                  <option value="keep">Keep existing</option>
                  <option value="set:">Unassigned</option>
                  {workspace.people
                    .filter((person) => !person.inactive)
                    .map((person) => (
                      <option key={person.id} value={`set:${person.id}`}>
                        {person.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="form-label">
                Project
                <select
                  className="field"
                  value={form.project}
                  onChange={(event) => change({ project: event.target.value })}
                >
                  <option value="keep">Keep existing</option>
                  <option value="set:">No project</option>
                  {workspace.projects.map((project) => (
                    <option key={project.id} value={`set:${project.id}`}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Milestone
                <select
                  className="field"
                  value={form.milestone}
                  onChange={(event) =>
                    change({ milestone: event.target.value })
                  }
                >
                  <option value="keep">Keep existing</option>
                  <option value="set:">Clear (inherit from parent)</option>
                  {milestones.map((milestone) => (
                    <option key={milestone.id} value={`set:${milestone.id}`}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bulk-date-toggle">
                <input
                  type="checkbox"
                  checked={form.changeStart}
                  onChange={(event) =>
                    change({ changeStart: event.target.checked })
                  }
                />
                Change planned start
              </label>
              {form.changeStart && (
                <label className="form-label">
                  Planned start date
                  <input
                    className="field"
                    type="date"
                    value={form.startDate}
                    max={form.changeDue ? form.dueDate || undefined : undefined}
                    onChange={(event) =>
                      change({ startDate: event.target.value })
                    }
                  />
                  <small>Leave blank to clear.</small>
                </label>
              )}
              <label className="bulk-date-toggle">
                <input
                  type="checkbox"
                  checked={form.changeDue}
                  onChange={(event) =>
                    change({ changeDue: event.target.checked })
                  }
                />
                Change due date
              </label>
              {form.changeDue && (
                <label className="form-label">
                  Due date
                  <input
                    className="field"
                    type="date"
                    value={form.dueDate}
                    min={
                      form.changeStart ? form.startDate || undefined : undefined
                    }
                    onChange={(event) =>
                      change({ dueDate: event.target.value })
                    }
                  />
                  <small>Leave blank to clear.</small>
                </label>
              )}
            </fieldset>
            <p className="muted">
              Moving a task to another project clears its parent and milestone.
              Selected children are processed before parents. Completion can
              also create the next recurring task.
            </p>
          </form>
        </div>
        {results.length > 0 && (
          <div
            className="bulk-results"
            ref={resultHeading}
            tabIndex={-1}
            role="status"
          >
            <strong>
              {completed.length} saved ·{" "}
              {results.filter((result) => result.status === "failed").length}{" "}
              failed ·{" "}
              {results.filter((result) => result.status === "not-run").length}{" "}
              not processed{pending ? " · Saving…" : ""}
            </strong>
            {remaining.map((result) => (
              <div className="bulk-result-row" key={result.id}>
                <span>
                  <strong>
                    {available.get(result.id)?.key}{" "}
                    {available.get(result.id)?.title || "Unavailable task"}
                  </strong>
                  <p>
                    {result.status === "not-run"
                      ? "Not processed. Retry when ready."
                      : result.error}
                  </p>
                </span>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => {
                    onClose();
                    openTask(result.id);
                  }}
                >
                  Review task
                </button>
              </div>
            ))}
          </div>
        )}
        <footer className="planning-action-footer">
          <span>
            {selected.length} selected · {changed} fields chosen
          </span>
          {pending ? (
            <button
              className="btn"
              onClick={() => {
                stop.current = true;
                setError(
                  "Stopping after the current task finishes. Remaining tasks will be kept for retry.",
                );
              }}
            >
              Stop after current task
            </button>
          ) : (
            <>
              {remaining.length > 0 && (
                <button className="btn" onClick={() => void apply(true)}>
                  <RefreshCw size={15} />
                  Retry remaining
                </button>
              )}
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                form={`${id}-form`}
                disabled={!selected.length || !changed}
              >
                Apply changes
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
