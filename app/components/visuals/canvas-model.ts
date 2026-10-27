import { uid, type Canvas, type FeatureProps } from "../../lib/types";
import type { Point } from "./visual-helpers";

export const cardColors = [
  "#9b88ff",
  "#70bddb",
  "#77c7a8",
  "#e6b670",
  "#df8bb6",
  "#858da8",
];

export const cardColorNames = [
  "Purple",
  "Blue",
  "Green",
  "Gold",
  "Pink",
  "Slate",
];

export const isHttp = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export const blankCanvas = (projectId = ""): Canvas => ({
  id: uid(),
  title: "Untitled canvas",
  projectId,
  cards: [],
  edges: [],
});

export const sanitizeCanvas = (canvas: Canvas): Canvas =>
  canvas.cards.some((card) => card.entityId === "")
    ? {
        ...canvas,
        cards: canvas.cards.map((card) => {
          if (card.entityId !== "") return card;
          const unlinked = { ...card };
          delete unlinked.entityId;
          return unlinked;
        }),
      }
    : canvas;

/** Plain-text note summaries can be reused while only the canvas camera moves. */
export function canvasNotePreview(content: string): string {
  return content
    .replace(/^#{1,6}\s/gm, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match: string, title: string, alias?: string) => alias || title,
    )
    .replace(/[*`]/g, "")
    .slice(0, 700);
}

export type CanvasDrag = {
  type: "pan" | "move" | "resize";
  id?: string;
  start: Point;
  origin: Point;
  width?: number;
  height?: number;
  moved: boolean;
};

export interface CanvasViewProps extends FeatureProps {
  resumeContext?: {
    token: string;
    canvasId: string;
    viewport?: { x: number; y: number; zoom: number };
  };
  onContextChange?: (context: {
    canvasId: string;
    viewport: { x: number; y: number; zoom: number };
  }) => void;
}
