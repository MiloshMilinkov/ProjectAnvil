"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Lightbulb,
  Pencil,
  Plus,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import {
  uid,
  type BrainstormBoard,
  type FeatureProps,
  type Workspace,
} from "../lib/types";
import { readDraft, removeDraft, writeDraft } from "../lib/draft-store";
import {
  discardBrainstormDraft,
  isBrainstormBoard,
  parseBrainstormDraft,
  rankedIdeas,
  type BrainstormDraft,
} from "../lib/brainstorm-drafts";
import { recoverPendingOperation } from "../lib/editor-mutations";
import { moveToTrash } from "../lib/trash-actions";
import { useDraftGuard, useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { useDialog } from "./useDialog";
import "./brainstorming.css";

export default function Brainstorming(props: FeatureProps) {
  const { workspace, mutate, notify, projectFilter, openNote, openTask } =
    props;
  const scope = useDraftScope();
  const { account } = useWorkspaceScope();
  const actor = account.user ? `account_${account.user.id}` : "guest";
  const boards = (workspace.brainstorms || []).filter(
    (board) => !projectFilter || board.projectId === projectFilter,
  );
  const [selectedId, setSelectedId] = useState("");
  const selected = boards.find((board) => board.id === selectedId) || boards[0];
  const [editor, setEditor] = useState<{
    board: BrainstormBoard | null;
    addIdea: boolean;
    ideaId?: string;
  } | null>(null);
  const [rank, setRank] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const errorRegion = useRef<HTMLDivElement>(null);
  const boardHeading = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!busy && error) errorRegion.current?.focus();
  }, [busy, error]);

  async function vote(board: BrainstormBoard, ideaId: string, chosen: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(ideaId);
    setError("");
    try {
      await mutate({ action: "vote-idea", id: board.id, ideaId, vote: chosen });
      notify(chosen ? "Vote added" : "Vote removed");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your vote could not be saved. Try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function removeBoard(board: BrainstormBoard) {
    if (
      busyRef.current ||
      !window.confirm(`Move “${board.title}” and its ideas to Trash?`)
    )
      return;
    busyRef.current = true;
    setBusy(board.id);
    setError("");
    try {
      await moveToTrash(
        mutate,
        notify,
        { entity: "brainstorms", id: board.id, base: { ...board } },
        "Brainstorm board",
        scope,
      );
      boardHeading.current?.focus();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The board could not be moved to Trash.",
      );
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  const ideas = selected ? rankedIdeas(selected, rank) : [];
  const groups = selected
    ? [{ id: "", title: "Ungrouped" }, ...selected.groups]
    : [];

  return (
    <section className="page brainstorm-page" data-tour="brainstorming">
      <header className="brainstorm-page-heading">
        <div>
          <h1>Brainstorming</h1>
          <p>
            Collect ideas, find patterns, and decide what deserves attention.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setEditor({ board: null, addIdea: false })}
        >
          <Plus size={17} />
          New board
        </button>
      </header>
      <div className="brainstorm-toolbar">
        <label>
          Board
          <select
            className="field"
            value={selected?.id || ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setError("");
            }}
          >
            {!boards.length && <option value="">No boards yet</option>}
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Idea order
          <select
            className="field"
            value={rank ? "votes" : "created"}
            onChange={(event) => setRank(event.target.value === "votes")}
          >
            <option value="created">Original order</option>
            <option value="votes">Most votes within each group</option>
          </select>
        </label>
        <span className="brainstorm-scope">
          {projectFilter
            ? workspace.projects.find((project) => project.id === projectFilter)
                ?.name || "Selected project"
            : "All projects"}{" "}
          · {boards.length} {boards.length === 1 ? "board" : "boards"}
        </span>
      </div>
      {error && (
        <div
          className="brainstorm-notice brainstorm-error"
          role="alert"
          tabIndex={-1}
          ref={errorRegion}
        >
          {error}
        </div>
      )}
      {selected ? (
        <>
          <div className="brainstorm-board-heading">
            <div>
              <h2 ref={boardHeading} tabIndex={-1}>
                {selected.title}
              </h2>
              {selected.description && <p>{selected.description}</p>}
              <span className="brainstorm-scope">
                {workspace.projects.find(
                  (project) => project.id === selected.projectId,
                )?.name || "No project"}{" "}
                · {selected.ideas.length}{" "}
                {selected.ideas.length === 1 ? "idea" : "ideas"}
              </span>
            </div>
            <div className="brainstorm-actions">
              <button
                className="btn btn-primary"
                onClick={() => setEditor({ board: selected, addIdea: true })}
                disabled={!!busy || selected.ideas.length >= 200}
              >
                <Plus size={16} />
                Add idea
              </button>
              <button
                className="btn"
                onClick={() => setEditor({ board: selected, addIdea: false })}
                disabled={!!busy}
              >
                <Pencil size={16} />
                Edit board
              </button>
              <button
                className="btn"
                onClick={() => void removeBoard(selected)}
                disabled={!!busy}
              >
                <Trash2 size={16} />
                Trash
              </button>
            </div>
          </div>
          <div className="brainstorm-notice" data-tour="brainstorm-voting">
            <strong>
              {selected.votingOpen ? "Voting is open" : "Voting is closed"}
            </strong>
            <p>
              {selected.votingOpen
                ? "Give each idea one vote and remove it at any time. Votes and totals are visible to workspace members."
                : "Ideas are available for review. Edit the board to reopen voting."}
              {!account.user &&
                " Guest votes belong to this installation’s shared guest workspace."}
            </p>
          </div>
          <div className="brainstorm-groups">
            {groups
              .filter(
                (group) =>
                  group.id ||
                  ideas.some((idea) => !idea.groupId) ||
                  !selected.groups.length,
              )
              .map((group) => {
                const groupedIdeas = ideas.filter(
                  (idea) => idea.groupId === group.id,
                );
                return (
                  <section
                    className="brainstorm-group"
                    key={group.id}
                    aria-label={`${group.title} ideas`}
                  >
                    <h3>
                      {group.title}
                      <span>{groupedIdeas.length}</span>
                    </h3>
                    {groupedIdeas.length ? (
                      <div className="brainstorm-ideas">
                        {groupedIdeas.map((idea) => {
                          const voted = idea.votes.includes(actor);
                          return (
                            <article className="brainstorm-idea" key={idea.id}>
                              <h4>{idea.title}</h4>
                              {idea.description && <p>{idea.description}</p>}
                              {(idea.noteId || idea.taskId) && (
                                <div className="brainstorm-links">
                                  {idea.noteId && (
                                    <button
                                      className="text-button"
                                      onClick={() => openNote(idea.noteId)}
                                    >
                                      Open note:{" "}
                                      {workspace.notes.find(
                                        (note) => note.id === idea.noteId,
                                      )?.title || "Unavailable"}
                                    </button>
                                  )}
                                  {idea.taskId && (
                                    <button
                                      className="text-button"
                                      onClick={() => openTask(idea.taskId)}
                                    >
                                      Open task:{" "}
                                      {workspace.tasks.find(
                                        (task) => task.id === idea.taskId,
                                      )?.title || "Unavailable"}
                                    </button>
                                  )}
                                </div>
                              )}
                              <footer>
                                <span>
                                  {idea.votes.length}{" "}
                                  {idea.votes.length === 1 ? "vote" : "votes"}
                                </span>
                                <button
                                  className="btn"
                                  aria-label={`Edit idea ${idea.title}`}
                                  disabled={!!busy}
                                  onClick={() =>
                                    setEditor({
                                      board: selected,
                                      addIdea: false,
                                      ideaId: idea.id,
                                    })
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn"
                                  aria-pressed={voted}
                                  aria-label={`${voted ? "Remove vote from" : "Vote for"} ${idea.title}`}
                                  disabled={!!busy || !selected.votingOpen}
                                  onClick={() =>
                                    void vote(selected, idea.id, !voted)
                                  }
                                >
                                  {voted ? (
                                    <Check size={16} />
                                  ) : (
                                    <ThumbsUp size={16} />
                                  )}
                                  {busy === idea.id
                                    ? "Saving…"
                                    : voted
                                      ? "Voted"
                                      : "Vote"}
                                </button>
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="brainstorm-empty-copy">
                        No ideas in this group. Add an idea or move one here in
                        Edit board.
                      </p>
                    )}
                  </section>
                );
              })}
          </div>
          {!selected.ideas.length && (
            <p className="brainstorm-empty-copy">
              Start with a question or a possible solution. Use Add idea to
              capture it.
            </p>
          )}
        </>
      ) : (
        <div className="brainstorm-empty">
          <Lightbulb size={32} />
          <h2>
            {projectFilter
              ? "No boards for this project"
              : "Make room for your next idea"}
          </h2>
          <p>
            Create a board, collect possibilities, and group related ideas. Open
            voting when you are ready to compare them.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ board: null, addIdea: false })}
          >
            Create a board
          </button>
        </div>
      )}
      {editor && (
        <BrainstormEditor
          key={editor.board?.id || "new"}
          {...props}
          original={editor.board}
          addIdea={editor.addIdea}
          initialIdeaId={editor.ideaId}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setSelectedId(id);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}

function BrainstormEditor({
  original,
  addIdea,
  initialIdeaId,
  onClose,
  onSaved,
  workspace,
  projectFilter,
  mutate,
  notify,
}: FeatureProps & {
  original: BrainstormBoard | null;
  addIdea: boolean;
  initialIdeaId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const scope = useDraftScope();
  const scopedFetch = useWorkspaceFetch();
  const recoveryId = original?.id || "new";
  const [initial] = useState(() => {
    const stored = readDraft<unknown, BrainstormBoard>(
      scope,
      "brainstorm-forms",
      recoveryId,
    );
    const parsed = parseBrainstormDraft(stored?.value);
    const recovered =
      parsed &&
      (original ? parsed.board.id === original.id : true) &&
      (stored?.baseline === null ||
        (isBrainstormBoard(stored?.baseline) &&
          stored.baseline.id === parsed.board.id))
        ? stored
        : null;
    const now = new Date().toISOString();
    const board: BrainstormBoard = structuredClone(
      recovered && parsed
        ? parsed.board
        : original || {
            id: uid(),
            title: "",
            description: "",
            projectId: projectFilter,
            groups: [],
            ideas: [],
            votingOpen: true,
            createdAt: now,
            updatedAt: now,
          },
    );
    let ideaId = initialIdeaId || "";
    if (addIdea && board.ideas.length < 200) {
      const unfinished = recovered
        ? board.ideas.find((idea) => !idea.title.trim())
        : undefined;
      ideaId = unfinished?.id || uid();
      if (!unfinished)
        board.ideas.push({
          id: ideaId,
          title: "",
          description: "",
          groupId: "",
          noteId: "",
          taskId: "",
          votes: [],
        });
    }
    return {
      board,
      baseline: recovered?.baseline || original,
      token: recovered?.token,
      recovered: !!recovered,
      operationIds: recovered && parsed ? parsed.operationIds : [],
      ideaId,
    };
  });
  const [draft, setDraft] = useState(initial.board);
  const [editingIdea, setEditingIdea] = useState(initial.ideaId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [recovered, setRecovered] = useState(initial.recovered);
  const baseline = useRef(initial.baseline);
  const current = useRef(initial.board);
  const operationIds = useRef(initial.operationIds);
  const token = useRef(initial.token);
  const busy = useRef(false);
  const dirty = useRef(initial.recovered || (addIdea && !!initial.ideaId));
  const dialog = useRef<HTMLFormElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const ideaTitle = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useDialog(dialog, onClose, pending);
  useEffect(() => {
    if (editingIdea) ideaTitle.current?.focus();
  }, [editingIdea]);
  useEffect(() => {
    if (!pending && error) errorRegion.current?.focus();
  }, [pending, error]);
  function persist() {
    const result = writeDraft(
      scope,
      "brainstorm-forms",
      recoveryId,
      {
        board: current.current,
        operationIds: operationIds.current,
      } satisfies BrainstormDraft,
      baseline.current,
    );
    token.current = result.record.token;
    setStorageError(result.error || "");
    return result.persisted;
  }
  useDraftGuard(scope, `brainstorm-editor:${recoveryId}`, {
    hasUnsaved: () => dirty.current,
    hasUnpersisted: () => !!storageError && dirty.current,
    flush: async () => !dirty.current || persist(),
  });
  function change(patch: Partial<BrainstormBoard>) {
    if (busy.current) return;
    const board = { ...current.current, ...patch };
    current.current = board;
    dirty.current = true;
    setDraft(board);
    persist();
  }
  const idea = draft.ideas.find((item) => item.id === editingIdea);
  function changeIdea(patch: Partial<BrainstormBoard["ideas"][number]>) {
    change({
      ideas: current.current.ideas.map((item) =>
        item.id === editingIdea ? { ...item, ...patch } : item,
      ),
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const clean: BrainstormBoard = {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      groups: draft.groups.map((group) => ({
        ...group,
        title: group.title.trim(),
      })),
      ideas: draft.ideas.map((item) => ({
        ...item,
        title: item.title.trim(),
        description: item.description.trim(),
      })),
    };
    if (!clean.title) {
      setError("Give this board a title.");
      return;
    }
    if (clean.groups.some((group) => !group.title)) {
      setError("Give every group a name or remove the empty group.");
      return;
    }
    const incomplete = clean.ideas.find((item) => !item.title);
    if (incomplete) {
      setEditingIdea(incomplete.id);
      setError("Give every idea a title or remove the empty idea.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const base = baseline.current;
      const mutation = recoverPendingOperation(scope, {
        action: "upsert",
        entity: "brainstorms",
        item: base
          ? {
              id: clean.id,
              ...Object.fromEntries(
                Object.entries(clean).filter(
                  ([key, value]) =>
                    !["id", "createdAt", "updatedAt"].includes(key) &&
                    JSON.stringify(value) !==
                      JSON.stringify(base[key as keyof BrainstormBoard]),
                ),
              ),
            }
          : clean,
        base: base ? { ...base } : null,
      });
      mutation.operationId ||= uid();
      if (!operationIds.current.includes(mutation.operationId))
        operationIds.current.push(mutation.operationId);
      persist();
      const sentToken = token.current;
      await mutate(mutation);
      if (sentToken)
        removeDraft(scope, "brainstorm-forms", recoveryId, sentToken);
      dirty.current = false;
      notify(
        original ? "Brainstorm board updated" : "Brainstorm board created",
      );
      onSaved(clean.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The board could not be saved. Your draft is kept.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function discard() {
    if (
      busy.current ||
      !window.confirm(
        "Discard this unfinished board edit? Saved ideas and votes will be kept.",
      )
    )
      return;
    discardBrainstormDraft(
      scope,
      recoveryId,
      draft.id,
      operationIds.current,
      token.current,
    );
    dirty.current = false;
    onClose();
  }
  async function loadLatest() {
    if (
      busy.current ||
      !original ||
      !window.confirm(
        "Replace this unfinished form with the latest saved board? Your unsaved edits will be discarded.",
      )
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const response = await scopedFetch("/api/state", { cache: "no-store" });
      const data = (await response.json()) as {
        workspace?: Workspace;
        error?: string;
      };
      const latest: unknown = data.workspace?.brainstorms?.find(
        (board: BrainstormBoard) => board.id === original.id,
      );
      if (!response.ok || !isBrainstormBoard(latest))
        throw new Error(
          data.error ||
            "This board is no longer available. Your unfinished form is kept.",
        );
      discardBrainstormDraft(
        scope,
        recoveryId,
        current.current.id,
        operationIds.current,
        token.current,
      );
      baseline.current = latest;
      current.current = latest;
      dirty.current = false;
      operationIds.current = [];
      token.current = undefined;
      setDraft(latest);
      setEditingIdea("");
      setRecovered(false);
      setStorageError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The latest board could not be loaded. Your form is kept.",
      );
    } finally {
      busy.current = false;
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
      <form
        className="brainstorm-editor"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={pending}
        onSubmit={(event) => void save(event)}
      >
        <header className="dialog-heading">
          <h2 id={headingId}>
            {original ? "Edit brainstorm board" : "New brainstorm board"}
          </h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close board editor"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p className="brainstorm-help">
          Capture possibilities and arrange them into groups. Changes stay in
          this form until you save.
        </p>
        {recovered && (
          <p className="brainstorm-notice" role="status">
            Your unfinished board is recovered.{" "}
            <button
              className="text-button"
              type="button"
              onClick={() => setRecovered(false)}
            >
              Dismiss notice
            </button>
          </p>
        )}
        {storageError && (
          <p role="alert" className="brainstorm-notice brainstorm-error">
            {storageError} Keep this form open until you can save.
          </p>
        )}
        {error && (
          <div
            ref={errorRegion}
            tabIndex={-1}
            role="alert"
            className="brainstorm-notice brainstorm-error"
          >
            {error}
          </div>
        )}
        <fieldset disabled={pending} className="brainstorm-fields">
          <label>
            Board title
            <input
              className="field"
              value={draft.title}
              maxLength={300}
              onChange={(event) => change({ title: event.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              className="field"
              rows={3}
              value={draft.description}
              maxLength={10_000}
              onChange={(event) => change({ description: event.target.value })}
            />
          </label>
          <div className="brainstorm-two-fields">
            <label>
              Project
              <select
                className="field"
                value={draft.projectId}
                onChange={(event) => change({ projectId: event.target.value })}
              >
                <option value="">No project</option>
                {draft.projectId &&
                  !workspace.projects.some(
                    (item) => item.id === draft.projectId,
                  ) && (
                    <option value={draft.projectId}>
                      Unavailable project — choose another
                    </option>
                  )}
                {workspace.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voting
              <select
                className="field"
                value={draft.votingOpen ? "open" : "closed"}
                onChange={(event) =>
                  change({ votingOpen: event.target.value === "open" })
                }
              >
                <option value="open">Open — members can vote</option>
                <option value="closed">Closed — keep existing votes</option>
              </select>
            </label>
          </div>
          <section className="brainstorm-editor-section">
            <div className="brainstorm-section-heading">
              <h3>Groups</h3>
              <button
                className="btn"
                type="button"
                disabled={draft.groups.length >= 30}
                onClick={() =>
                  change({
                    groups: [...draft.groups, { id: uid(), title: "" }],
                  })
                }
              >
                <Plus size={16} />
                Add group
              </button>
            </div>
            <p className="brainstorm-help">
              Groups help related ideas sit together. Removing a group moves its
              ideas to Ungrouped.
            </p>
            {draft.groups.map((group, index) => (
              <div className="brainstorm-group-field" key={group.id}>
                <label>
                  Group {index + 1}
                  <input
                    className="field"
                    maxLength={300}
                    value={group.title}
                    onChange={(event) =>
                      change({
                        groups: draft.groups.map((item) =>
                          item.id === group.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Remove group ${group.title || index + 1}`}
                  onClick={() =>
                    change({
                      groups: draft.groups.filter(
                        (item) => item.id !== group.id,
                      ),
                      ideas: draft.ideas.map((item) =>
                        item.groupId === group.id
                          ? { ...item, groupId: "" }
                          : item,
                      ),
                    })
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
            {!draft.groups.length && (
              <p className="brainstorm-empty-copy">
                No groups yet. Ideas can stay ungrouped.
              </p>
            )}
          </section>
          <section className="brainstorm-editor-section">
            <div className="brainstorm-section-heading">
              <h3>Ideas · {draft.ideas.length}</h3>
              <button
                className="btn"
                type="button"
                disabled={draft.ideas.length >= 200}
                onClick={() => {
                  const id = uid();
                  change({
                    ideas: [
                      ...draft.ideas,
                      {
                        id,
                        title: "",
                        description: "",
                        groupId: "",
                        noteId: "",
                        taskId: "",
                        votes: [],
                      },
                    ],
                  });
                  setEditingIdea(id);
                }}
              >
                <Plus size={16} />
                Add idea
              </button>
            </div>
            {draft.ideas.length > 0 && (
              <label>
                Idea to edit
                <select
                  className="field"
                  value={editingIdea}
                  onChange={(event) => setEditingIdea(event.target.value)}
                >
                  <option value="">Choose an idea</option>
                  {draft.ideas.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || "Untitled idea"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {idea ? (
              <div className="brainstorm-idea-form">
                <label>
                  Idea title
                  <input
                    ref={ideaTitle}
                    className="field"
                    value={idea.title}
                    maxLength={300}
                    onChange={(event) =>
                      changeIdea({ title: event.target.value })
                    }
                  />
                </label>
                <label>
                  Idea details
                  <textarea
                    className="field"
                    rows={4}
                    value={idea.description}
                    maxLength={10_000}
                    onChange={(event) =>
                      changeIdea({ description: event.target.value })
                    }
                  />
                </label>
                <label>
                  Group
                  <select
                    className="field"
                    value={idea.groupId}
                    onChange={(event) =>
                      changeIdea({ groupId: event.target.value })
                    }
                  >
                    <option value="">Ungrouped</option>
                    {draft.groups.map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.title || "Unnamed group"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="brainstorm-two-fields">
                  <label>
                    Linked note
                    <select
                      className="field"
                      value={idea.noteId}
                      onChange={(event) =>
                        changeIdea({ noteId: event.target.value })
                      }
                    >
                      <option value="">No note</option>
                      {idea.noteId &&
                        !workspace.notes.some(
                          (item) => item.id === idea.noteId,
                        ) && (
                          <option value={idea.noteId}>
                            Unavailable note — clear or replace
                          </option>
                        )}
                      {workspace.notes.map((note) => (
                        <option value={note.id} key={note.id}>
                          {note.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Linked task
                    <select
                      className="field"
                      value={idea.taskId}
                      onChange={(event) =>
                        changeIdea({ taskId: event.target.value })
                      }
                    >
                      <option value="">No task</option>
                      {idea.taskId &&
                        !workspace.tasks.some(
                          (item) => item.id === idea.taskId,
                        ) && (
                          <option value={idea.taskId}>
                            Unavailable task — clear or replace
                          </option>
                        )}
                      {workspace.tasks.map((task) => (
                        <option value={task.id} key={task.id}>
                          {task.key} · {task.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remove “${idea.title || "this idea"}” and its votes when the board is saved?`,
                      )
                    )
                      return;
                    change({
                      ideas: draft.ideas.filter((item) => item.id !== idea.id),
                    });
                    setEditingIdea("");
                  }}
                >
                  <Trash2 size={16} />
                  Remove idea
                </button>
              </div>
            ) : (
              <p className="brainstorm-empty-copy">
                Add an idea or choose one to edit its details, group, and links.
              </p>
            )}
          </section>
        </fieldset>
        <footer className="brainstorm-editor-footer">
          <p>Unfinished edits are kept in this browser when you close.</p>
          {original && (
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={() => void loadLatest()}
            >
              Load latest
            </button>
          )}
          <button
            className="btn"
            type="button"
            disabled={pending}
            onClick={discard}
          >
            Discard draft
          </button>
          <button
            className="btn"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </button>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save board"}
          </button>
        </footer>
      </form>
    </div>
  );
}
