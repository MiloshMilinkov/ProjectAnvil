'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workspace } from '../lib/types';
import type { WorkLocation, WorkRoom } from '../lib/workrooms';
import type { TourPage } from './GuidedTour';

type CanvasContext = { canvasId: string; viewport: { x: number; y: number; zoom: number } };
type CanvasResume = { token: string; canvasId: string; viewport?: CanvasContext['viewport'] };

interface Options {
  workspace: Workspace | null;
  page: TourPage;
  projectFilter: string;
  selectedNote: string;
  setPage: (page: TourPage) => void;
  setProjectFilter: (id: string) => void;
  setSelectedNote: (id: string) => void;
  setSelectedTask: (id: string | null) => void;
  closeTransientViews: () => void;
  notify: (message: string) => void;
}

const emptyLocation: WorkLocation = {
  page: 'overview',
  projectFilter: '',
  noteId: '',
  canvasId: '',
};

/** Keeps transient navigation separate from the persisted room and checkpoint. */
export function useWorkRoomNavigation({
  workspace,
  page,
  projectFilter,
  selectedNote,
  setPage,
  setProjectFilter,
  setSelectedNote,
  setSelectedTask,
  closeTransientViews,
  notify,
}: Options) {
  const lastWorkingLocation = useRef<WorkLocation>(emptyLocation);
  const canvasContext = useRef<CanvasContext | null>(null);
  const [roomLocation, setRoomLocation] = useState<WorkLocation>(emptyLocation);
  const [activeRoom, setActiveRoom] = useState<WorkRoom | null>(null);
  const [canvasResume, setCanvasResume] = useState<CanvasResume>();
  const previousPage = useRef(page);

  useEffect(() => {
    // A resume request belongs to this canvas visit, not a later manual visit.
    if (previousPage.current === 'canvas' && page !== 'canvas') setCanvasResume(undefined);
    previousPage.current = page;
  }, [page]);

  useEffect(() => {
    if (page === 'rooms' || page === 'team' || page === 'settings') return;
    lastWorkingLocation.current = {
      page,
      projectFilter,
      noteId: selectedNote,
      canvasId: canvasContext.current?.canvasId || '',
      ...(page === 'canvas' && canvasContext.current ? { canvasViewport: canvasContext.current.viewport } : {}),
    };
  }, [page, projectFilter, selectedNote]);

  const trackCanvas = useCallback((context: CanvasContext) => {
    canvasContext.current = context;
    if (lastWorkingLocation.current.page === 'canvas') {
      lastWorkingLocation.current = {
        ...lastWorkingLocation.current,
        canvasId: context.canvasId,
        canvasViewport: context.viewport,
      };
    }
  }, []);

  const captureRoomContext = useCallback(() => {
    setRoomLocation({ ...lastWorkingLocation.current });
  }, []);

  const openRoomCanvas = useCallback((id: string, room?: WorkRoom) => {
    if (!workspace?.canvases.some(canvas => canvas.id === id)) {
      notify('This canvas is no longer in the workspace. Update the room pins.');
      return;
    }
    const location = room?.location;
    setCanvasResume({
      token: crypto.randomUUID(),
      canvasId: id,
      ...(location?.canvasId === id ? { viewport: location.canvasViewport } : {}),
    });
    setSelectedTask(null);
    closeTransientViews();
    setPage('canvas');
  }, [workspace, notify, setPage, setSelectedTask, closeTransientViews]);

  const resumeRoom = useCallback((room: WorkRoom) => {
    if (!workspace) return;
    const hasNote = (id: string) => workspace.notes.some(note => note.id === id);
    const noteId = hasNote(room.location.noteId)
      ? room.location.noteId
      : room.noteIds.find(hasNote) || '';
    const projectId = room.projectId || room.location.projectFilter;

    closeTransientViews();
    setActiveRoom(room);
    setProjectFilter(workspace.projects.some(project => project.id === projectId) ? projectId : '');
    setSelectedNote(noteId);
    // The focus task stays available in the room shelf without hiding the saved view.
    setSelectedTask(null);

    let targetPage: TourPage = room.location.page;
    if (targetPage === 'daily' && noteId) targetPage = 'notes';
    if ((targetPage === 'notes' || targetPage === 'daily') && !noteId) targetPage = 'overview';
    const hasCanvas = (id: string) => workspace.canvases.some(canvas => canvas.id === id);
    const canvasId = [room.location.canvasId, room.canvasId].find(hasCanvas);
    if (targetPage === 'canvas' && canvasId) {
      setCanvasResume({
        token: crypto.randomUUID(),
        canvasId,
        ...(canvasId === room.location.canvasId ? { viewport: room.location.canvasViewport } : {}),
      });
    } else {
      setCanvasResume(undefined);
      if (targetPage === 'canvas') targetPage = 'overview';
    }
    setPage(targetPage);
    notify(`Resumed ${room.name}${room.checkpoint?.nextStep ? ': ' + room.checkpoint.nextStep : ''}`);
  }, [workspace, closeTransientViews, setPage, setProjectFilter, setSelectedNote, setSelectedTask, notify]);

  const syncRooms = useCallback((rooms: WorkRoom[]) => {
    setActiveRoom(current => current ? rooms.find(room => room.id === current.id) || null : null);
  }, []);

  const dismissRoom = useCallback(() => {
    setActiveRoom(null);
    setCanvasResume(undefined);
  }, []);

  return {
    roomLocation,
    activeRoom,
    canvasResume,
    captureRoomContext,
    trackCanvas,
    resumeRoom,
    openRoomCanvas,
    syncRooms,
    dismissRoom,
  };
}
