"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Download, FolderOpen, Upload, X } from "lucide-react";
import type { Notify, Workspace } from "../lib/types";
import {
  packPortableZip,
  portableLimits,
  readPortableBundle,
  unpackPortableZip,
  type PortableBundle,
  type PortableFile,
} from "../lib/portable-markdown";
import {
  listDrafts,
  readDraft,
  registerDraftGuard,
  removeDraft,
  subscribeDrafts,
  writeDraft,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch } from "./WorkspaceScope";
import { useWorkspacePermissions } from "./WorkspacePermissions";
import "./portable-markdown.css";

type ImportReceipt = {
  operationId: string;
  archiveHash: string;
  projectId: string;
};
type Props = {
  workspace: Workspace;
  notify: Notify;
  onImported?: () => void | Promise<void>;
  connected?: boolean;
};

async function archiveDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Portable files are reviewed locally; only explicit import commits new records. */
export default function PortableMarkdownPanel({
  workspace,
  notify,
  onImported,
  connected = true,
}: Props) {
  const fetchWorkspace = useWorkspaceFetch();
  const scope = useDraftScope();
  const permissions = useWorkspacePermissions(workspace);
  const [exportProject, setExportProject] = useState("");
  const [importProject, setImportProject] = useState("");
  const [selection, setSelection] = useState<{
    bytes: Uint8Array;
    hash: string;
    bundle: PortableBundle;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "export" | "import">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    notes: number;
    attachments: number;
    warnings: string[];
  } | null>(null);
  const zipInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<"export" | "choose" | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const pendingImports = useSyncExternalStore(
    subscribeDrafts,
    () =>
      listDrafts(scope, "portable-import")
        .map((item) => item.id)
        .sort()
        .join(","),
    () => "",
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (selection) reviewHeading.current?.focus();
  }, [selection]);
  useLayoutEffect(() => {
    if (busy) return;
    if (error) errorMessage.current?.focus();
    else if (result) resultHeading.current?.focus();
    else if (returnFocus.current === "export") exportButton.current?.focus();
    else if (returnFocus.current === "choose") chooseButton.current?.focus();
    returnFocus.current = null;
  }, [busy, error, result, selection]);
  useEffect(
    () =>
      registerDraftGuard(scope, "portable-markdown-import", {
        hasUnsaved: () => !!pending.current,
        flush: async () => {
          await pending.current;
          return !pending.current;
        },
      }),
    [scope],
  );
  const writableProjects = workspace.projects.filter((project) =>
    permissions.canEditProject(project.id),
  );
  const canImport =
    permissions.canCreate &&
    permissions.canEditProject(importProject) &&
    connected;

  async function choose(files: FileList | null, folder: boolean) {
    if (!files?.length || busy) return;
    setBusy("reading");
    setError("");
    setResult(null);
    setSelection(null);
    try {
      let bytes: Uint8Array, bundle: PortableBundle;
      if (folder) {
        if (files.length > portableLimits.files)
          throw new Error("Choose at most 400 files in one folder import.");
        if (
          [...files].reduce((sum, file) => sum + file.size, 0) >
          portableLimits.expandedBytes
        )
          throw new Error("Choose at most 24 MB of folder contents.");
        const portable: PortableFile[] = [];
        const root = files[0].webkitRelativePath.split("/")[0];
        for (const file of files) {
          const raw = file.webkitRelativePath || file.name;
          const path =
            root && raw.startsWith(`${root}/`)
              ? raw.slice(root.length + 1)
              : raw;
          portable.push({
            path,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        }
        bundle = readPortableBundle(portable);
        bytes = packPortableZip(portable);
      } else {
        if (files.length !== 1 || files[0].size > portableLimits.archiveBytes)
          throw new Error("Choose one ZIP smaller than 25 MB.");
        bytes = new Uint8Array(await files[0].arrayBuffer());
        bundle = readPortableBundle(unpackPortableZip(bytes));
      }
      const hash = await archiveDigest(bytes);
      if (!alive.current) return;
      setSelection({
        bytes,
        hash,
        bundle,
        name: folder
          ? files[0].webkitRelativePath.split("/")[0] || "Selected folder"
          : files[0].name,
      });
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The folder could not be read.",
        );
    } finally {
      if (alive.current) setBusy("");
      if (zipInput.current) zipInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  }

  async function exportFolder() {
    if (busy || !connected) return;
    setBusy("export");
    setError("");
    setResult(null);
    returnFocus.current = "export";
    try {
      const response = await fetchWorkspace(
        `/api/portable${exportProject ? `?project=${encodeURIComponent(exportProject)}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(
          body.error || "The Markdown folder could not be exported.",
        );
      }
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `projectanvil-markdown-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Markdown folder exported with its attachments");
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The Markdown folder could not be exported.",
        );
    } finally {
      if (alive.current) setBusy("");
    }
  }

  function importFolder() {
    if (!selection || busy || !canImport || pending.current) return;
    const selected = selection,
      projectId = importProject,
      key = `${selected.hash}_${projectId}`;
    const earlier = readDraft<ImportReceipt>(
      scope,
      "portable-import",
      key,
    )?.value;
    const operationId =
      earlier?.archiveHash === selected.hash &&
      earlier.projectId === projectId &&
      /^[A-Za-z0-9_-]{1,120}$/.test(earlier.operationId)
        ? earlier.operationId
        : crypto.randomUUID();
    const draft = writeDraft(
      scope,
      "portable-import",
      key,
      { operationId, archiveHash: selected.hash, projectId },
      null,
    );
    if (!draft.persisted) {
      setError(
        draft.error ||
          "Enable browser storage before importing so interrupted imports can be retried safely.",
      );
      return;
    }
    setBusy("import");
    setError("");
    setResult(null);
    const operation = (async () => {
      try {
        const response = await fetchWorkspace("/api/portable", {
          method: "POST",
          headers: {
            "Content-Type": "application/zip",
            "X-Import-Project": projectId,
            "X-Import-Operation": operationId,
          },
          body: new Uint8Array(selected.bytes),
        });
        const body = (await response.json()) as {
          imported?: { notes: number; attachments: number };
          warnings?: string[];
          error?: string;
        };
        if (!response.ok || !body.imported)
          throw new Error(
            body.error ||
              "The import could not be confirmed. Keep the same selection and retry.",
          );
        removeDraft(scope, "portable-import", key, draft.record.token);
        if (!alive.current) return;
        setResult({ ...body.imported, warnings: body.warnings || [] });
        setSelection(null);
        notify(
          `${body.imported.notes} ${body.imported.notes === 1 ? "note" : "notes"} and ${body.imported.attachments} ${body.imported.attachments === 1 ? "attachment" : "attachments"} imported`,
        );
        if (onImported) {
          try {
            await onImported();
          } catch {
            notify(
              "The import is saved. Refresh the workspace to see the new notes.",
            );
          }
        } else
          window.dispatchEvent(new Event("projectanvil:workspace-changed"));
      } catch (cause) {
        if (alive.current)
          setError(
            `${cause instanceof Error ? cause.message : "The import could not be completed."} Reselect the same unchanged folder or ZIP to retry safely. An uncertain attachment upload is retained for storage recovery.`,
          );
      } finally {
        if (alive.current) setBusy("");
      }
    })();
    pending.current = operation;
    void operation.finally(() => {
      if (pending.current === operation) pending.current = null;
    });
  }

  return (
    <section
      className="panel settings-section portable-panel"
      data-tour="markdown-folders"
    >
      <h2>Markdown folders</h2>
      <p>
        Take notes and attachments between ProjectAnvil and a folder of Markdown
        files. Import creates new copies after review; existing work stays in
        place.
      </p>
      <p className="small-text">
        Requires the local server. Up to 200 notes, 400 files, 24 MB of content,
        and 20 MB per attachment. ZIP files can be up to 25 MB.
      </p>
      {!connected && (
        <p className="portable-notice" role="status">
          Reconnect to the local server to import or export attachments.
        </p>
      )}
      <div className="portable-actions">
        <label className="form-label">
          Export scope
          <select
            className="field"
            value={exportProject}
            disabled={!!busy}
            onChange={(event) => setExportProject(event.target.value)}
          >
            <option value="">All available notes and files</option>
            {workspace.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          ref={exportButton}
          disabled={
            !!busy ||
            !connected ||
            !workspace.notes.some(
              (note) => !exportProject || note.projectId === exportProject,
            )
          }
          onClick={() => void exportFolder()}
        >
          <Download size={17} />
          {busy === "export" ? "Preparing export…" : "Export Markdown ZIP"}
        </button>
      </div>
      <div className="portable-actions">
        <button
          className="btn"
          disabled={!!busy || !permissions.canCreate || !connected}
          onClick={() => folderInput.current?.click()}
        >
          <FolderOpen size={17} />
          Choose folder
        </button>
        <button
          className="btn"
          disabled={!!busy || !permissions.canCreate || !connected}
          onClick={() => zipInput.current?.click()}
          ref={chooseButton}
        >
          <Upload size={17} />
          Choose ZIP
        </button>
        {busy === "reading" && (
          <span role="status">Reading files for review…</span>
        )}
      </div>
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(event) => void choose(event.target.files, true)}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => void choose(event.target.files, false)}
      />
      {!permissions.canCreate && (
        <p className="small-text">
          Viewer access supports export. An editor, admin, or owner can import
          new notes.
        </p>
      )}
      {pendingImports && !selection && !result && (
        <p className="portable-notice">
          An earlier import needs confirmation. Choose the same unchanged folder
          or ZIP and target project to retry without creating duplicate copies.
        </p>
      )}
      {error && (
        <p
          ref={errorMessage}
          tabIndex={-1}
          role="alert"
          className="portable-notice portable-error"
        >
          {error}
        </p>
      )}
      {selection && (
        <div className="portable-review">
          <div className="portable-review-heading">
            <h3 ref={reviewHeading} tabIndex={-1}>
              Review import
            </h3>
            <button
              className="btn-icon"
              disabled={!!busy}
              aria-label="Cancel Markdown import"
              onClick={() => {
                returnFocus.current = "choose";
                setSelection(null);
                setError("");
              }}
            >
              <X size={17} />
            </button>
          </div>
          <p>
            <strong>{selection.name}</strong> · {selection.bundle.notes.length}{" "}
            {selection.bundle.notes.length === 1 ? "note" : "notes"} ·{" "}
            {selection.bundle.attachments.length}{" "}
            {selection.bundle.attachments.length === 1
              ? "attachment"
              : "attachments"}
          </p>
          <label className="form-label">
            Import into project
            <select
              className="field"
              disabled={!!busy}
              value={importProject}
              onChange={(event) => setImportProject(event.target.value)}
            >
              <option value="">No project</option>
              {writableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <ul className="portable-file-list" aria-label="Notes to import">
            {selection.bundle.notes.slice(0, 8).map((note) => (
              <li key={note.path}>
                <strong>{note.title}</strong>
                <span>{note.path}</span>
              </li>
            ))}
          </ul>
          {selection.bundle.notes.length > 8 && (
            <p className="small-text">
              And {selection.bundle.notes.length - 8} more notes.
            </p>
          )}
          <p className="small-text">
            Folders and available links travel with the notes. Matching titles
            get a new name. Imported history, memberships, permissions, task
            assignments, and discussion authors are not restored. Use a complete
            backup for those records.
          </p>
          {selection.bundle.warnings.length > 0 && (
            <ul className="portable-warnings">
              {selection.bundle.warnings.slice(0, 6).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          <button
            className="btn btn-primary"
            disabled={!!busy || !canImport}
            onClick={importFolder}
          >
            {busy === "import"
              ? "Importing reviewed files…"
              : "Import as new notes"}
          </button>
        </div>
      )}
      {result && (
        <div className="portable-notice" role="status">
          <h3 ref={resultHeading} tabIndex={-1}>
            Import complete
          </h3>
          <p>
            {result.notes} {result.notes === 1 ? "note" : "notes"} and{" "}
            {result.attachments}{" "}
            {result.attachments === 1 ? "attachment" : "attachments"} added.
          </p>
          {result.warnings.length > 0 && (
            <details>
              <summary>Import details ({result.warnings.length})</summary>
              <ul>
                {result.warnings.slice(0, 30).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
              {result.warnings.length > 30 && (
                <p>
                  {result.warnings.length - 30} more notes received
                  collision-safe names.
                </p>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
