import type { EntityRef, RelationshipKind, Workspace } from './types';

export const relationshipOptions: {
  value: RelationshipKind;
  label: string;
  explanation: string;
}[] = [
  {
    value: 'depends-on',
    label: 'depends on',
    explanation: 'When the second item changes, review the first item.',
  },
  {
    value: 'supports',
    label: 'supports',
    explanation: 'When the first item changes, review the second item.',
  },
  {
    value: 'contradicts',
    label: 'contradicts',
    explanation: 'When either item changes, review the other item.',
  },
  {
    value: 'decided-because',
    label: 'was decided because of',
    explanation: 'When the reason changes, review the decision.',
  },
];

export function relationshipLabel(kind: RelationshipKind): string {
  return relationshipOptions.find(option => option.value === kind)?.label ?? kind;
}

export function entityTitle(workspace: Workspace, ref: EntityRef): string {
  const collection = ref.type === 'note'
    ? workspace.notes
    : ref.type === 'task' ? workspace.tasks : workspace.projects;
  const item = collection.find(entity => entity.id === ref.id);
  if (!item) return 'Removed item';
  return 'title' in item ? item.title : item.name;
}

export function workspaceEntities(workspace: Workspace): EntityRef[] {
  return [
    ...workspace.notes.map(note => ({ type: 'note' as const, id: note.id })),
    ...workspace.tasks.map(task => ({ type: 'task' as const, id: task.id })),
    ...workspace.projects.map(project => ({ type: 'project' as const, id: project.id })),
  ];
}
