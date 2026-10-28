"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Columns3,
  Database,
  FileText,
  Folder,
  GalleryHorizontalEnd,
  GripVertical,
  Hash,
  LayoutList,
  ListFilter,
  LoaderCircle,
  Network,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  Users,
  X,
} from "lucide-react";
import type {
  FeatureProps,
  Note,
  NoteType,
  NotePropertyField,
  Workspace,
} from "../lib/types";
import "./collections.css";
import { readBrowserPreference } from "../lib/browser-preferences";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspacePermissions } from "./WorkspacePermissions";
import {
  collectionTypeName,
  groupCollectionItems,
  normalizeCollectionKeys,
  storedCollectionColumns,
  structuredPropertyKey,
} from "../lib/collection-keys";

type Layout = "table" | "list" | "gallery" | "kanban";
type Preferences = {
  layout: Layout;
  query: string;
  project: string;
  kind: string;
  tag: string;
  sort: string;
  descending: boolean;
  group: string;
  columns: string[];
  columnsConfigured: boolean;
  extraColumns: string[];
  summaryProperty: string;
  summaryOperation: "sum" | "average" | "count";
};
const defaults: Preferences = {
  layout: "table",
  query: "",
  project: "",
  kind: "",
  tag: "",
  sort: "title",
  descending: false,
  group: "none",
  columns: [],
  columnsConfigured: false,
  extraColumns: [],
  summaryProperty: "",
  summaryOperation: "sum",
};
const layouts: { id: Layout; label: string; icon: typeof Table2 }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "list", label: "List", icon: LayoutList },
  { id: "gallery", label: "Gallery", icon: GalleryHorizontalEnd },
  { id: "kanban", label: "Board", icon: Columns3 },
];
const kinds = [
  "note",
  "world",
  "character",
  "research",
  "daily",
  "meeting",
  "decision",
];
const kindIcons: Record<string, typeof BookOpen> = {
  note: FileText,
  world: Network,
  character: Users,
  research: BookOpen,
  daily: CalendarDays,
  meeting: Users,
};
const label = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const countWords = (note: Note) =>
  note.content.trim().split(/\s+/).filter(Boolean).length;
