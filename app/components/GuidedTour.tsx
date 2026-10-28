"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Search,
  X,
} from "lucide-react";
import "./guided-tour.css";

import {
  findGuides,
  guideCatalog,
  quickStartGuide,
  type TourPage,
  type Guide,
} from "../lib/guide-content";
export type { TourPage } from "../lib/guide-content";
export { tourSteps } from "../lib/guide-content";

type Box = { left: number; top: number; width: number; height: number };
type Placement = "left" | "right" | "above" | "below" | "center";
type Layout = {
  anchor: Box | null;
  left: number;
  top: number;
  placement: Placement;
};
const clamp = (number: number, min: number, max: number) =>
  Math.max(min, Math.min(number, max));
const subscribeToClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function locateAnchor(
  selectors: string[],
  openedDetails: Set<HTMLDetailsElement>,
): HTMLElement | null {
  for (const selector of selectors) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      // Focused help reveals optional sections without requiring a separate tour API.
      let ancestor = candidate.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
          openedDetails.add(ancestor);
          ancestor.open = true;
        }
        ancestor = ancestor.parentElement;
      }
      const rect = candidate.getBoundingClientRect(),
        style = getComputedStyle(candidate);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      )
        return candidate;
    }
  }
  return null;
}

function positionCard(
  anchor: Box | null,
  width: number,
  height: number,
): Layout {
  const viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
    padding = 14,
    gap = 17;
  const centered = {
    anchor,
    left: Math.max(padding, (viewportWidth - width) / 2),
    top: Math.max(padding, (viewportHeight - height) / 2),
    placement: "center" as const,
  };
  if (!anchor) return centered;
  const right = anchor.left + anchor.width,
    bottom = anchor.top + anchor.height;
  const verticalCenter = clamp(
    anchor.top + anchor.height / 2 - height / 2,
    padding,
    viewportHeight - height - padding,
  );
  if (viewportWidth > 680 && right + gap + width <= viewportWidth - padding)
    return {
      anchor,
      left: right + gap,
      top: verticalCenter,
      placement: "right",
    };
  if (viewportWidth > 680 && anchor.left - gap - width >= padding)
    return {
      anchor,
      left: anchor.left - gap - width,
      top: verticalCenter,
      placement: "left",
    };
  const left = clamp(
    anchor.left + anchor.width / 2 - width / 2,
    padding,
    viewportWidth - width - padding,
  );
  if (bottom + gap + height <= viewportHeight - padding)
    return { anchor, left, top: bottom + gap, placement: "below" };
  if (anchor.top - gap - height >= padding)
    return { anchor, left, top: anchor.top - gap - height, placement: "above" };
  // Large surfaces need a bottom sheet; the highlighted control remains visible above it.
  return {
    anchor,
    left: Math.max(padding, (viewportWidth - width) / 2),
    top: Math.max(padding, viewportHeight - height - padding),
    placement: "center",
  };
}

