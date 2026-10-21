'use client';

import { useState } from 'react';
import { ArrowUpRight, CheckSquare, ChevronDown } from 'lucide-react';
import type { Task } from '../lib/types';
import { statuses } from '../lib/types';
import './linked-note-tasks.css';

interface LinkedNoteTasksProps {
  tasks: Task[];
  onOpenTask: (id: string) => void;
}

export default function LinkedNoteTasks({ tasks, onOpenTask }: LinkedNoteTasksProps) {
  const [expanded, setExpanded] = useState(true);
  if (!tasks.length) return null;
  const completed = tasks.filter(task => task.status === 'done').length;

  return <section className="linked-note-tasks" data-tour="linked-note-tasks" aria-label="Tasks linked to this note">
    <button type="button" className="linked-note-task-summary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <CheckSquare size={16} />
      <strong>Linked tasks <span>{tasks.length}</span></strong>
      <small>{tasks.length - completed} open · {completed} done</small>
      <ChevronDown size={16} className={expanded ? 'is-expanded' : ''} />
    </button>
    {expanded && <div className="linked-note-task-list">
      {tasks.map(task => {
        const status = statuses.find(item => item.id === task.status)!;
        return <button type="button" className="linked-note-task" key={task.id} onClick={() => onOpenTask(task.id)}>
          <span className="linked-note-task-state" style={{ background: status.color }} aria-hidden="true" />
          <span className="linked-note-task-copy">
            <strong><span>{task.key}</span>{task.title}</strong>
            {task.source && <small>{task.source.excerpt.replace(/\s+/g, ' ').slice(0, 140)}</small>}
          </span>
          <span className="linked-note-task-status">{status.label}</span>
          <ArrowUpRight size={15} />
        </button>;
      })}
    </div>}
  </section>;
}
