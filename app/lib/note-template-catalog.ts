import type { Note } from "./types";
import { uid } from "./types";
import { emptyDecision } from "./note-structures";
type Kind = Note["kind"];

export const templateCategories = [
  "General",
  "Planning",
  "Everyday",
  "Wellbeing",
  "Learning",
  "Creative",
] as const;
export type TemplateCategory = (typeof templateCategories)[number];
interface NoteTemplate {
  id: string;
  kind: Kind;
  label: string;
  description: string;
  category: TemplateCategory;
  folder: string;
  body: string;
}
export const templates = [
  {
    id: "blank",
    kind: "note",
    label: "Blank note",
    description: "A simple page for any idea.",
    category: "General",
    folder: "Notes",
    body: "# Overview\n\n",
  },
  {
    id: "project-brief",
    kind: "note",
    label: "Project brief",
    description: "Define the goal, scope, and next steps.",
    category: "Planning",
    folder: "Projects",
    body: "# Project overview\n\n## Goal\n\n## What success looks like\n\n## Scope\n\n### Included\n\n- \n\n### Out of scope\n\n- \n\n## Milestones\n\n| Milestone | Target date | Owner | Status |\n| --- | --- | --- | --- |\n| | | | |\n\n## Risks & open questions\n\n## Next actions\n\n- [ ] \n",
  },
  {
    id: "weekly-plan",
    kind: "note",
    label: "Weekly plan",
    description: "Priorities, commitments, and a weekly review.",
    category: "Planning",
    folder: "Planning",
    body: "# Week of\n\n## Main priorities\n\n- [ ] \n- [ ] \n- [ ] \n\n## Weekly schedule\n\n| Day | Focus | Commitments |\n| --- | --- | --- |\n| Monday | | |\n| Tuesday | | |\n| Wednesday | | |\n| Thursday | | |\n| Friday | | |\n| Saturday | | |\n| Sunday | | |\n\n## Notes & reminders\n\n## Weekly review\n\n### What went well\n\n### What to change next week\n",
  },
  {
    id: "daily-journal",
    kind: "daily",
    label: "Daily journal",
    description: "Plan your day and reflect on it.",
    category: "Everyday",
    folder: "Journal",
    body: "# Today’s focus\n\n- [ ] \n\n## Activity log\n\n## Ideas & discoveries\n\n## End-of-day reflection\n",
  },
  {
    id: "habit-tracker",
    kind: "note",
    label: "Habit tracker",
    description: "Track routines in a flexible weekly checklist.",
    category: "Everyday",
    folder: "Routines",
    body: "# Routine goals\n\n## Week of\n\n| Habit | Mon | Tue | Wed | Thu | Fri | Sat | Sun |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| | | | | | | | |\n| | | | | | | | |\n| | | | | | | | |\n\n## What helps me stay consistent\n\n## Obstacles & adjustments\n\n## Weekly reflection\n",
  },
  {
    id: "workout-log",
    kind: "note",
    label: "Workout log",
    description: "Record your own sessions, progress, and reflections.",
    category: "Wellbeing",
    folder: "Fitness",
    body: "# Session details\n\n| Property | Detail |\n| --- | --- |\n| Date | |\n| Session focus | |\n| Location | |\n\n## Activity log\n\n| Exercise or activity | Sets | Repetitions | Duration | Notes |\n| --- | --- | --- | --- | --- |\n| | | | | |\n| | | | | |\n\n## How the session felt\n\n## Progress & observations\n\n## Notes for next time\n",
  },
  {
    id: "meal-plan",
    kind: "note",
    label: "Meal plan",
    description: "Plan meals, groceries, and preparation.",
    category: "Wellbeing",
    folder: "Everyday",
    body: "# Week of\n\n## Preferences & practical needs\n\n## Meal ideas\n\n| Day | Breakfast | Lunch | Dinner | Other |\n| --- | --- | --- | --- | --- |\n| Monday | | | | |\n| Tuesday | | | | |\n| Wednesday | | | | |\n| Thursday | | | | |\n| Friday | | | | |\n| Saturday | | | | |\n| Sunday | | | | |\n\n## Grocery list\n\n- [ ] \n\n## Preparation & leftovers\n\n## Recipes & notes\n",
  },
  {
    id: "study-notes",
    kind: "note",
    label: "Study notes",
    description: "Organize concepts, questions, and practice.",
    category: "Learning",
    folder: "Learning",
    body: "# Topic\n\n## Learning goals\n\n- [ ] \n\n## Key concepts\n\n## Notes & examples\n\n## Questions to revisit\n\n## Practice & review\n\n- [ ] \n\n## Sources & further reading\n",
  },
  {
    id: "personal-budget",
    kind: "note",
    label: "Personal budget",
    description: "Keep planned and actual amounts in one place.",
    category: "Everyday",
    folder: "Personal",
    body: "# Budget period\n\n## Goals & reminders\n\n## Income\n\n| Source | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n| | | | |\n\n## Spending\n\n| Category | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n| | | | |\n| | | | |\n\n## Savings & upcoming costs\n\n## Period review\n",
  },
  {
    id: "trip-planner",
    kind: "note",
    label: "Trip planner",
    description: "Bring bookings, itineraries, and packing together.",
    category: "Everyday",
    folder: "Travel",
    body: "# Trip overview\n\n| Property | Detail |\n| --- | --- |\n| Destination | |\n| Dates | |\n| Travelers | |\n\n## Bookings & important details\n\n## Itinerary\n\n| Date | Place or activity | Time | Notes |\n| --- | --- | --- | --- |\n| | | | |\n\n## Packing checklist\n\n- [ ] \n\n## Costs & reminders\n\n## Useful contacts & links\n",
  },
  {
    id: "worldbuilding",
    kind: "world",
    label: "Worldbuilding",
    description: "Places, histories, systems, and lore.",
    category: "Creative",
    folder: "Worldbuilding",
    body: "# Overview\n\n## Atmosphere\n\n## History\n\n## Locations\n\n## Rules of the world\n\n## Open questions\n\n- [ ] Explore this idea\n",
  },
  {
    id: "character",
    kind: "character",
    label: "Character",
    description: "Identity, motivations, and relationships.",
    category: "Creative",
    folder: "Characters",
    body: "# Identity\n\n| Property | Detail |\n| --- | --- |\n| Role | |\n| Motivation | |\n| Home | |\n\n## Backstory\n\n## Personality\n\n## Relationships\n\n## Character arc\n",
  },
  {
    id: "research",
    kind: "research",
    label: "Research",
    description: "Sources, findings, and next steps.",
    category: "Learning",
    folder: "Research",
    body: "# Question\n\n## Sources\n\n## Findings\n\n## Implications\n\n## Next steps\n\n- [ ] Review findings\n",
  },
  {
    id: "meeting",
    kind: "meeting",
    label: "Meeting",
    description: "Agendas, decisions, and follow-up actions.",
    category: "Planning",
    folder: "Meetings",
    body: "# Agenda\n\n- \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n",
  },
  {
    id: "decision",
    kind: "decision",
    label: "Decision record",
    description: "Compare options and preserve the reason behind an outcome.",
    category: "Planning",
    folder: "Decisions",
    body: "# Supporting notes\n\n## Evidence and references\n\n## Follow-up actions\n\n- [ ] \n",
  },
] as const satisfies readonly NoteTemplate[];
export type NoteTemplateId = (typeof templates)[number]["id"];
export const noteTemplateIds: readonly NoteTemplateId[] = templates.map(
  (template) => template.id,
);
export const noteKinds: { kind: Kind; label: string }[] = [
  { kind: "note", label: "Note" },
  { kind: "world", label: "Worldbuilding" },
  { kind: "character", label: "Character" },
  { kind: "research", label: "Research" },
  { kind: "daily", label: "Daily journal" },
  { kind: "meeting", label: "Meeting" },
  { kind: "decision", label: "Decision record" },
];

export function newNote(
  templateId: NoteTemplateId,
  title: string,
  projectId: string,
): Note {
  const template = templates.find((item) => item.id === templateId)!;
  const kind = template.kind;
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    content: template.body,
    kind,
    folder: template.folder,
    tags: [],
    projectId,
    bookmarked: false,
    customTypeId: "",
    propertyValues: {},
    decision: kind === "decision" ? emptyDecision() : null,
    properties:
      kind === "character"
        ? { Role: "", Faction: "", Status: "Draft" }
        : { Status: "Draft" },
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}
