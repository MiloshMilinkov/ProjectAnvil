'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CheckSquare, LoaderCircle, X } from 'lucide-react';
import type { Mutate, Note, Priority, Task, Workspace } from '../lib/types';
import { priorities, uid } from '../lib/types';
import './linked-note-tasks.css';

interface NoteTaskComposerProps {
  note: Note;
  initialExcerpt: string;
  workspace: Workspace;
  currentPerson: string;
  mutate: Mutate;
  onClose: () => void;
  onCreated: (task: Task) => void;
  onOpenTask: (id: string) => void;
}

const maximumExcerptLength = 8_000;

function plainText(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function suggestedTaskTitle(excerpt: string): string {
  const firstLine = excerpt.split('\n').find(line => line.trim()) || '';
  return plainText(firstLine).slice(0, 300);
}

/** A paragraph picker makes the same action usable without precise text selection. */
function sourceOptions(note: Note, initialExcerpt: string): string[] {
  const candidates = note.content.split(/\n\s*\n/).flatMap(paragraph => {
    const lines = paragraph.split('\n').filter(line => line.trim());
    return lines.every(line => /^\s*[-*+]\s+\[[ xX]\]/.test(line)) ? lines : [paragraph];
  });
  return [...new Set([initialExcerpt, ...candidates].map(value => value.trim()).filter(Boolean))]
    .slice(0, 100)
    .map(value => value.slice(0, maximumExcerptLength));
}

export default function NoteTaskComposer({
  note,
  initialExcerpt,
  workspace,
  currentPerson,
  mutate,
  onClose,
  onCreated,
  onOpenTask,
}: NoteTaskComposerProps) {
  const options = useMemo(() => sourceOptions(note, initialExcerpt), [note, initialExcerpt]);
  const [excerpt, setExcerpt] = useState(initialExcerpt.slice(0, maximumExcerptLength));
  const [title, setTitle] = useState(suggestedTaskTitle(initialExcerpt));
  const [projectId, setProjectId] = useState(note.projectId);
  const [assigneeId, setAssigneeId] = useState(currentPerson);
  const [priority, setPriority] = useState<Priority>('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const duplicate = workspace.tasks.find(task =>
    task.source?.noteId === note.id
    && task.source.excerpt.replace(/\s+/g, ' ').trim() === excerpt.replace(/\s+/g, ' ').trim(),
  );

  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closingDialog = dialog.current;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLInputElement>('[name="linked-task-title"]')?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!submitting.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
      ) || [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKey, true);
    return () => {
      alive.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey, true);
      const activeElement = document.activeElement;
      const focusWasReleased = !activeElement || activeElement === document.body
        || !!closingDialog?.contains(activeElement);
      const anotherDialogIsOpen = [...document.querySelectorAll('[role="dialog"]')]
        .some(element => element !== closingDialog);
      if (previousFocus?.isConnected && focusWasReleased && !anotherDialogIsOpen) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function chooseExcerpt(value: string) {
    // Keep a title the user has deliberately written when changing the quote.
    setTitle(current => current === suggestedTaskTitle(excerpt) ? suggestedTaskTitle(value) : current);
    setExcerpt(value);
    setError('');
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || duplicate) return;
    if (!title.trim() || !excerpt.trim()) {
      setError('Add a task title and choose some source text.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const task: Task = {
      id: uid(),
      key: '',
      title: title.trim(),
      description: '',
      status: 'todo',
      priority,
      type: 'task',
      projectId,
      assigneeId,
      dueDate: '',
      estimate: 0,
      tags: [],
      noteIds: [note.id],
      blockedBy: [],
      subtasks: [],
      comments: [],
      source: { noteId: note.id, excerpt: excerpt.trim() },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const saved = await mutate({ action: 'upsert', entity: 'tasks', item: task });
      const committed = saved.tasks.find(item => item.id === task.id);
      if (!committed) throw new Error('The task could not be found after saving.');
      if (alive.current) onCreated(committed);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'The task could not be saved.');
    } finally {
      submitting.current = false;
      if (alive.current) setSaving(false);
    }
  }

  return createPortal(
    <div className="linked-task-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section
        ref={dialog}
        className="linked-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="linked-task-dialog-heading">
          <div><CheckSquare size={21} /><h2 id={titleId}>Create a linked task</h2></div>
          <button type="button" className="linked-task-icon" aria-label="Close linked task" disabled={saving} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <p id={descriptionId} className="linked-task-intro">
          Keep the thinking in <strong>{note.title}</strong> connected to the next action. The note stays unchanged.
          {' '}Later changes to the note can flag this task for review.
        </p>

        <form onSubmit={createTask}>
          <label className="linked-task-field">
            <span>Task title</span>
            <input name="linked-task-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} disabled={saving} />
          </label>
          <label className="linked-task-field">
            <span>Source text</span>
            <select aria-label="Choose source text" value={excerpt} onChange={event => chooseExcerpt(event.target.value)} disabled={saving}>
              {options.map((value, index) => <option key={index} value={value}>{plainText(value).slice(0, 100) || 'Note text'}</option>)}
            </select>
            <textarea aria-label="Source quote preview" value={excerpt} readOnly rows={4} />
            <small>Select another paragraph or checklist item here, or close this form and select text in the note. Quotes keep up to 8,000 characters.</small>
          </label>

          <div className="linked-task-field-grid">
            <label className="linked-task-field">
              <span>Project</span>
              <select value={projectId} onChange={event => setProjectId(event.target.value)} disabled={saving}>
                <option value="">No project</option>
                {workspace.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="linked-task-field">
              <span>Assignee</span>
              <select value={assigneeId} onChange={event => setAssigneeId(event.target.value)} disabled={saving}>
                <option value="">Unassigned</option>
                {workspace.people.filter(person => !person.inactive).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="linked-task-field">
              <span>Priority</span>
              <select value={priority} onChange={event => setPriority(event.target.value as Priority)} disabled={saving}>
                {priorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
            </label>
          </div>

          {duplicate && <div className="linked-task-duplicate" role="status">
            <p>This text already has a task: <strong>{duplicate.title}</strong>.</p>
            <button type="button" className="linked-task-button" onClick={() => { onClose(); onOpenTask(duplicate.id); }}>
              Open existing task <ArrowUpRight size={16} />
            </button>
          </div>}
          {error && <p className="linked-task-error" role="alert">{error}</p>}
          <footer className="linked-task-dialog-footer">
            <button type="button" className="linked-task-button" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="linked-task-button linked-task-primary" disabled={saving || !!duplicate || !title.trim() || !excerpt.trim()}>
              {saving ? <LoaderCircle size={16} className="spin" /> : <CheckSquare size={16} />}
              {saving ? 'Creating…' : 'Create linked task'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
