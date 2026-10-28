'use client';

import { ArrowRight, Quote } from 'lucide-react';
import type { Task, Workspace } from '../lib/types';
import './linked-note-tasks.css';

interface SourceNoteCardProps {
  task: Task;
  workspace: Workspace;
  onOpenNote: (id: string) => void;
}

export default function SourceNoteCard({ task, workspace, onOpenNote }: SourceNoteCardProps) {
  const source = task.source;
  if (!source) return null;
  const note = workspace.notes.find(item => item.id === source.noteId);

  return <section className="task-source-note" aria-label="Task source note">
    <header>
      <span><Quote size={16} aria-hidden="true" />Source note</span>
      {note && <button type="button" onClick={() => onOpenNote(note.id)}>{note.title}<ArrowRight size={15} aria-hidden="true" /></button>}
    </header>
    <blockquote>{source.excerpt}</blockquote>
    <p>{note ? 'Text saved when the task was created. Open the note to see its current version.' : 'The source note is no longer available.'}</p>
  </section>;
}
