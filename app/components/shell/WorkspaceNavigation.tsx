"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import {
  navigationGroups,
  workspaceNavigation,
  type WorkspacePage,
} from "./navigation";

interface Props {
  page: WorkspacePage;
  assignedCount: number;
  onNavigate: (page: WorkspacePage) => void;
}

export default function WorkspaceNavigation({
  page,
  assignedCount,
  onNavigate,
}: Props) {
  const more = useRef<HTMLDetailsElement>(null);
  const morePages: readonly string[] = navigationGroups[2].pages;
  useEffect(() => {
    // Direct links, search, and guides reveal the selected destination too.
    if (more.current && morePages.includes(page)) more.current.open = true;
  }, [page, morePages]);
  const renderLinks = (pages: readonly string[]) =>
    pages.map((id) => {
      const item = workspaceNavigation.find((entry) => entry.id === id)!;
      return (
        <button
          key={id}
          data-tour={`nav-${id}`}
          className={`nav-item ${page === id ? "active" : ""}`}
          aria-current={page === id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <item.icon size={17} aria-hidden="true" />
          <span>{item.title}</span>
          {id === "my-work" && assignedCount > 0 && (
            <small>{assignedCount}</small>
          )}
        </button>
      );
    });
  return (
    <nav aria-label="Main navigation">
      {navigationGroups.slice(0, 2).map((group) => (
        <section
          className="navigation-group"
          key={group.title}
          aria-label={group.title}
        >
          <div className="nav-caption">{group.title}</div>
          {renderLinks(group.pages)}
        </section>
      ))}
      <details className="navigation-more" ref={more}>
        <summary>
          More tools <span>{morePages.length}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {renderLinks(morePages)}
      </details>
    </nav>
  );
}
