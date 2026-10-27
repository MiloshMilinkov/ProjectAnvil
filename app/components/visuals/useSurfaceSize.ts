"use client";
import { useEffect, useRef, useState } from "react";

export function useSurfaceSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 680 });
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
