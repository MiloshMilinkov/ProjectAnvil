"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
let previousOverflow = "";

/** Keeps keyboard focus in the active dialog and restores it after closing. */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  busy = false,
  open = true,
): void {
  const close = useEffectEvent(() => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialogs.length) previousOverflow = document.body.style.overflow;
    dialogs.push(dialog);
    document.body.style.overflow = "hidden";

    const controls = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:enabled,input:enabled,textarea:enabled,select:enabled,a[href],summary,[tabindex="0"]',
        ),
      ].filter(
        (element) =>
          element.getClientRects().length && !element.closest("[inert]"),
      );

    if (!dialog.contains(document.activeElement)) {
      const preferred = dialog.querySelector<HTMLElement>(
        "[data-initial-focus]:enabled, input:enabled, textarea:enabled",
      );
      (preferred && preferred.getClientRects().length
        ? preferred
        : controls()[0]
      )?.focus();
    }

    const keyboard = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        !dialog.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    };
    document.addEventListener("keydown", keyboard, true);

    return () => {
      document.removeEventListener("keydown", keyboard, true);
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      if (!dialogs.length) {
        document.body.style.overflow = previousOverflow;
      }
      if (
        previousFocus?.isConnected &&
        (!dialogs.length || dialogs.at(-1)?.contains(previousFocus))
      )
        previousFocus.focus({ preventScroll: true });
    };
  }, [ref, open]);
}
