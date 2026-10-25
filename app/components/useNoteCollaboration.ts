"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type * as Y from "yjs";
import {
  registerDraftGuard,
  removeDraft,
  writeDraft,
} from "../lib/draft-store";
import type {
  CollaborativeDraft,
  NoteCollaborationState,
} from "../lib/note-collaboration";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch } from "./WorkspaceScope";
import type { SharedDraftReference } from "../lib/note-collaboration-drafts";
import { sharedNoteDraftKey } from "../lib/note-collaboration-draft-keys";

type CollaborationRuntime = typeof import("../lib/note-collaboration-runtime");
let browserRuntime: Promise<CollaborationRuntime> | undefined;
function loadBrowserRuntime(): Promise<CollaborationRuntime> {
  browserRuntime ||= import("../lib/note-collaboration-runtime").catch(
    (error) => {
      browserRuntime = undefined;
      throw error;
    },
  );
  return browserRuntime;
}

export type CollaborationStatus =
  | "opening"
  | "saved"
  | "saving"
  | "offline"
  | "review"
  | "read-only";
interface ConnectionView {
  status: CollaborationStatus;
  error: string;
  ready: boolean;
  canEdit: boolean;
  peers: NoteCollaborationState["peers"];
  pending: boolean;
  recoveryError: string;
  earlierDrafts: { id: string; content: string; updatedAt: string }[];
}
const initialConnection = (): ConnectionView => ({
  status: "opening",
  error: "",
  ready: false,
  canEdit: false,
  peers: [],
  pending: false,
  recoveryError: "",
  earlierDrafts: [],
});