export default function GuidedTour({
  onNavigate,
  onClose,
}: {
  onNavigate: (page: TourPage) => void;
  onClose: () => void;
}) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    clientSnapshot,
    serverSnapshot,
  );
  const [guideId, setGuideId] = useState(quickStartGuide.id);
  const [index, setIndex] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>({
    anchor: null,
    left: 14,
    top: 14,
    placement: "center",
  });
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useRef(onNavigate);
  const close = useRef(onClose);
  const openedDetails = useRef(new Set<HTMLDetailsElement>());
  const guideSearch = useRef<HTMLInputElement>(null);
  const activeGuide =
    guideCatalog.find((guide) => guide.id === guideId) || quickStartGuide;
  const step = activeGuide.steps[index];
  const stepCount = activeGuide.steps.length;
  const last = index === stepCount - 1;
  const keyboardState = useRef({ libraryOpen, stepCount });
  const results = useMemo(() => findGuides(query), [query]);
  function selectGuide(guide: Guide) {
    setGuideId(guide.id);
    setIndex(0);
    setLibraryOpen(false);
    setQuery("");
  }
  useLayoutEffect(() => {
    navigate.current = onNavigate;
    close.current = onClose;
    keyboardState.current = { libraryOpen, stepCount };
  }, [onNavigate, onClose, libraryOpen, stepCount]);

  useEffect(() => {
    const detailsToRestore = openedDetails.current;
    const focused = document.activeElement as HTMLElement | null,
      bodyOverflow = document.body.style.overflow;
    const shell = document.querySelector<HTMLElement>(".app-shell"),
      wasInert = shell?.hasAttribute("inert");
    document.body.style.overflow = "hidden";
    shell?.setAttribute("inert", "");
    return () => {
      document.body.style.overflow = bodyOverflow;
      if (!wasInert) shell?.removeAttribute("inert");
      for (const details of detailsToRestore) {
        if (details.isConnected) details.open = false;
      }
      if (focused?.isConnected && focused !== document.body)
        focused.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('[data-tour="tour-button"]')
          ?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const detailsToRestore = openedDetails.current;
    // The library uses a viewport-bounded CSS layout, independent of spotlights.
    if (libraryOpen) {
      guideSearch.current?.focus({ preventScroll: true });
      return;
    }
    navigate.current(step.page);
    let frame = 0,
      scrolled = false,
      cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const element = locateAnchor(step.anchors, openedDetails.current);
      if (element && !scrolled) {
        const box = element.getBoundingClientRect();
        if (box.top < 10 || box.bottom > window.innerHeight - 10)
          element.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
        scrolled = true;
      }
      const rect = element?.getBoundingClientRect(),
        margin = 6;
      let anchor: Box | null = null;
      if (
        rect &&
        rect.bottom > margin &&
        rect.top < window.innerHeight - margin
      ) {
        const left = clamp(
            rect.left - margin,
            margin,
            window.innerWidth - margin,
          ),
          top = clamp(rect.top - margin, margin, window.innerHeight - margin);
        anchor = {
          left,
          top,
          width: Math.max(
            0,
            Math.min(rect.right + margin, window.innerWidth - margin) - left,
          ),
          height: Math.max(
            0,
            Math.min(rect.bottom + margin, window.innerHeight - margin) - top,
          ),
        };
      }
      const cardBox = card.current?.getBoundingClientRect(),
        width = cardBox?.width || Math.min(378, window.innerWidth - 28),
        height = cardBox?.height || 330;
      const next = positionCard(anchor, width, height);
      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const retry = window.setTimeout(schedule, 90);
    const focusFrame = requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
    const observer = new ResizeObserver(schedule);
    if (card.current) observer.observe(card.current);
    const shell = document.querySelector(".app-shell");
    if (shell) observer.observe(shell);
    const mutations = new MutationObserver(schedule);
    if (shell) mutations.observe(shell, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      clearTimeout(retry);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      for (const details of detailsToRestore) {
        if (details.isConnected) details.open = false;
      }
      detailsToRestore.clear();
    };
  }, [index, mounted, step, libraryOpen]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (
        !keyboardState.current.libraryOpen &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIndex((value) =>
          clamp(
            value + (event.key === "ArrowRight" ? 1 : -1),
            0,
            keyboardState.current.stepCount - 1,
          ),
        );
        return;
      }
      if (event.key === "Tab") {
        const controls = card.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),[href],input,select,textarea,[tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0],
          final = controls[controls.length - 1],
          active = document.activeElement;
        if (
          event.shiftKey &&
          (active === first ||
            !card.current?.contains(active) ||
            active === heading.current)
        ) {
          event.preventDefault();
          final.focus();
        } else if (
          !event.shiftKey &&
          (active === final || !card.current?.contains(active))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, []);

  if (!mounted) return null;
  const anchor = libraryOpen ? null : layout.anchor;
  return createPortal(
    <div className="guided-tour" data-testid="guided-tour">
      {anchor ? (
        <>
          <div
            className="tour-shade"
            style={{ top: 0, left: 0, right: 0, height: anchor.top }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top + anchor.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top,
              left: 0,
              width: anchor.left,
              height: anchor.height,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top,
              left: anchor.left + anchor.width,
              right: 0,
              height: anchor.height,
            }}
          />
          <div aria-hidden="true" className="tour-spotlight" style={anchor} />
        </>
      ) : (
        <div className="tour-shade tour-shade-full" />
      )}
      <section
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby={
          libraryOpen ? "tour-library-description" : "tour-body"
        }
        className={`tour-card ${libraryOpen ? "tour-library" : ""}`}
        data-placement={layout.placement}
        data-step={step.id}
        style={libraryOpen ? undefined : { left: layout.left, top: layout.top }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="tour-card-top">
          <span className="tour-label">
            <Compass size={14} />
            {libraryOpen ? "Guides" : activeGuide.title}
          </span>
          <button
            type="button"
            className="tour-close"
            aria-label="Close guide"
            title="Close guide (Esc)"
            onClick={() => close.current()}
          >
            <X size={18} />
          </button>
        </div>
        {libraryOpen ? (
          <>
            <h2 ref={heading} tabIndex={-1} id="tour-title">
              Choose a guide
            </h2>
            <p id="tour-library-description">
              Follow the Quick start or choose a topic. Guides don&apos;t change
              your work.
            </p>
            <label className="tour-guide-search">
              <Search size={17} />
              <input
                ref={guideSearch}
                aria-label="Search guides"
                placeholder="Search topics and features…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <p className="tour-guide-results" role="status">
              {results.length} {results.length === 1 ? "guide" : "guides"}
              {query.trim() ? " found" : " available"}
            </p>
            <div className="tour-guide-grid">
              {results.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  className={`tour-guide-option ${guide.id === quickStartGuide.id ? "tour-guide-quick" : ""}`}
                  onClick={() => selectGuide(guide)}
                >
                  <span className="tour-guide-option-top">
                    <strong>{guide.title}</strong>
                    <span>{guide.steps.length} steps</span>
                  </span>
                  <span className="tour-guide-description">
                    {guide.description}
                  </span>
                </button>
              ))}
            </div>
            {!results.length && (
              <div className="tour-guide-empty">
                <p>
                  No guides match that search. Try a feature name, or clear the
                  search.
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    guideSearch.current?.focus();
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
            <button
              type="button"
              className="tour-library-back"
              onClick={() => setLibraryOpen(false)}
            >
              <ArrowLeft size={16} />
              Back to {activeGuide.title}
            </button>
          </>
        ) : (
          <>
            <div className="tour-progress" aria-hidden="true">
              <span style={{ width: `${((index + 1) / stepCount) * 100}%` }} />
            </div>
            <span className="tour-step-count" role="status" aria-live="polite">
              Step {index + 1} of {stepCount}
            </span>
            <h2 ref={heading} tabIndex={-1} id="tour-title">
              {step.title}
            </h2>
            <p id="tour-body">{step.body}</p>
            {step.tip && <p className="tour-tip">{step.tip}</p>}
            <div className="tour-navigation">
              <button
                type="button"
                className="tour-skip"
                onClick={() => close.current()}
              >
                Skip guide
              </button>
              <button
                type="button"
                className="tour-previous"
                disabled={index === 0}
                onClick={() => setIndex((value) => value - 1)}
              >
                <ArrowLeft size={14} />
                <span>Previous</span>
              </button>
              <button
                type="button"
                className="tour-next"
                onClick={() =>
                  last ? close.current() : setIndex((value) => value + 1)
                }
              >
                {last ? (
                  <>
                    <span>Finish</span>
                    <Check size={15} />
                  </>
                ) : (
                  <>
                    <span>Next</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </div>
            <p className="tour-key-hint">← → to move · Esc to close</p>
            <button
              type="button"
              className="tour-all-guides"
              onClick={() => setLibraryOpen(true)}
            >
              <BookOpen size={16} />
              All guides
            </button>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
