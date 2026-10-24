import type { DecisionRecord, Note, NoteType, Workspace } from "./types";

/** Empty decisions remain editable drafts until an outcome is accepted. */
export function emptyDecision(): DecisionRecord {
  return {
    status: "proposed",
    context: "",
    options: "",
    outcome: "",
    consequences: "",
    decidedOn: "",
    ownerId: "",
    supersededById: "",
  };
}

/** Replacement and status travel together so autosave never submits half a transition. */
export function decisionReplacement(
  decision: DecisionRecord,
  id: string,
): DecisionRecord {
  return {
    ...decision,
    supersededById: id,
    status: id
      ? "superseded"
      : decision.status === "superseded"
        ? "proposed"
        : decision.status,
  };
}

export function decisionStatus(
  decision: DecisionRecord,
  status: DecisionRecord["status"],
): DecisionRecord {
  return {
    ...decision,
    status,
    supersededById: status === "superseded" ? decision.supersededById : "",
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function isNoteTypeDraft(value: unknown): value is NoteType {
  if (
    !object(value) ||
    !["id", "name", "description"].every(
      (key) => typeof value[key] === "string",
    ) ||
    typeof value.archived !== "boolean" ||
    !Array.isArray(value.fields) ||
    value.fields.length > 30
  )
    return false;
  return value.fields.every(
    (field) =>
      object(field) &&
      ["id", "name", "type"].every((key) => typeof field[key] === "string") &&
      ["text", "number", "date", "checkbox", "select"].includes(
        String(field.type),
      ) &&
      typeof field.required === "boolean" &&
      Array.isArray(field.options) &&
      field.options.every((option) => typeof option === "string"),
  );
}

/** Validate shapes, retaining incomplete text and values for browser recovery. */
export function isDecisionDraft(value: unknown): value is DecisionRecord {
  return (
    object(value) &&
    ["proposed", "accepted", "rejected", "superseded"].includes(
      String(value.status),
    ) &&
    [
      "context",
      "options",
      "outcome",
      "consequences",
      "decidedOn",
      "ownerId",
      "supersededById",
    ].every((key) => typeof value[key] === "string")
  );
}

export function noteStructureDefaults(note: Note): Note {
  return {
    ...note,
    customTypeId: note.customTypeId || "",
    propertyValues: note.propertyValues || {},
    decision:
      note.kind === "decision" ? note.decision || emptyDecision() : null,
  };
}

export function noteTypeLabel(
  note: Note,
  types: NoteType[],
): string | undefined {
  return types.find((type) => type.id === note.customTypeId)?.name;
}

/** Portable reasoning omits account identities, status, dates, and workspace links. */
export function decisionReasoningMarkdown(decision: DecisionRecord): string {
  return (
    [
      ["Context and question", decision.context],
      ["Options considered", decision.options],
      ["Chosen outcome", decision.outcome],
      ["Consequences and tradeoffs", decision.consequences],
    ] as const
  )
    .filter(([, text]) => text.trim())
    .map(([label, text]) => `## ${label}\n\n${text}`)
    .join("\n\n");
}

/** Single-note Markdown remains readable outside the workspace JSON format. */
export function exportNoteMarkdown(
  note: Note,
  workspace: Pick<Workspace, "noteTypes" | "people" | "notes" | "projects">,
): string {
  const escape = (text: string) =>
    text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const type = (workspace.noteTypes || []).find(
    (candidate) => candidate.id === note.customTypeId,
  );
  const properties = [
    ...Object.entries(note.properties),
    ...Object.entries(note.propertyValues || {}).map(([id, value]) => [
      type?.fields.find((field) => field.id === id)?.name || id,
      value,
    ]),
  ];
  const metadata = [
    ...(type ? [["Custom note type", type.name]] : []),
    ...(note.folder ? [["Folder", note.folder]] : []),
    ...(note.tags.length ? [["Tags", note.tags.join(", ")]] : []),
    ...properties,
  ];
  let result = `# ${note.title}\n\n${metadata.length ? `| Property | Value |\n| --- | --- |\n${metadata.map(([key, value]) => `| ${escape(key)} | ${escape(value)} |`).join("\n")}\n\n` : ""}`;
  if (note.decision) {
    const decision = note.decision;
    const owner = workspace.people.find(
      (person) => person.id === decision.ownerId,
    )?.name;
    const replacement = workspace.notes.find(
      (candidate) => candidate.id === decision.supersededById,
    )?.title;
    result += `## Decision record\n\nStatus: ${decision.status}\n${decision.decidedOn ? `\nDate: ${decision.decidedOn}\n` : ""}${owner ? `\nOwner: ${owner}\n` : ""}${replacement ? `\nReplaced by: [[${replacement}]]\n` : ""}\n${decisionReasoningMarkdown(decision)}\n\n`;
  }
  return `${result}${note.content}`;
}
