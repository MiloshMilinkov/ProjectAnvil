"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import {
  uid,
  type FeatureProps,
  type Milestone,
  type Project,
} from "../lib/types";
import { readDraft, removeDraft, writeDraft } from "../lib/draft-store";
import { useDraftGuard, useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";
import {
  discardMilestoneDraft,
  parseMilestoneDraft,
  type MilestoneDraft,
} from "../lib/milestone-drafts";
import { recoverPendingOperation } from "../lib/editor-mutations";

export default function MilestoneEditor({
  project,
  milestone,
  mutate,
  notify,
  onClose,
}: {
  project: Project;
  milestone?: Milestone;
  mutate: FeatureProps["mutate"];
  notify: FeatureProps["notify"];
  onClose: () => void;
}) {
  const scope = useDraftScope();
  const recoveryId = `${project.id}:${milestone?.id || "new"}`;
  const [initial] = useState(() => {
    const stored = readDraft<unknown, Project>(
      scope,
      "milestone-forms",
      recoveryId,
    );
    const value = parseMilestoneDraft(stored?.value);
    const recovered =
      stored &&
      value &&
      stored.baseline?.id === project.id &&
      (stored.baseline.milestones === undefined ||
        Array.isArray(stored.baseline.milestones))
        ? stored
        : null;
    return {
      value: (recovered ? value!.milestone : null) ||
        milestone || {
          id: uid(),
          title: "",
          description: "",
          targetDate: "",
          archived: false,
        },
      baseline: recovered?.baseline || structuredClone(project),
      token: recovered?.token,
      recovered: !!recovered,
      operationIds: recovered ? value!.operationIds : [],
    };
  });
  const [draft, setDraft] = useState(initial.value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [recovered, setRecovered] = useState(initial.recovered);
  const [hasChanges, setHasChanges] = useState(initial.recovered);
  const baseline = useRef(initial.baseline);
  const token = useRef(initial.token);
  const current = useRef(initial.value);
  const operationIds = useRef(initial.operationIds);
  const dirty = useRef(initial.recovered);
  const busy = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(dialog, onClose, pending);
  useEffect(() => {
    if (!pending && error) errorRegion.current?.focus();
  }, [pending, error]);
  useDraftGuard(scope, `milestone-form:${recoveryId}`, {
    hasUnsaved: () => dirty.current,
    hasUnpersisted: () => !!storageError && dirty.current,
    flush: async () => {
      if (!dirty.current) return true;
      const result = writeDraft(
        scope,
        "milestone-forms",
        recoveryId,
        {
          milestone: current.current,
          operationIds: operationIds.current,
        } satisfies MilestoneDraft,
        baseline.current,
      );
      token.current = result.record.token;
      setStorageError(result.error || "");
      return !result.error;
    },
  });

  function change(patch: Partial<Milestone>) {
    if (busy.current) return;
    const next = { ...current.current, ...patch };
    current.current = next;
    dirty.current = true;
    setHasChanges(true);
    setDraft(next);
    const result = writeDraft(
      scope,
      "milestone-forms",
      recoveryId,
      {
        milestone: next,
        operationIds: operationIds.current,
      } satisfies MilestoneDraft,
      baseline.current,
    );
    token.current = result.record.token;
    setStorageError(result.error || "");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!draft.title.trim()) {
      setError("Give this milestone a title.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    const original = baseline.current;
    const entries = original.milestones || [];
    const exists = entries.some((item) => item.id === draft.id);
    const cleaned = {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
    };
    try {
      const mutation = recoverPendingOperation(scope, {
        action: "upsert",
        entity: "projects",
        item: {
          id: project.id,
          milestones: exists
            ? entries.map((item) => (item.id === draft.id ? cleaned : item))
            : [...entries, cleaned],
        },
        base: { ...original },
      });
      mutation.operationId ||= uid();
      if (!operationIds.current.includes(mutation.operationId))
        operationIds.current.push(mutation.operationId);
      const persisted = writeDraft(
        scope,
        "milestone-forms",
        recoveryId,
        {
          milestone: current.current,
          operationIds: operationIds.current,
        } satisfies MilestoneDraft,
        baseline.current,
      );
      token.current = persisted.record.token;
      setStorageError(persisted.error || "");
      await mutate(mutation);
      const sentToken = persisted.record.token;
      if (sentToken)
        removeDraft(scope, "milestone-forms", recoveryId, sentToken);
      dirty.current = false;
      notify(exists ? "Milestone updated" : "Milestone created");
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The milestone could not be saved. Your draft is kept.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function discard() {
    if (busy.current) return;
    discardMilestoneDraft(
      scope,
      project.id,
      recoveryId,
      operationIds.current,
      token.current,
    );
    dirty.current = false;
    onClose();
  }

  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending}
        className="project-milestone-dialog"
        onSubmit={(event) => void save(event)}
      >
        <header className="dialog-heading">
          <h2 id={titleId}>{milestone ? "Edit milestone" : "New milestone"}</h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close milestone editor"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p className="muted">
          Give this part of the project a clear outcome and optional target
          date. Progress follows its tasks.
        </p>
        {recovered && (
          <p className="project-planning-notice" role="status">
            Your unfinished milestone is recovered.{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => setRecovered(false)}
            >
              Dismiss
            </button>
          </p>
        )}
        {error && (
          <div
            ref={errorRegion}
            className="form-error"
            role="alert"
            tabIndex={-1}
          >
            {error}
            <p>
              To start from the latest project, discard this draft and reopen
              the milestone.
            </p>
          </div>
        )}
        {storageError && (
          <div className="form-error" role="alert">
            {storageError}
          </div>
        )}
        <fieldset disabled={pending}>
          <label className="form-label">
            Milestone title
            <input
              className="field"
              autoFocus
              required
              maxLength={300}
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
              placeholder="e.g. First review"
            />
          </label>
          <label className="form-label">
            Outcome <span className="editor-optional">(optional)</span>
            <textarea
              className="field"
              rows={4}
              maxLength={10000}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
              placeholder="What will be ready at this point?"
            />
          </label>
          <label className="form-label">
            Milestone target date{" "}
            <span className="editor-optional">(optional)</span>
            <input
              className="field"
              type="date"
              value={draft.targetDate}
              onChange={(event) => change({ targetDate: event.target.value })}
            />
          </label>
        </fieldset>
        <footer className="project-milestone-footer">
          {hasChanges && (
            <button
              className="btn btn-subtle"
              type="button"
              disabled={pending}
              onClick={discard}
            >
              Discard draft
            </button>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            {hasChanges ? "Keep draft" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !draft.title.trim()}
          >
            {pending ? "Saving…" : "Save milestone"}
          </button>
        </footer>
      </form>
    </div>
  );
}
