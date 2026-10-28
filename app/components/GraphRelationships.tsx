"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Link2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Settings2,
  X,
} from "lucide-react";
import {
  entityKey,
  entitySignature,
  relationshipImpact,
} from "../lib/relationships";
import {
  relationshipLabel,
  relationshipOptions,
  workspaceEntities,
} from "../lib/relationship-display";
import {
  uid,
  type EntityRef,
  type FeatureProps,
  type Relationship,
  type RelationshipKind,
} from "../lib/types";
import "./relationships.css";
import { moveToTrash } from "../lib/trash-actions";
import { useDraftScope } from "./useRecoverableDraft";
import RelationshipPresetManager from "./RelationshipPresetManager";
import { useWorkspacePermissions } from "./WorkspacePermissions";

type Props = Pick<FeatureProps, "workspace" | "mutate" | "notify"> & {
  impact: ReturnType<typeof relationshipImpact>;
  selectedKey: string;
  onSelect: (ref: EntityRef) => void;
  onOpen: (ref: EntityRef) => void;
};

export default function GraphRelationships({
  workspace,
  mutate,
  notify,
  impact,
  selectedKey,
  onSelect,
  onOpen,
}: Props) {
  const { canCreate, canEditRef } = useWorkspacePermissions(workspace);
  const editable = (relationship: Relationship) =>
    canEditRef(relationship.from) || canEditRef(relationship.to);
  const [composing, setComposing] = useState(false);
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [kind, setKind] = useState<RelationshipKind>("depends-on");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [presetId, setPresetId] = useState("");
  const [presetSnapshot, setPresetSnapshot] = useState("");
  const [managePresets, setManagePresets] = useState(false);
  const preset = workspace.relationshipPresets?.find(
    (item) =>
      item.id === presetId &&
      !item.archived &&
      JSON.stringify(item) === presetSnapshot,
  );

  const entities = useMemo(() => workspaceEntities(workspace), [workspace]);
  const byKey = useMemo(
    () => new Map(entities.map((ref) => [entityKey(ref), ref])),
    [entities],
  );
  const titles = useMemo(
    () =>
      new Map<string, string>([
        ...workspace.notes.map(
          (note) => [`note:${note.id}`, note.title] as const,
        ),
        ...workspace.tasks.map(
          (task) => [`task:${task.id}`, task.title] as const,
        ),
        ...workspace.projects.map(
          (project) => [`project:${project.id}`, project.name] as const,
        ),
      ]),
    [workspace.notes, workspace.tasks, workspace.projects],
  );
  const titleOf = (ref: EntityRef) =>
    titles.get(entityKey(ref)) || "Removed item";
  const relationships = workspace.relationships ?? [];
  const affectedEntities = entities.filter((ref) =>
    impact.affected.has(entityKey(ref)),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRelationships = relationships.filter((relationship) => {
    if (reviewOnly && !impact.relationshipIds.has(relationship.id))
      return false;
    if (!normalizedQuery) return true;
    return [
      titleOf(relationship.from),
      titleOf(relationship.to),
      relationshipLabel(relationship.kind),
      relationship.label,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  function startRelationship() {
    if (!canCreate) return;
    setFromKey(
      byKey.has(selectedKey)
        ? selectedKey
        : entities[0]
          ? entityKey(entities[0])
          : "",
    );
    setToKey("");
    setKind("depends-on");
    setLabel("");
    setPresetId("");
    setError("");
    setComposing(true);
  }

  async function saveRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const from = byKey.get(fromKey);
    const to = byKey.get(toKey);
    if (!from || !to || fromKey === toKey) {
      setError("Choose two different items in this workspace.");
      return;
    }
    if (!canCreate || (!canEditRef(from) && !canEditRef(to))) {
      setError("At least one connected item needs editing access.");
      return;
    }
    if (
      preset &&
      ((preset.fromType !== "any" && from.type !== preset.fromType) ||
        (preset.toType !== "any" && to.type !== preset.toType))
    ) {
      setError(
        "Choose items that match this preset, or choose a custom connection.",
      );
      return;
    }
    setBusy("create");
    setError("");
    try {
      await mutate({
        action: "upsert",
        entity: "relationships",
        item: { id: uid(), from, to, kind, label: label.trim() },
      });
      setComposing(false);
      onSelect(from);
      notify(
        "Relationship saved",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The relationship could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }

  async function reviewRelationship(relationship: Relationship) {
    if (!editable(relationship)) return;
    setBusy(relationship.id);
    setError("");
    try {
      await mutate({
        action: "review-relationship",
        id: relationship.id,
        expectedFromSignature: entitySignature(workspace, relationship.from),
        expectedToSignature: entitySignature(workspace, relationship.to),
      });
      notify("Relationship reviewed");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The review could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }

  const draftScope = useDraftScope();
  async function removeRelationship(id: string) {
    const selected = workspace.relationships.find((item) => item.id === id);
    if (!selected || !editable(selected)) return;
    setBusy(id);
    setError("");
    try {
      const relationship = workspace.relationships.find(
        (item) => item.id === id,
      );
      await moveToTrash(
        mutate,
        notify,
        {
          entity: "relationships",
          id,
          base: relationship ? { ...relationship } : null,
        },
        "Relationship",
        draftScope,
      );
      setRemovingId("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The relationship could not be removed.",
      );
    } finally {
      setBusy("");
    }
  }

  function entityOptions(excludeKey = "", allowed = "any") {
    return (["note", "task", "project"] as const).map((type) => (
      <optgroup
        key={type}
        label={
          type === "note" ? "Notes" : type === "task" ? "Tasks" : "Projects"
        }
      >
        {entities
          .filter(
            (ref) =>
              ref.type === type &&
              entityKey(ref) !== excludeKey &&
              (allowed === "any" || ref.type === allowed),
          )
          .map((ref) => (
            <option key={entityKey(ref)} value={entityKey(ref)}>
              {titleOf(ref)}
            </option>
          ))}
      </optgroup>
    ));
  }

  return (
    <section
      className="relationship-workspace"
      data-tour="meaningful-relationships"
      aria-labelledby="relationship-heading"
    >
      <header className="relationship-heading">
        <div>
          <h2 id="relationship-heading">
            <Link2 size={19} />
            Relationships
          </h2>
          <p>
            Connect notes, tasks, and projects with a relationship and a reason.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={startRelationship}
          disabled={!canCreate || entities.length < 2 || !!busy}
        >
          <Plus size={16} />
          Add relationship
        </button>
      </header>
      <div
        className="relationship-preset-tools"
        data-tour="relationship-presets"
      >
        <p className="muted">
          Use presets for relationships you add often.
        </p>
        <button
          className="btn"
          onClick={() => setManagePresets(true)}
          disabled={!canCreate || !!busy}
        >
          <Settings2 size={16} />
          Relationship presets
        </button>
      </div>
      {managePresets && canCreate && (
        <RelationshipPresetManager
          workspace={workspace}
          mutate={mutate}
          notify={notify}
          onClose={() => setManagePresets(false)}
        />
      )}

      <section
        className="relationship-impact"
        data-tour="impact-review"
        aria-label="Change impact"
      >
        <div className="relationship-impact-summary" role="status">
          {impact.relationshipIds.size ? (
            <TriangleAlert size={20} aria-hidden="true" />
          ) : (
            <Check size={20} aria-hidden="true" />
          )}
          <div>
            <strong>
              {impact.relationshipIds.size
                ? `${impact.affected.size} connected ${impact.affected.size === 1 ? "item needs" : "items need"} review`
                : "No changes to review"}
            </strong>
            <p>
              {impact.relationshipIds.size
                ? "A source changed since its relationship was last reviewed. Check direct and downstream effects before marking it reviewed."
                : "Changes to linked items will appear here for review."}
            </p>
          </div>
        </div>
        {affectedEntities.length > 0 && (
          <div className="relationship-affected-items">
            {affectedEntities.slice(0, 16).map((ref) => (
              <button
                key={entityKey(ref)}
                onClick={() => onSelect(ref)}
                title="Locate on graph"
              >
                <span>{titleOf(ref)}</span>
                <small>
                  {impact.direct.has(entityKey(ref))
                    ? "Direct impact"
                    : "Downstream impact"}
                </small>
              </button>
            ))}
            {affectedEntities.length > 16 && (
              <span className="muted">
                {affectedEntities.length - 16} more highlighted on the graph
              </span>
            )}
          </div>
        )}
      </section>

      {composing && (
        <form
          className="relationship-composer"
          onSubmit={saveRelationship}
          aria-label="Create relationship"
        >
          <div className="relationship-form-heading">
            <h3>Connect two items</h3>
            <button
              type="button"
              className="btn-icon"
              aria-label="Close relationship form"
              onClick={() => setComposing(false)}
              disabled={!!busy}
            >
              <X size={18} />
            </button>
          </div>
          <label className="relationship-label-field">
            Start from a preset
            <select
              className="field"
              value={preset?.id || ""}
              disabled={!canCreate || !!busy}
              onChange={(event) => {
                const selected = workspace.relationshipPresets?.find(
                  (item) => item.id === event.target.value && !item.archived,
                );
                setPresetId(selected?.id || "");
                setPresetSnapshot(selected ? JSON.stringify(selected) : "");
                if (selected) {
                  setKind(selected.kind);
                  setLabel(selected.label);
                  const from = byKey.get(fromKey),
                    to = byKey.get(toKey);
                  if (
                    from &&
                    selected.fromType !== "any" &&
                    from.type !== selected.fromType
                  )
                    setFromKey("");
                  if (
                    to &&
                    selected.toType !== "any" &&
                    to.type !== selected.toType
                  )
                    setToKey("");
                }
              }}
            >
              <option value="">Custom connection</option>
              {(workspace.relationshipPresets || [])
                .filter((item) => !item.archived)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          {preset?.description && <p className="muted">{preset.description}</p>}
          <div className="relationship-form-grid">
            <label>
              First item
              <select
                className="field"
                value={fromKey}
                onChange={(event) => {
                  setFromKey(event.target.value);
                  if (event.target.value === toKey) setToKey("");
                }}
                required
                autoFocus
                disabled={!canCreate || !!busy}
              >
                <option value="">Choose an item</option>
                {entityOptions("", preset?.fromType)}
              </select>
            </label>
            <label>
              Relationship
              <select
                className="field"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as RelationshipKind);
                  setPresetId("");
                }}
                disabled={!canCreate || !!busy}
              >
                {relationshipOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Second item
              <select
                className="field"
                value={toKey}
                onChange={(event) => setToKey(event.target.value)}
                required
                disabled={!canCreate || !!busy}
              >
                <option value="">Choose an item</option>
                {entityOptions(fromKey, preset?.toType)}
              </select>
            </label>
          </div>
          <p className="relationship-direction">
            {
              relationshipOptions.find((option) => option.value === kind)
                ?.explanation
            }
          </p>
          <label className="relationship-label-field">
            Why they are connected <span className="muted">(optional)</span>
            <input
              className="field"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={240}
              placeholder="Describe the reason for this connection"
              disabled={!canCreate || !!busy}
            />
          </label>
          <footer>
            <button
              className="btn"
              type="button"
              onClick={() => setComposing(false)}
              disabled={!!busy}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!canCreate || !!busy}>
              {busy === "create" ? "Saving…" : "Save relationship"}
            </button>
          </footer>
        </form>
      )}

      {error && (
        <p className="relationship-error" role="alert">
          {error}
        </p>
      )}
      <div className="relationship-list-tools">
        <label className="relationship-search">
          <Search size={16} />
          <input
            aria-label="Search relationships"
            placeholder="Find a relationship…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(12);
            }}
          />
        </label>
        <button
          className="btn"
          aria-pressed={reviewOnly}
          onClick={() => {
            setReviewOnly((value) => !value);
            setVisibleCount(12);
          }}
        >
          Needs review ({impact.relationshipIds.size})
        </button>
      </div>
      <div className="relationship-list">
        {visibleRelationships.slice(0, visibleCount).map((relationship) => {
          const needsReview = impact.relationshipIds.has(relationship.id);
          return (
            <article
              key={relationship.id}
              className={`relationship-card${needsReview ? " needs-review" : ""}`}
            >
              <div className="relationship-statement">
                <button onClick={() => onOpen(relationship.from)}>
                  <small>{relationship.from.type}</small>
                  {titleOf(relationship.from)}
                </button>
                <span>
                  <ArrowRight size={15} />
                  {relationshipLabel(relationship.kind)}
                </span>
                <button onClick={() => onOpen(relationship.to)}>
                  <small>{relationship.to.type}</small>
                  {titleOf(relationship.to)}
                </button>
              </div>
              {relationship.label && (
                <p className="relationship-reason">{relationship.label}</p>
              )}
              <footer>
                <span className="relationship-review-state">
                  {needsReview ? (
                    <>
                      <TriangleAlert size={15} />
                      Source changed · review needed
                    </>
                  ) : (
                    <>
                      <Check size={15} />
                      Reviewed against current sources
                    </>
                  )}
                </span>
                <div className="relationship-card-actions">
                  {needsReview && (
                    <button
                      className="btn"
                      disabled={!!busy || !editable(relationship)}
                      onClick={() => reviewRelationship(relationship)}
                    >
                      <Check size={15} />
                      {busy === relationship.id ? "Saving…" : "Mark reviewed"}
                    </button>
                  )}
                  <button
                    className="btn-icon"
                    aria-label={`Remove relationship: ${titleOf(relationship.from)} ${relationshipLabel(relationship.kind)} ${titleOf(relationship.to)}`}
                    onClick={() => setRemovingId(relationship.id)}
                    disabled={!!busy || !editable(relationship)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </footer>
              {removingId === relationship.id && (
                <div className="relationship-remove-confirm">
                  <p>
                    Remove this connection? Both items stay in the workspace.
                  </p>
                  <button
                    className="btn"
                    onClick={() => setRemovingId("")}
                    disabled={!!busy}
                  >
                    Keep connection
                  </button>
                  <button
                    className="btn"
                    onClick={() => removeRelationship(relationship.id)}
                    disabled={!!busy || !editable(relationship)}
                  >
                    Remove connection
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!visibleRelationships.length && (
          <p className="relationship-empty">
            {relationships.length
              ? "No relationships match this view."
              : "Create a linked task from a note, or add a relationship between two existing items."}
            {entities.length < 2 &&
              " Add at least two notes, tasks, or projects to get started."}
          </p>
        )}
      </div>
      {visibleRelationships.length > visibleCount && (
        <button
          className="btn relationship-show-more"
          onClick={() => setVisibleCount((count) => count + 12)}
        >
          Show more relationships
        </button>
      )}
    </section>
  );
}