const textExcerpt = (content: string) =>
  content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`[\]>_=]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const numeric = (text: string) =>
  text.trim() !== "" && Number.isFinite(Number(text));
const format = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function storedPreferences(key: string, workspace: Workspace): Preferences {
  try {
    const saved: unknown = JSON.parse(readBrowserPreference(key) || "null");
    if (!saved || typeof saved !== "object") return defaults;
    const value = saved as Partial<Preferences>;
    const result = { ...defaults };
    for (const field of [
      "query",
      "project",
      "kind",
      "tag",
      "sort",
      "group",
      "summaryProperty",
    ] as const) {
      if (typeof value[field] === "string")
        result[field] = value[field].slice(0, 500);
    }
    result.layout = layouts.some((item) => item.id === value.layout)
      ? value.layout!
      : "table";
    result.descending = value.descending === true;
    result.columnsConfigured = value.columnsConfigured === true;
    result.summaryOperation = ["sum", "average", "count"].includes(
      value.summaryOperation || "",
    )
      ? value.summaryOperation!
      : "sum";
    result.columns = storedCollectionColumns(value.columns, true);
    result.extraColumns = storedCollectionColumns(value.extraColumns, false);
    return normalizeCollectionKeys(result, workspace.noteTypes || [], [
      ...workspace.notes.flatMap((note) => Object.keys(note.properties)),
      ...result.extraColumns,
    ]);
  } catch {
    return defaults;
  }
}

function PropertyCell({
  value,
  onCommit,
  name,
  numeric: asNumber = false,
  readOnly = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  name: string;
  numeric?: boolean;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={`base-property-input ${asNumber ? "numeric" : ""}`}
      aria-label={name}
      title={
        readOnly
          ? "View only. Editing access is required to change this property."
          : "Edit this property. Enter or Tab saves; Escape cancels."
      }
      readOnly={readOnly}
      value={draft}
      placeholder="—"
      inputMode={asNumber ? "decimal" : "text"}
      onFocus={() => {
        focused.current = true;
        cancelled.current = false;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false;
        if (!readOnly && !cancelled.current && draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export default function Collections({
  workspace,
  mutate,
  projectFilter,
  openNote,
  notify,
}: FeatureProps) {
  const { canCreate, canEditProject } = useWorkspacePermissions(workspace);
  const permissionsRef = useRef(canEditProject);
  permissionsRef.current = canEditProject;
  const scope = useDraftScope();
  const storageKey = `projectanvil.collections.${encodeURIComponent(scope.accountId)}.${encodeURIComponent(scope.workspaceId)}`;
  const [prefs, setPrefs] = useState<Preferences>(() =>
    storedPreferences(storageKey, workspace),
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const [propertyName, setPropertyName] = useState("");
  const [dragging, setDragging] = useState("");
  const [dragColumn, setDragColumn] = useState("");
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Record<string, Record<string, string>>
  >({});
  const workspaceRef = useRef(workspace);
  const mutateRef = useRef(mutate);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const propertyVersions = useRef(new Map<string, number>());
  const counter = useRef(0);
  const mounted = useRef(true);
  workspaceRef.current = workspace;
  mutateRef.current = mutate;
  const update = (patch: Partial<Preferences>) =>
    setPrefs((current) => ({ ...current, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      /* Preferences remain usable when browser storage is unavailable. */
    }
  }, [prefs, storageKey]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setPrefs(storedPreferences(storageKey, workspaceRef.current));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const saveProperty = (noteId: string, key: string, value: string) => {
    const note = workspaceRef.current.notes.find((item) => item.id === noteId);
    if (!note || !permissionsRef.current(note.projectId)) return;
    let succeeded = false;
    const version = ++counter.current;
    const versionKey = `${noteId}:${key}`;
    propertyVersions.current.set(versionKey, version);
    setOptimistic((current) => ({
      ...current,
      [noteId]: { ...current[noteId], [key]: value },
    }));
    setSaving((count) => count + 1);
    setSaveError(false);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        const current = workspaceRef.current.notes.find(
          (note) => note.id === noteId,
        );
        if (!current) throw new Error("Note removed");
        if (!permissionsRef.current(current.projectId))
          throw new Error(
            "This note is now view only. Your edit has not been saved.",
          );
        const next = await mutateRef.current({
          action: "upsert",
          entity: "notes",
          item: {
            id: noteId,
            properties: { ...current.properties, [key]: value },
          },
          base: { id: noteId, properties: current.properties },
        });
        if (next.revision >= workspaceRef.current.revision)
          workspaceRef.current = next;
        succeeded = true;
      })
      .catch(() => {
        if (mounted.current) {
          setSaveError(true);
          notify(
            "The property could not be saved. Please try editing it again.",
          );
        }
      })
      .finally(() => {
        if (!mounted.current) return;
        setSaving((count) => Math.max(0, count - 1));
        if (succeeded && propertyVersions.current.get(versionKey) === version)
          setOptimistic((current) => {
            const note = { ...current[noteId] };
            delete note[key];
            const next = { ...current };
            if (Object.keys(note).length) next[noteId] = note;
            else delete next[noteId];
            return next;
          });
      });
  };

  const allNotes = useMemo(
    () =>
      workspace.notes.map((note) =>
        optimistic[note.id]
          ? {
              ...note,
              properties: { ...note.properties, ...optimistic[note.id] },
            }
          : note,
      ),
    [workspace.notes, optimistic],
  );
  // Only snapshot changes rebuild text, type, and project lookups. Menu and drag
  // state can reuse this model without repeatedly parsing every note body.
  const {
    structuredColumns,
    typeLabel,
    projectName,
    usedTypes,
    searchText,
    words,
    excerpt,
  } = useMemo(() => {
    const structuredColumns = new Map<
      string,
      { type: NoteType; field: NotePropertyField }
    >(
      (workspace.noteTypes || []).flatMap((type) =>
        type.fields.map(
          (field) =>
            [
              structuredPropertyKey(type.id, field.id),
              { type, field },
            ] as const,
        ),
      ),
    );

    const types = new Map(
      (workspace.noteTypes || []).map((type) => [type.id, type]),
    );
    const projects = new Map(
      workspace.projects.map((project) => [project.id, project.name]),
    );
    const usedTypes = new Set(allNotes.map((note) => note.customTypeId));
    const typeLabel = (note: Note) => {
      const type = types.get(note.customTypeId || "");
      return type ? collectionTypeName(type.name, kinds) : label(note.kind);
    };
    const projectName = (id: string) => projects.get(id) || "No project";
    const searchText = new Map<string, string>();
    const text = new Map<string, { words: number; excerpt: string }>();
    for (const note of allNotes) {
      searchText.set(
        note.id,
        [
          note.title,
          note.content,
          note.folder,
          ...note.tags,
          ...Object.values(note.properties),
          ...Object.values(note.propertyValues || {}),
          typeLabel(note),
          ...Object.values(note.decision || {}),
        ]
          .join(" ")
          .toLowerCase(),
      );
      if (!text.has(note.content))
        text.set(note.content, {
          words: countWords(note),
          excerpt: textExcerpt(note.content).slice(0, 140),
        });
    }
    return {
      structuredColumns,
      typeLabel,
      projectName,
      usedTypes,
      searchText,
      words: (note: Note) => text.get(note.content)?.words || 0,
      excerpt: (content: string) => text.get(content)?.excerpt || "",
    };
  }, [allNotes, workspace.noteTypes, workspace.projects]);
  const {
    propertyLabel,
    propertyValue,
    properties,
    visibleColumns,
    tags,
    filtered,
    filteredById,
    notesByStatus,
    groups,
    statusKey,
    statuses,
    status,
    numericProperties,
    summaryKey,
    calculated,
    hasFilters,
    totalWords,
    scopedToProject,
    activeProject,
  } = useMemo(() => {
    const propertyLabel = (key: string) => {
      const column = structuredColumns.get(key);
      return column
        ? `${collectionTypeName(column.type.name, kinds)} · ${column.field.name}`
        : key;
    };
    const propertyValue = (note: Note, key: string) => {
      const column = structuredColumns.get(key);
      if (!column) return note.properties[key] || "";
      if (note.customTypeId !== column.type.id) return "";
      const value = note.propertyValues?.[column.field.id] || "";
      return column.field.type === "checkbox" && value
        ? value === "true"
          ? "Yes"
          : "No"
        : value;
    };
    const properties = [
      ...new Set([
        ...allNotes.flatMap((note) => Object.keys(note.properties)),
        ...prefs.extraColumns,
        ...[...structuredColumns]
          .filter(([, column]) => usedTypes.has(column.type.id))
          .map(([key]) => key),
      ]),
    ].sort();
    const visibleColumns = (
      prefs.columnsConfigured ? prefs.columns : properties.slice(0, 4)
    ).filter((key) => properties.includes(key));
    const tags = [...new Set(allNotes.flatMap((note) => note.tags))].sort();
    const scopedToProject = !!projectFilter && projectFilter !== "all";
    const activeProject = scopedToProject ? projectFilter : prefs.project;
    const fieldValue = (note: Note, field: string): string =>
      field.startsWith("prop:")
        ? propertyValue(note, field.slice(5))
        : field === "project"
          ? projectName(note.projectId)
          : field === "folder"
            ? note.folder || "Unfiled"
            : field === "kind"
              ? typeLabel(note)
              : field === "updated"
                ? note.updatedAt
                : note.title;
    const query = prefs.query.trim().toLowerCase();
    const filtered = allNotes
      .filter(
        (note) =>
          (!activeProject || note.projectId === activeProject) &&
          (!prefs.kind ||
            (prefs.kind.startsWith("custom:")
              ? note.customTypeId === prefs.kind.slice(7)
              : note.kind === prefs.kind)) &&
          (!prefs.tag || note.tags.includes(prefs.tag)) &&
          (!query || searchText.get(note.id)?.includes(query)),
      )
      .sort((a, b) => {
        const av = fieldValue(a, prefs.sort),
          bv = fieldValue(b, prefs.sort);
        const result =
          numeric(av) && numeric(bv)
            ? Number(av) - Number(bv)
            : av.localeCompare(bv, undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return (prefs.descending ? -1 : 1) * result;
      });
    const groups =
      prefs.group === "none"
        ? [{ name: "All notes", notes: filtered }]
        : groupCollectionItems(filtered, (note) =>
            fieldValue(note, prefs.group),
          );
    const statusKey =
      properties.find((key) => key.toLowerCase() === "status") || "Status";
    const statuses = [
      ...new Set([
        "Draft",
        "In progress",
        "Review",
        "Complete",
        ...allNotes.map((note) => note.properties[statusKey]).filter(Boolean),
      ]),
    ];
    const status = (note: Note) => note.properties[statusKey] || "Draft";
    const filteredById = new Map(filtered.map((note) => [note.id, note]));
    const notesByStatus = new Map(
      groupCollectionItems(filtered, status).map((group) => [
        group.name,
        group.notes,
      ]),
    );
    const numericProperties = properties.filter((key) => {
      const values = filtered
        .map((note) => propertyValue(note, key))
        .filter((value) => value.trim());
      return values.length > 0 && values.every(numeric);
    });
    const summaryKey =
      prefs.summaryProperty && properties.includes(prefs.summaryProperty)
        ? prefs.summaryProperty
        : numericProperties[0] || properties[0] || "";
    const summaryValues = filtered
      .map((note) => propertyValue(note, summaryKey))
      .filter((value) => value.trim());
    const summaryNumbers = summaryValues.filter(numeric).map(Number);
    const sum = summaryNumbers.reduce((total, value) => total + value, 0);
    const calculated =
      prefs.summaryOperation === "count"
        ? summaryValues.length
        : prefs.summaryOperation === "average"
          ? summaryNumbers.length
            ? sum / summaryNumbers.length
            : 0
          : sum;
    const hasFilters = !!(
      prefs.query ||
      (!scopedToProject && prefs.project) ||
      prefs.kind ||
      prefs.tag
    );
    const totalWords = filtered.reduce((sum, note) => sum + words(note), 0);

    return {
      propertyLabel,
      propertyValue,
      properties,
      visibleColumns,
      tags,
      filtered,
      filteredById,
      notesByStatus,
      groups,
      statusKey,
      statuses,
      status,
      numericProperties,
      summaryKey,
      calculated,
      hasFilters,
      totalWords,
      scopedToProject,
      activeProject,
    };
  }, [
    allNotes,
    structuredColumns,
    typeLabel,
    projectName,
    usedTypes,
    searchText,
    words,
    prefs,
    projectFilter,
  ]);
  const groupingOptions = (
    <>
      <option value="none">No grouping</option>
      <option value="folder">Folder</option>
      <option value="kind">Note type</option>
      <option value="project">Project</option>
      {properties.map((key) => (
        <option key={key} value={`prop:${key}`}>
          {propertyLabel(key)}
        </option>
      ))}
    </>
  );
  const statusSelect = (note: Note) => (
    <select
      className="base-status-select"
      value={status(note)}
      aria-label={`Status of ${note.title}`}
      disabled={!canEditProject(note.projectId)}
      onChange={(event) => saveProperty(note.id, statusKey, event.target.value)}
    >
      {statuses.map((value) => (
        <option key={value}>{value}</option>
      ))}
    </select>
  );
  const icon = (note: Note, size = 16) => {
    const Icon = kindIcons[note.kind] || FileText;
    return <Icon size={size} />;
  };

  const table = (notes: Note[]) => (
    <div
      className="base-table-scroll"
      role="region"
      aria-label="Collection notes table"
      tabIndex={0}
    >
      <table className="base-table">
        <thead>
          <tr>
            <th className="base-title-column">Name</th>
            <th>Type</th>
            <th>Folder / project</th>
            <th>Tags</th>
            {visibleColumns.map((key) => (
              <th key={key}>
                <span>
                  {numericProperties.includes(key) ? (
                    <Hash size={11} />
                  ) : (
                    <Database size={10} />
                  )}{" "}
                  {propertyLabel(key)}
                </span>
              </th>
            ))}
            <th>Words</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {notes.map((note) => (
            <tr key={note.id}>
              <td>
                <button
                  className="base-note-link"
                  onClick={() => openNote(note.id)}
                >
                  {icon(note)}
                  <strong>{note.title || "Untitled note"}</strong>
                </button>
              </td>
              <td>
                <span className={`base-kind type-${note.kind}`}>
                  {typeLabel(note)}
                </span>
              </td>
              <td>
                <div className="base-location">
                  <span>{note.folder || "Unfiled"}</span>
                  <small>{projectName(note.projectId)}</small>
                </div>
              </td>
              <td>
                <div className="base-tags">
                  {note.tags.slice(0, 3).map((tag) => (
                    <button key={tag} onClick={() => update({ tag })}>
                      #{tag}
                    </button>
                  ))}
                  {note.tags.length > 3 && <span>+{note.tags.length - 3}</span>}
                </div>
              </td>
              {visibleColumns.map((key) => (
                <td className="base-editable-cell" key={key}>
                  {structuredColumns.has(key) &&
                  note.customTypeId !== structuredColumns.get(key)?.type.id ? (
                    <span className="muted">—</span>
                  ) : structuredColumns.has(key) ? (
                    <button
                      className="base-note-link"
                      aria-label={`Edit ${propertyLabel(key)} for ${note.title}`}
                      onClick={() => openNote(note.id)}
                    >
                      {propertyValue(note, key) || "—"}
                    </button>
                  ) : key.toLowerCase() === "status" ? (
                    statusSelect(note)
                  ) : (
                    <PropertyCell
                      value={note.properties[key] || ""}
                      name={`${key} for ${note.title}`}
                      numeric={numericProperties.includes(key)}
                      readOnly={!canEditProject(note.projectId)}
                      onCommit={(value) => saveProperty(note.id, key, value)}
                    />
                  )}
                </td>
              ))}
              <td className="base-word-count">
                {words(note).toLocaleString()}
              </td>
              <td className="base-date">{date(note.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const list = (notes: Note[]) => (
    <div className="base-list">
      {notes.map((note) => (
        <div className="base-list-row" key={note.id}>
          <span className={`base-list-icon type-${note.kind}`}>
            {icon(note, 20)}
          </span>
          <button className="base-list-main" onClick={() => openNote(note.id)}>
            <strong>{note.title || "Untitled note"}</strong>
            <span>
              {excerpt(note.content).slice(0, 140) ||
                "Empty note"}
            </span>
            <small>
              {note.folder || "Unfiled"} <i>·</i> {projectName(note.projectId)}
            </small>
          </button>
          <div className="base-list-props">
            {statusSelect(note)}
            <span>{words(note)} words</span>
          </div>
          <button
            className="btn-icon"
            aria-label={`Open ${note.title}`}
            onClick={() => openNote(note.id)}
          >
            <BookOpen size={15} />
          </button>
        </div>
      ))}
    </div>
  );
  const gallery = (notes: Note[]) => (
    <div className="base-gallery">
      {notes.map((note) => (
        <article className="base-gallery-card" key={note.id}>
          <button
            className={`base-gallery-art type-${note.kind}`}
            onClick={() => openNote(note.id)}
            aria-label={`Open ${note.title}`}
          >
            {icon(note, 36)}
            <span>{typeLabel(note)}</span>
            <span className="base-art-orbit" />
          </button>
          <div className="base-gallery-content">
            <button
              className="base-gallery-title"
              onClick={() => openNote(note.id)}
            >
              {note.title || "Untitled note"}
            </button>
            <p>
              {excerpt(note.content).slice(0, 130) ||
                "Empty note"}
            </p>
            <div className="base-tags">
              {note.tags.slice(0, 3).map((tag) => (
                <button key={tag} onClick={() => update({ tag })}>
                  #{tag}
                </button>
              ))}
            </div>
            <div className="base-gallery-footer">
              <span>
                <Folder size={10} />
                {note.folder || "Unfiled"}
              </span>
              {statusSelect(note)}
            </div>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div className="page bases-page">
      <div className="page-heading">
        <div>
          <h1>Collections</h1>
          <p>
            Organize notes and their properties in tables, lists, galleries, or
            boards.
          </p>
        </div>
        <div className="heading-actions">
          <span
            className={`base-saving ${saveError ? "error" : ""}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {saving ? (
              <>
                <LoaderCircle size={12} className="base-spin" />
                Saving…
              </>
            ) : saveError ? (
              "Property not saved · edit it to retry"
            ) : (
              <>
                <Check size={12} />
                All changes saved
              </>
            )}
          </span>
          <button
            ref={propertiesButton}
            className={`btn ${optionsOpen ? "base-options-active" : ""}`}
            aria-expanded={optionsOpen}
            aria-controls="collection-properties"
            onClick={() => setOptionsOpen((value) => !value)}
          >
            <SlidersHorizontal size={14} />
            Properties
          </button>
        </div>
      </div>

      <div className="base-topline">
        <div
          className="base-view-tabs"
          role="group"
          aria-label="Collection layout"
        >
          {layouts.map(({ id, label: labelText, icon: Icon }) => (
            <button
              key={id}
              aria-pressed={prefs.layout === id}
              className={prefs.layout === id ? "selected" : ""}
              onClick={() => update({ layout: id })}
            >
              <Icon size={14} />
              {labelText}
            </button>
          ))}
        </div>
        <span className="base-preference-hint">View saved on this device</span>
      </div>
      <div className="base-filterbar">
        <label className="base-search">
          <Search size={14} />
          <input
            aria-label="Search collection"
            value={prefs.query}
            onChange={(event) => update({ query: event.target.value })}
            placeholder="Search notes…"
          />
          {prefs.query && (
            <button
              aria-label="Clear search"
              onClick={() => update({ query: "" })}
            >
              <X size={12} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter collection by project"
          value={activeProject}
          disabled={scopedToProject}
          title={
            scopedToProject
              ? "Project scope is selected in navigation"
              : undefined
          }
          onChange={(event) => update({ project: event.target.value })}
        >
          <option value="">All projects</option>
          {workspace.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter collection by type"
          value={prefs.kind}
          onChange={(event) => update({ kind: event.target.value })}
        >
          <option value="">All types</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {label(kind)}
            </option>
          ))}
          {(workspace.noteTypes || []).map((type) => (
            <option key={type.id} value={`custom:${type.id}`}>
              {collectionTypeName(type.name, kinds)}
              {type.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter collection by tag"
          value={prefs.tag}
          onChange={(event) => update({ tag: event.target.value })}
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="base-clear-filters"
            onClick={() =>
              update({ query: "", project: "", kind: "", tag: "" })
            }
          >
            Clear filters
          </button>
        )}
        <span className="base-result-count" role="status" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "note" : "notes"}
        </span>
      </div>
      {scopedToProject && (
        <p className="base-scope-hint">
          Project scope: {projectName(activeProject)}
        </p>
      )}

      <div className="base-arrange-bar">
        <label>
          <ArrowDownAZ size={12} />
          <span>Sort</span>
          <select
            aria-label="Sort collection"
            value={prefs.sort}
            onChange={(event) => update({ sort: event.target.value })}
          >
            <option value="title">Name</option>
            <option value="updated">Updated</option>
            <option value="folder">Folder</option>
            <option value="kind">Type</option>
            <option value="project">Project</option>
            {properties.map((key) => (
              <option key={key} value={`prop:${key}`}>
                {propertyLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="base-sort-direction"
          title={prefs.descending ? "Descending order" : "Ascending order"}
          aria-label={prefs.descending ? "Sort ascending" : "Sort descending"}
          aria-pressed={prefs.descending}
          onClick={() => update({ descending: !prefs.descending })}
        >
          {prefs.descending ? (
            <ArrowDownAZ size={14} />
          ) : (
            <ArrowUpAZ size={14} />
          )}
        </button>
        {prefs.layout !== "kanban" ? (
          <label>
            <ListFilter size={12} />
            <span>Group</span>
            <select
              aria-label="Group collection"
              value={prefs.group}
              onChange={(event) => update({ group: event.target.value })}
            >
              {groupingOptions}
            </select>
          </label>
        ) : (
          <span className="base-board-hint" id="collection-board-help">
            <GripVertical size={12} />
            Scroll across columns · Change status from each card’s menu
          </span>
        )}
        <span className="base-edit-hint">
          {prefs.layout === "table"
            ? "Freeform fields save with Enter or Tab. Open structured fields to edit in the note."
            : ""}
        </span>
      </div>

      {optionsOpen && (
        <section
          className="base-options panel"
          id="collection-properties"
          aria-labelledby="collection-properties-title"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setOptionsOpen(false);
            propertiesButton.current?.focus();
          }}
        >
          <div className="base-options-heading">
            <div>
              <h3 id="collection-properties-title">
                Properties & calculations
              </h3>
              <p>
                Properties live on each note. Edit freeform values in the table;
                open a structured field to edit it in the note.
              </p>
            </div>
            <button
              className="btn-icon"
              aria-label="Close collection properties"
              onClick={() => {
                setOptionsOpen(false);
                propertiesButton.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div className="base-options-body">
            <div>
              <label className="base-options-caption">Visible columns</label>
              <div className="base-column-checks">
                {properties.map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(key)}
                      onChange={(event) =>
                        update({
                          columnsConfigured: true,
                          columns: event.target.checked
                            ? [...visibleColumns, key]
                            : visibleColumns.filter((value) => value !== key),
                        })
                      }
                    />
                    {propertyLabel(key)}
                  </label>
                ))}
                {!properties.length && (
                  <span>No properties yet. Add your first column below.</span>
                )}
              </div>
              <form
                className="base-add-property"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = propertyName.trim();
                  if (!name) return;
                  update({
                    columnsConfigured: true,
                    extraColumns: [...new Set([...prefs.extraColumns, name])],
                    columns: [...new Set([...visibleColumns, name])],
                  });
                  setPropertyName("");
                }}
              >
                <input
                  className="field"
                  aria-label="New collection property name"
                  value={propertyName}
                  onChange={(event) => setPropertyName(event.target.value)}
                  placeholder="e.g. Complexity or Estimated hours"
                  maxLength={80}
                />
                <button
                  className="btn"
                  type="submit"
                  disabled={!propertyName.trim()}
                >
                  <Plus size={13} />
                  Add
                </button>
              </form>
            </div>
            <div>
              <label className="base-options-caption">
                Calculate a property
              </label>
              <div className="base-calculation-options">
                <select
                  className="field"
                  aria-label="Calculation property"
                  value={summaryKey}
                  onChange={(event) =>
                    update({ summaryProperty: event.target.value })
                  }
                >
                  <option value="">Choose a property</option>
                  {properties.map((key) => (
                    <option key={key} value={key}>
                      {propertyLabel(key)}
                    </option>
                  ))}
                </select>
                <select
                  className="field"
                  aria-label="Calculation operation"
                  value={prefs.summaryOperation}
                  onChange={(event) =>
                    update({
                      summaryOperation: event.target
                        .value as Preferences["summaryOperation"],
                    })
                  }
                >
                  <option value="sum">Sum of numbers</option>
                  <option value="average">Average of numbers</option>
                  <option value="count">Count filled values</option>
                </select>
              </div>
              <p className="base-calculation-note">
                Calculations use the notes matching your filters. Sum and
                average include numeric values; count includes any filled value.
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="base-content">
        {filtered.length ? (
          prefs.layout === "kanban" ? (
            <div
              className="base-board"
              role="region"
              aria-label="Notes grouped by status"
              aria-describedby="collection-board-help"
              tabIndex={0}
            >
              {statuses.map((column, index) => {
                const notes = notesByStatus.get(column) || [];
                return (
                  <section
                    className={`base-board-column ${dragColumn === column ? "drop-active" : ""}`}
                    key={column}
                    onDragOver={(event) => {
                      const dragged = filteredById.get(dragging);
                      if (
                        !canCreate ||
                        !dragged ||
                        !canEditProject(dragged.projectId)
                      )
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragColumn(column);
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      )
                        setDragColumn("");
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id =
                        event.dataTransfer.getData(
                          "application/projectanvil-note",
                        ) || dragging;
                      setDragging("");
                      setDragColumn("");
                      if (filteredById.has(id))
                        saveProperty(id, statusKey, column);
                    }}
                  >
                    <div className="base-column-heading">
                      <span className={`base-column-dot color-${index % 5}`} />
                      <h3>{column}</h3>
                      <span>{notes.length}</span>
                    </div>
                    <div className="base-board-cards">
                      {notes.map((note) => (
                        <article
                          key={note.id}
                          className={`base-board-card ${dragging === note.id ? "dragging" : ""}`}
                          draggable={canEditProject(note.projectId)}
                          onDragStart={(event) => {
                            if (!canEditProject(note.projectId)) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer.setData(
                              "application/projectanvil-note",
                              note.id,
                            );
                            event.dataTransfer.effectAllowed = "move";
                            setDragging(note.id);
                          }}
                          onDragEnd={() => {
                            setDragging("");
                            setDragColumn("");
                          }}
                        >
                          <div className="base-board-type">
                            {icon(note, 12)}
                            {typeLabel(note)}
                            <GripVertical size={12} />
                          </div>
                          <button
                            className="base-board-title"
                            onClick={() => openNote(note.id)}
                          >
                            {note.title}
                          </button>
                          <p>{excerpt(note.content).slice(0, 95)}</p>
                          <div className="base-tags">
                            {note.tags.slice(0, 2).map((tag) => (
                              <button key={tag} onClick={() => update({ tag })}>
                                #{tag}
                              </button>
                            ))}
                          </div>
                          <div className="base-board-footer">
                            {statusSelect(note)}
                            <span>{words(note)}w</span>
                          </div>
                        </article>
                      ))}
                      {!notes.length && (
                        <div className="base-board-empty">
                          No notes with this status
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            groups.map((group) => (
              <section
                className={`base-group ${prefs.group === "none" ? "ungrouped" : ""}`}
                key={group.name}
              >
                {prefs.group !== "none" && (
                  <div className="base-group-heading">
                    <ChevronDown size={13} />
                    <h2>{group.name}</h2>
                    <span>{group.notes.length}</span>
                    <small>
                      {group.notes
                        .reduce((sum, note) => sum + words(note), 0)
                        .toLocaleString()}{" "}
                      words
                    </small>
                  </div>
                )}
                {prefs.layout === "table" ? (
                  <div className="panel">{table(group.notes)}</div>
                ) : prefs.layout === "list" ? (
                  <div className="panel">{list(group.notes)}</div>
                ) : (
                  gallery(group.notes)
                )}
              </section>
            ))
          )
        ) : (
          <div className="panel base-empty">
            <div>
              <Database size={29} />
            </div>
            <h2>
              {hasFilters
                ? "No notes match your filters"
                : "No notes in this collection"}
            </h2>
            <p>
              {hasFilters
                ? "Clear or change your filters to see more notes."
                : scopedToProject
                  ? "Create a note in Notes and assign it to this project."
                  : "Create a note in Notes to start your collection."}
            </p>
            {hasFilters && (
              <button
                className="btn"
                onClick={() =>
                  update({ query: "", project: "", kind: "", tag: "" })
                }
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="base-summary">
        <div>
          <Database size={15} />
          <span>
            Notes<strong>{filtered.length.toLocaleString()}</strong>
          </span>
        </div>
        <div>
          <FileText size={15} />
          <span>
            Words<strong>{totalWords.toLocaleString()}</strong>
          </span>
        </div>
        <div>
          <Folder size={15} />
          <span>
            Folders
            <strong>
              {new Set(filtered.map((note) => note.folder || "Unfiled")).size}
            </strong>
          </span>
        </div>
        <button
          className="base-summary-calculation"
          aria-expanded={optionsOpen}
          aria-controls="collection-properties"
          onClick={() => setOptionsOpen(true)}
        >
          <Hash size={16} />
          <span>
            {summaryKey
              ? `${label(prefs.summaryOperation)} · ${propertyLabel(summaryKey)}`
              : "Add a calculation"}
            <strong>{summaryKey ? format(calculated) : "—"}</strong>
          </span>
          <SlidersHorizontal size={12} />
        </button>
      </footer>
    </div>
  );
}
