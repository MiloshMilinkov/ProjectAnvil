"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceAccess } from "../lib/access-types";
import "./teamwork.css";

type AssignableRole = "admin" | "editor" | "viewer";
export default function TeamRoleEditor({
  username,
  role,
  allowAdmin,
  disabled,
  onSave,
  focusRequested = false,
}: {
  username: string;
  role: WorkspaceAccess["role"];
  allowAdmin: boolean;
  disabled: boolean;
  onSave: (role: AssignableRole) => void;
  focusRequested?: boolean;
}) {
  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (focusRequested) select.current?.focus();
  }, [focusRequested]);
  const [selected, setSelected] = useState<AssignableRole>(
    role === "admin" ? "admin" : role === "viewer" ? "viewer" : "editor",
  );
  return (
    <div className="team-role-editor" data-tour="team-roles">
      <label>
        Role for {username}
        <select
          ref={select}
          className="field"
          value={selected}
          disabled={disabled}
          onChange={(event) =>
            setSelected(event.target.value as AssignableRole)
          }
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          {allowAdmin && <option value="admin">Admin</option>}
        </select>
      </label>
      <button
        className="account-button"
        type="button"
        disabled={disabled || selected === role}
        onClick={() => onSave(selected)}
      >
        Save role
      </button>
    </div>
  );
}