/** Network/session state is external to React and not derived from a render. */
class ConnectionStore {
  private value = initialConnection();
  private listeners = new Set<() => void>();
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  patch(patch: Partial<ConnectionView>) {
    const entries = Object.entries(patch) as [
      keyof ConnectionView,
      ConnectionView[keyof ConnectionView],
    ][];
    if (
      entries.every(([key, value]) =>
        key === "peers"
          ? JSON.stringify(this.value[key]) === JSON.stringify(value)
          : this.value[key] === value,
      )
    )
      return;
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
}
interface Session {
  noteId: string;
  doc: Y.Doc | null;
  generation: string;
  serverVector: string;
  dirty: boolean;
  unpersisted: boolean;
  localVersion: number;
  canEdit: boolean;
  blocked: boolean;
  closed: boolean;
  token?: string;
  recoveryId: string;
  recovered: SharedDraftReference[];
  content: string;
  request: Promise<boolean> | null;
  timer: ReturnType<typeof setTimeout> | null;
  operation: { id: string; update: string; version: number } | null;
  fetch: ReturnType<typeof useWorkspaceFetch>;
  runtime: CollaborationRuntime | null;
}

export function useNoteCollaboration({
  noteId,
  enabled,
  initialContent,
  onContent,
  textareaRef,
}: {
  noteId: string;
  enabled: boolean;
  initialContent: string;
  onContent: (content: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const scope = useDraftScope(),
    scopedFetch = useWorkspaceFetch();
  const [tabId] = useState(() => crypto.randomUUID());
  const [view] = useState(() => new ConnectionStore());
  const {
    status,
    error,
    ready,
    canEdit,
    peers,
    pending,
    recoveryError,
    earlierDrafts,
  } = useSyncExternalStore(view.subscribe, view.snapshot, view.snapshot);
  const setStatus = useCallback(
    (status: CollaborationStatus) => view.patch({ status }),
    [view],
  );
  const setError = useCallback(
    (error: string) => view.patch({ error }),
    [view],
  );
  const setReady = useCallback(
    (ready: boolean) => view.patch({ ready }),
    [view],
  );
  const setCanEdit = useCallback(
    (canEdit: boolean) => view.patch({ canEdit }),
    [view],
  );
  const setPeers = useCallback(
    (peers: NoteCollaborationState["peers"]) => view.patch({ peers }),
    [view],
  );
  const setPending = useCallback(
    (pending: boolean) => view.patch({ pending }),
    [view],
  );
  const setRecoveryError = useCallback(
    (recoveryError: string) => view.patch({ recoveryError }),
    [view],
  );
  const session = useRef<Session | null>(null);
  const restartRequest = useRef<{ id: string; generation: string } | null>(
    null,
  );
  const callback = useRef(onContent);
  useLayoutEffect(() => {
    callback.current = onContent;
  }, [onContent]);
  const resetConnection = useCallback(
    () => view.patch(initialConnection()),
    [view],
  );

  const persist = useCallback(
    (active: Session) => {
      if (!active.doc || !active.generation || !active.runtime) return false;
      const { serializedDocument } = active.runtime;
      try {
        const result = writeDraft(
          scope,
          "shared-notes",
          active.recoveryId,
          {
            noteId: active.noteId,
            generation: active.generation,
            update: serializedDocument(active.doc),
            content: active.content,
          } satisfies CollaborativeDraft,
          null,
        );
        active.token = result.record.token;
        active.unpersisted = !result.persisted;
        if (!active.closed) setRecoveryError(result.error || "");
        return result.persisted;
      } catch (cause) {
        active.unpersisted = true;
        if (!active.closed)
          setRecoveryError(
            cause instanceof Error
              ? cause.message
              : "Your shared note draft could not be kept. Copy your text before leaving.",
          );
        return false;
      }
    },
    [scope, setRecoveryError],
  );

  const publish = useCallback(
    (active: Session, apply: () => void) => {
      if (!active.runtime) return;
      const { Y, documentText } = active.runtime;
      const textarea = textareaRef?.current,
        focused = textarea && document.activeElement === textarea;
      const text = active.doc?.getText("content");
      const start =
        focused && text
          ? Y.createRelativePositionFromTypeIndex(
              text,
              Math.min(text.length, textarea.selectionStart),
            )
          : null;
      const end =
        focused && text
          ? Y.createRelativePositionFromTypeIndex(
              text,
              Math.min(text.length, textarea.selectionEnd),
            )
          : null;
      const previousContent = active.content;
      apply();
      if (!active.doc) return;
      active.content = documentText(active.doc);
      if (!active.closed && active.content !== previousContent) {
        callback.current(active.content);
        if (start && end)
          requestAnimationFrame(() => {
            if (
              !textarea?.isConnected ||
              document.activeElement !== textarea ||
              !active.doc
            )
              return;
            const first = Y.createAbsolutePositionFromRelativePosition(
                start,
                active.doc,
              ),
              last = Y.createAbsolutePositionFromRelativePosition(
                end,
                active.doc,
              );
            if (first && last)
              textarea.setSelectionRange(first.index, last.index);
          });
      }
    },
    [textareaRef],
  );

  const synchronize = useCallback(
    async (active: Session): Promise<boolean> => {
      if (active.request) return active.request;
      if (active.blocked) return false;
      const operation = (async () => {
        try {
          const runtime = active.runtime || (await loadBrowserRuntime());
          if (active.closed) return !active.dirty;
          active.runtime = runtime;
          const {
            Y,
            decodeDocumentUpdate,
            documentText,
            encodeDocumentUpdate,
            serializedDocument,
            sharedNoteDrafts,
            mergeSharedNoteDrafts,
            acknowledgeSharedNoteDrafts,
          } = runtime;
          let response: Response;
          let sent: Session["operation"] = null;
          if (active.doc && active.dirty && active.canEdit) {
            sent = active.operation || {
              id: crypto.randomUUID(),
              update: encodeDocumentUpdate(
                Y.encodeStateAsUpdate(
                  active.doc,
                  active.serverVector
                    ? decodeDocumentUpdate(active.serverVector)
                    : undefined,
                ),
              ),
              version: active.localVersion,
            };
            active.operation = sent;
            if (!active.closed) setStatus("saving");
            response = await active.fetch("/api/coedit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                noteId: active.noteId,
                generation: active.generation,
                update: sent.update,
                operationId: sent.id,
                tabId,
              }),
            });
          } else {
            const vector = active.doc
              ? encodeDocumentUpdate(Y.encodeStateVector(active.doc))
              : "";
            response = await active.fetch(
              `/api/coedit?note=${encodeURIComponent(active.noteId)}&tab=${tabId}${active.generation ? `&generation=${active.generation}&vector=${encodeURIComponent(vector)}` : ""}`,
              { cache: "no-store" },
            );
          }
          const result = (await response.json()) as NoteCollaborationState & {
            error?: string;
          };
          if (!response.ok) {
            if (
              [401, 403, 404].includes(response.status) ||
              response.status === 409
            ) {
              active.blocked = true;
              active.canEdit = false;
              if (!active.closed) {
                setStatus(response.status === 409 ? "review" : "read-only");
                setCanEdit(false);
              }
            }
            throw new Error(
              result.error ||
                "Shared editing could not synchronize. Your unfinished text is kept.",
            );
          }
          if (
            result.noteId !== active.noteId ||
            typeof result.generation !== "string" ||
            typeof result.update !== "string" ||
            typeof result.stateVector !== "string"
          )
            throw new Error(
              "The shared note response was incomplete. Retry synchronization.",
            );
          if (
            active.generation &&
            result.generation !== active.generation &&
            active.dirty
          ) {
            active.blocked = true;
            active.canEdit = false;
            if (!active.closed) {
              setStatus("review");
              setCanEdit(false);
            }
            throw new Error(
              "This note was restored or replaced while you were editing. Copy or download your unfinished text, then load the latest saved version.",
            );
          }
          const recovered = active.doc
            ? []
            : sharedNoteDrafts(scope, active.noteId);
          const matching = recovered.filter(
            (item) => item.record.value.generation === result.generation,
          );
          const stale = recovered.filter(
            (item) => item.record.value.generation !== result.generation,
          );
          if (!active.closed && stale.length)
            view.patch({
              earlierDrafts: stale.map((item) => ({
                id: item.id,
                content: item.record.value.content,
                updatedAt: item.record.updatedAt,
              })),
            });
          if (!matching.length && stale.length) {
            const draft = stale[0].record.value;
            active.doc = new Y.Doc();
            mergeSharedNoteDrafts(active.doc, stale, draft.generation);
            active.recovered = stale.map((item) => ({
              id: item.id,
              token: item.record.token,
              generation: item.record.value.generation,
            }));
            active.generation = draft.generation;
            active.content = documentText(active.doc);
            active.dirty = true;
            active.blocked = true;
            active.canEdit = false;
            if (!active.closed) {
              callback.current(active.content);
              setPending(true);
              setStatus("review");
              setCanEdit(false);
            }
            throw new Error(
              "A recovered shared-editing draft belongs to an earlier version of this note. Download or copy it before loading the latest saved version.",
            );
          }
          if (!active.doc || active.generation !== result.generation) {
            active.doc?.destroy();
            active.doc = new Y.Doc();
            active.generation = result.generation;
          }
          publish(active, () => {
            Y.applyUpdate(
              active.doc!,
              decodeDocumentUpdate(result.update),
              "remote",
            );
            if (matching.length) {
              active.recovered = mergeSharedNoteDrafts(
                active.doc!,
                matching,
                result.generation,
              );
              active.dirty = serializedDocument(active.doc!) !== result.update;
            }
          });
          active.serverVector = result.stateVector;
          active.canEdit = result.canEdit;
          if (sent) {
            active.operation = null;
            if (active.localVersion === sent.version) active.dirty = false;
          }
          if (active.dirty) persist(active);
          else {
            acknowledgeSharedNoteDrafts(
              scope,
              active.recovered.filter(
                (item) => item.generation === active.generation,
              ),
            );
            active.recovered = [];
            if (active.token)
              removeDraft(
                scope,
                "shared-notes",
                active.recoveryId,
                active.token,
              );
            active.token = undefined;
            active.unpersisted = false;
          }
          if (!active.closed) {
            setReady(true);
            setCanEdit(active.canEdit);
            setPending(active.dirty);
            setPeers(result.peers || []);
            setError(
              !active.canEdit && active.dirty
                ? "Your role changed to read only. Your unfinished text is kept; download it before loading the saved version."
                : "",
            );
            if (!active.dirty) setRecoveryError("");
            setStatus(
              active.canEdit
                ? active.dirty
                  ? "saving"
                  : "saved"
                : "read-only",
            );
          }
          if (sent && typeof window !== "undefined")
            window.dispatchEvent(new Event("projectanvil:workspace-changed"));
          return !active.dirty;
        } catch (cause) {
          if (active.dirty) persist(active);
          if (!active.closed) {
            setError(
              cause instanceof Error
                ? cause.message
                : "The local server could not be reached. Your unfinished text is kept.",
            );
            if (!active.blocked) setStatus("offline");
            setPending(active.dirty);
          }
          return false;
        }
      })();
      active.request = operation;
      try {
        return await operation;
      } finally {
        if (active.request === operation) active.request = null;
      }
    },
    [
      persist,
      publish,
      scope,
      tabId,
      setCanEdit,
      setError,
      setPending,
      setPeers,
      setReady,
      setRecoveryError,
      setStatus,
      view,
    ],
  );

