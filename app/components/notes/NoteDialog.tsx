"use client";
import { useRef, type ReactNode } from "react";
import { useDialog } from "../useDialog";

export default function NoteDialog({
  children,
  className,
  label,
  onClose,
  busy = false,
}: {
  children: ReactNode;
  className: string;
  label: string;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, onClose, busy);
  return (
    <section
      ref={ref}
      className={className}
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </section>
  );
}
