"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Copy,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { uid } from "../lib/types";
import type {
  PersonalTemplate,
  TemplateInput,
} from "../lib/personal-templates";
import { useWorkspaceFetch } from "./WorkspaceScope";
import { useDialog } from "./useDialog";
import "./personal-templates.css";

type Props = {
  kind: "note" | "task";
  source?: TemplateInput["content"];
  sourceTitle?: string;
  onUse: (template: PersonalTemplate) => void | Promise<void>;
  onClose: () => void;
};

/** An account library, separate from the shared workspace's content. */
export default function PersonalTemplates({
  kind,
  source,
  sourceTitle = "",
  onUse,
  onClose,
}: Props) {
  const scopedFetch = useWorkspaceFetch();
  const dialog = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const createId = useRef(uid());
  const collectionButton = useRef<HTMLButtonElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<string | null>(null);
  const id = useId();
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(sourceTitle.slice(0, 100));
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  useDialog(dialog, onClose, pending);

  useEffect(() => {
    let active = true;
    scopedFetch("/api/templates", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          templates?: PersonalTemplate[];
          error?: string;
        };
        if (!response.ok || !result.templates)
          throw new Error(
            result.error || "Your templates could not be loaded.",
          );
        if (active) setTemplates(result.templates);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Your templates could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scopedFetch, loadVersion]);

  useEffect(() => {
    if (pending || !focusAfter.current) return;
    const target =
      focusAfter.current === "collection"
        ? collectionButton.current
        : renameButtons.current.get(focusAfter.current);
    target?.focus();
    focusAfter.current = null;
  }, [pending, templates, renaming]);

  async function change(body: Record<string, unknown>, message: string) {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await scopedFetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        templates?: PersonalTemplate[];
        error?: string;
      };
      if (!response.ok || !result.templates)
        throw new Error(
          result.error ||
            "The template could not be saved. Close and reopen the library to refresh it.",
        );
      setTemplates(result.templates);
      setNotice(message);
      if (body.action === "delete" || body.action === "restore")
        focusAfter.current = "collection";
      else focusAfter.current = renaming || "collection";
      setRenaming(null);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The template could not be saved.",
      );
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function use(template: PersonalTemplate) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onUse(template);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The template could not be used.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const visible = templates.filter(
    (template) =>
      template.kind === kind &&
      !!template.deletedAt === removed &&
      template.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className="modal-shade personal-template-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        ref={dialog}
        className="personal-template-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={pending || loading}
      >
        <header className="personal-template-heading">
          <div>
            <span className="eyebrow">YOUR PERSONAL LIBRARY</span>
            <h2 id={`${id}-title`}>My {kind} templates</h2>
          </div>
          <button
            className="btn-icon"
            aria-label="Close templates"
            disabled={pending}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p className="personal-template-help">
          Reusable starting points for you across your workspaces. Team members
          do not see this library. Files, assignments, dates, and history are
          excluded.
        </p>
        {source && !removed && (
          <form
            className="personal-template-save"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void change(
                {
                  action: "save",
                  template: {
                    id: createId.current,
                    name: name.trim(),
                    kind,
                    content: source,
                  },
                  base: null,
                },
                "Template saved to your library.",
              ).then((saved) => {
                if (saved) createId.current = uid();
              });
            }}
          >
            <label htmlFor={`${id}-name`}>
              Save current {kind} as a template
            </label>
            <div>
              <input
                id={`${id}-name`}
                className="field"
                value={name}
                maxLength={100}
                disabled={pending || loading}
                onChange={(event) => setName(event.target.value)}
                placeholder="Template name"
              />
              <button
                className="btn btn-primary"
                disabled={!name.trim() || pending || loading}
              >
                <Plus size={16} />
                Save template
              </button>
            </div>
          </form>
        )}
        <div className="personal-template-tools">
          <label>
            <input
              className="field"
              aria-label="Search your templates"
              value={query}
              placeholder="Search your templates…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div role="group" aria-label="Template collection">
            <button
              ref={!removed ? collectionButton : undefined}
              className="btn"
              aria-pressed={!removed}
              onClick={() => setRemoved(false)}
            >
              Templates
            </button>
            <button
              ref={removed ? collectionButton : undefined}
              className="btn"
              aria-pressed={removed}
              onClick={() => setRemoved(true)}
            >
              Deleted
            </button>
            <button
              className="btn"
              disabled={pending || loading}
              onClick={() => {
                setLoading(true);
                setError("");
                setRenaming(null);
                setLoadVersion((value) => value + 1);
              }}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="personal-template-notice" role="status">
            {notice}
          </p>
        )}
        <div className="personal-template-list">
          {loading ? (
            <p className="muted">Loading your templates…</p>
          ) : !visible.length ? (
            <p className="personal-template-empty">
              {removed
                ? "No deleted templates."
                : query
                  ? "No templates match your search."
                  : `No personal ${kind} templates yet. Save one from a ${kind} to reuse its structure.`}
            </p>
          ) : (
            visible.map((template) => (
              <article key={template.id}>
                {renaming === template.id ? (
                  <form
                    className="personal-template-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (rename.trim())
                        void change(
                          {
                            action: "save",
                            template: {
                              id: template.id,
                              kind: template.kind,
                              content: template.content,
                              name: rename.trim(),
                            },
                            base: template.revision,
                          },
                          "Template renamed.",
                        );
                    }}
                  >
                    <label htmlFor={`${id}-rename`}>Template name</label>
                    <input
                      id={`${id}-rename`}
                      className="field"
                      value={rename}
                      maxLength={100}
                      autoFocus
                      disabled={pending}
                      onChange={(event) => setRename(event.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={!rename.trim() || pending}
                    >
                      Save name
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        focusAfter.current = template.id;
                        setRenaming(null);
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="personal-template-summary">
                      <strong>{template.name}</strong>
                      <span>
                        {removed ? "Deleted " : "Updated "}
                        {new Date(
                          template.deletedAt || template.updatedAt,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="personal-template-actions">
                      {removed ? (
                        <button
                          className="btn"
                          disabled={pending}
                          onClick={() =>
                            void change(
                              {
                                action: "restore",
                                id: template.id,
                                base: template.revision,
                              },
                              "Template restored.",
                            )
                          }
                        >
                          <RotateCcw size={16} />
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            className="btn btn-primary"
                            disabled={pending}
                            onClick={() => void use(template)}
                          >
                            <Copy size={16} />
                            Use template
                          </button>
                          <button
                            className="btn"
                            ref={(element) => {
                              if (element)
                                renameButtons.current.set(template.id, element);
                              else renameButtons.current.delete(template.id);
                            }}
                            disabled={pending}
                            onClick={() => {
                              setRenaming(template.id);
                              setRename(template.name);
                            }}
                          >
                            Rename
                          </button>
                          {source && (
                            <button
                              className="btn"
                              disabled={pending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Replace “${template.name}” with the current ${kind}'s reusable content?`,
                                  )
                                )
                                  void change(
                                    {
                                      action: "save",
                                      template: {
                                        id: template.id,
                                        name: template.name,
                                        kind,
                                        content: source,
                                      },
                                      base: template.revision,
                                    },
                                    "Template updated from current content.",
                                  );
                              }}
                            >
                              <Save size={15} />
                              Update from current
                            </button>
                          )}
                          <button
                            className="btn"
                            disabled={pending}
                            onClick={() =>
                              void change(
                                {
                                  action: "delete",
                                  id: template.id,
                                  base: template.revision,
                                },
                                "Template deleted. Find it in Deleted to restore it.",
                              )
                            }
                          >
                            <Trash2 size={15} />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </article>
            ))
          )}
        </div>
        <footer className="personal-template-footer">
          <button className="btn" disabled={pending} onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