  const flush = useCallback(async () => {
    const active = session.current;
    if (!active) return true;
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    if (active.request) await active.request;
    if (active.blocked) return !active.dirty;
    // Finish edits typed while an earlier request was in flight as well.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await synchronize(active)) return true;
      if (active.operation) return false;
      if (!active.canEdit || active.blocked) return !active.dirty;
    }
    return !active.dirty;
  }, [synchronize]);

  useEffect(() => {
    if (!enabled || !noteId) {
      session.current = null;
      resetConnection();
      return;
    }
    const active: Session = {
      noteId,
      doc: null,
      generation: "",
      serverVector: "",
      dirty: false,
      unpersisted: false,
      localVersion: 0,
      canEdit: false,
      blocked: false,
      closed: false,
      content: initialContent,
      request: null,
      timer: null,
      operation: null,
      recoveryId: sharedNoteDraftKey(noteId, tabId),
      recovered: [],
      fetch: scopedFetch,
      runtime: null,
    };
    session.current = active;
    restartRequest.current = null;
    resetConnection();
    void synchronize(active);
    const timer = setInterval(() => {
      if (!document.hidden) void synchronize(active);
    }, 1500);
    const wake = () => void synchronize(active);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      active.closed = true;
      clearInterval(timer);
      if (active.timer) clearTimeout(active.timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      if (active.dirty) persist(active);
      void (active.request || Promise.resolve()).finally(() =>
        active.doc?.destroy(),
      );
      if (session.current === active) session.current = null;
    };
    // Content changes belong to the current Y.Doc; they do not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    noteId,
    persist,
    synchronize,
    resetConnection,
    scopedFetch,
    tabId,
  ]);

  useEffect(
    () =>
      registerDraftGuard(scope, `shared-note:${noteId}`, {
        hasUnsaved: () => !!session.current?.dirty,
        hasUnpersisted: () =>
          !!session.current?.dirty && !!session.current?.unpersisted,
        flush,
      }),
    [scope, noteId, flush],
  );

  function change(content: string): boolean {
    const active = session.current;
    if (
      !active?.doc ||
      !active.runtime ||
      !active.canEdit ||
      active.blocked ||
      active.closed
    )
      return false;
    const { replaceCollaborativeText, documentText } = active.runtime;
    try {
      replaceCollaborativeText(active.doc, content);
      active.content = documentText(active.doc);
      active.localVersion++;
      active.dirty = true;
      persist(active);
      setPending(true);
      setStatus("saving");
      setError("");
      callback.current(active.content);
      if (active.timer) clearTimeout(active.timer);
      active.timer = setTimeout(() => {
        active.timer = null;
        void synchronize(active);
      }, 450);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This change could not be applied.",
      );
      return false;
    }
  }
  async function discardAndReload() {
    const active = session.current;
    if (!active) return;
    if (
      active.dirty &&
      !window.confirm(
        "Discard unfinished shared editing changes and load the latest saved note? Download or copy your text first if you want to keep it.",
      )
    )
      return;
    if (active.request) await active.request;
    if (active.token)
      removeDraft(scope, "shared-notes", active.recoveryId, active.token);
    active.runtime?.acknowledgeSharedNoteDrafts(scope, active.recovered);
    active.recovered = [];
    view.patch({ earlierDrafts: [] });
    active.doc?.destroy();
    active.doc = null;
    active.generation = "";
    active.serverVector = "";
    active.dirty = false;
    active.unpersisted = false;
    active.blocked = false;
    active.canEdit = false;
    active.operation = null;
    active.token = undefined;
    setReady(false);
    setPending(false);
    setCanEdit(false);
    setError("");
    setRecoveryError("");
    setStatus("opening");
    await synchronize(active);
  }
  async function restartFromSaved() {
    const active = session.current;
    if (
      !active ||
      !active.runtime ||
      !active.generation ||
      !window.confirm(
        "Restart shared editing from the confirmed saved note? Unfinished local changes will be discarded. Download or copy them first. Other editors with unfinished changes will be asked to review them.",
      )
    )
      return;
    const { Y, decodeDocumentUpdate, acknowledgeSharedNoteDrafts } =
      active.runtime;
    if (active.request) await active.request;
    const capturedToken = active.token;
    restartRequest.current ||= {
      id: crypto.randomUUID(),
      generation: active.generation,
    };
    active.blocked = true;
    setCanEdit(false);
    setStatus("opening");
    try {
      const response = await active.fetch("/api/coedit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restart",
          noteId: active.noteId,
          generation: restartRequest.current.generation,
          operationId: restartRequest.current.id,
          tabId,
        }),
      });
      const result = (await response.json()) as NoteCollaborationState & {
        error?: string;
      };
      if (active.closed) return;
      if (!response.ok)
        throw new Error(
          result.error ||
            "The editing session could not restart. Your unfinished text is kept.",
        );
      if (capturedToken)
        removeDraft(scope, "shared-notes", active.recoveryId, capturedToken);
      acknowledgeSharedNoteDrafts(scope, active.recovered);
      active.recovered = [];
      view.patch({ earlierDrafts: [] });
      active.doc?.destroy();
      active.doc = new Y.Doc();
      active.generation = result.generation;
      active.serverVector = result.stateVector;
      active.operation = null;
      active.dirty = false;
      active.unpersisted = false;
      active.blocked = false;
      active.canEdit = result.canEdit;
      active.token = undefined;
      publish(active, () =>
        Y.applyUpdate(
          active.doc!,
          decodeDocumentUpdate(result.update),
          "remote",
        ),
      );
      restartRequest.current = null;
      setReady(true);
      setCanEdit(result.canEdit);
      setPending(false);
      setError("");
      setRecoveryError("");
      setPeers(result.peers);
      setStatus(result.canEdit ? "saved" : "read-only");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Shared editing could not restart. Your text is kept.",
      );
      setStatus("review");
    }
  }
  return {
    ready,
    canEdit,
    status,
    error,
    peers,
    pending,
    recoveryError,
    earlierDrafts,
    change,
    flush,
    retry: () =>
      session.current ? synchronize(session.current) : Promise.resolve(false),
    discardAndReload,
    restartFromSaved,
  };
}
