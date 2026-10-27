export type Point = { x: number; y: number };

export type Camera = Point & { scale: number };

export const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n));

export const short = (s: string, n = 25) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export const cssColor = (value: string | undefined, fallback = "#9b88ff") =>
  value && /^#[\da-f]{3,8}$/i.test(value) ? value : fallback;
