"use client";

import type { DecisionRecord, Note, Workspace } from "../lib/types";
import {
  decisionReplacement,
  decisionStatus,
  emptyDecision,
} from "../lib/note-structures";
import "./note-structures.css";

export default function DecisionFields({
  note,
  workspace,
  onChange,
  openNote,
}: {
  note: Note;
  workspace: Workspace;
  onChange: (patch: Partial<Note>) => void;
  openNote: (id: string) => void;
}) {
  if (note.kind !== "decision") return null;
  const decision = note.decision || emptyDecision();
  const acceptedReady = !!decision.outcome.trim() && !!decision.decidedOn;
  function change(patch: Partial<DecisionRecord>) {
    onChange({ decision: { ...decision, ...patch } });
  }
  const successors = workspace.notes.filter(
    (candidate) => candidate.id !== note.id && candidate.kind === "decision",
  );
  const labels = {
    proposed: "Proposed",
    accepted: "Accepted",
    rejected: "Rejected",
    superseded: "Superseded",
  };
  return (
    <details className="decision-fields" data-tour="decision-records">
      <summary>
        Decision record <span>{labels[decision.status]}</span>
      </summary>
      <div className="decision-fields-body">
        <p className="note-structure-help">
          Keep the reasoning with the outcome. Connect evidence through Graph
          relationships using “was decided because of” to flag changes for
          review.
        </p>
        <div className="decision-meta">
          <label className="form-label">
            Decision status
            <select
              className="field"
              value={decision.status}
              onChange={(event) =>
                onChange({
                  decision: decisionStatus(
                    decision,
                    event.target.value as DecisionRecord["status"],
                  ),
                })
              }
            >
              <option value="proposed">Proposed</option>
              <option value="accepted" disabled={!acceptedReady}>
                Accepted
              </option>
              <option value="rejected">Rejected</option>
              <option value="superseded" disabled={!decision.supersededById}>
                Superseded
              </option>
            </select>
          </label>
          <label className="form-label">
            Decision date
            <input
              className="field"
              type="date"
              value={decision.decidedOn}
              onChange={(event) =>
                change({
                  decidedOn: event.target.value,
                  ...(!event.target.value && decision.status === "accepted"
                    ? { status: "proposed" as const }
                    : {}),
                })
              }
            />
          </label>
          <label className="form-label">
            Decision owner
            <select
              className="field"
              value={decision.ownerId}
              onChange={(event) => change({ ownerId: event.target.value })}
            >
              <option value="">No owner</option>
              {decision.ownerId && !workspace.people.some(person => person.id === decision.ownerId) && <option value={decision.ownerId}>Unavailable owner — clear or choose another</option>}
              {workspace.people
                .filter(
                  (person) =>
                    !person.inactive || person.id === decision.ownerId,
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.inactive ? " (inactive)" : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="decision-text-fields">
          {(
            [
              ["context", "Context and question"],
              ["options", "Options considered"],
              ["outcome", "Chosen outcome"],
              ["consequences", "Consequences and tradeoffs"],
            ] as const
          ).map(([field, label]) => (
            <label className="form-label" key={field}>
              {label}
              <textarea
                className="field"
                rows={3}
                maxLength={10000}
                value={decision[field]}
                onChange={(event) =>
                  change({
                    [field]: event.target.value,
                    ...(field === "outcome" &&
                    !event.target.value.trim() &&
                    decision.status === "accepted"
                      ? { status: "proposed" as const }
                      : {}),
                  })
                }
              />
            </label>
          ))}
        </div>
        {!acceptedReady && (
          <p className="note-structure-help">
            Add an outcome and decision date before accepting this decision.
            Clearing either returns it to Proposed.
          </p>
        )}
        <label className="form-label">
          Replaced by
          <select
            className="field"
            value={decision.supersededById}
            onChange={(event) =>
              onChange({
                decision: decisionReplacement(decision, event.target.value),
              })
            }
          >
            <option value="">No replacement</option>
            {decision.supersededById &&
              !successors.some(
                (candidate) => candidate.id === decision.supersededById,
              ) && (
                <option value={decision.supersededById}>
                  Unavailable decision — clear or choose another
                </option>
              )}
            {successors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <p className="note-structure-help">
          Choosing a replacement marks this decision Superseded. Choosing
          another status clears its replacement.
        </p>
        {decision.supersededById &&
          successors.some(
            (candidate) => candidate.id === decision.supersededById,
          ) && (
            <button
              className="btn"
              type="button"
              onClick={() => openNote(decision.supersededById)}
            >
              Open replacement decision
            </button>
          )}
      </div>
    </details>
  );
}
