"use client";
import {
  Command,
  Download,
  HardDrive,
  Network,
  Palette,
  Plus,
  Settings2,
  Upload,
  Users,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import SettingsGroup from "./SettingsGroup";
import "./workspace-settings.css";
import { prepareWorkspaceReload } from "../../lib/draft-store";
import { today, type FeatureProps, type Person } from "../../lib/types";
import {
  parseWorkspacePreferences,
  type WorkspacePreferences,
} from "../../lib/workspace-preferences";
import { InstallAppPanel } from "../AppInstallation";
import OfflineWorkspacePanel from "../OfflineWorkspacePanel";
import PageHeader from "../PageHeader";
import PortableMarkdownPanel from "../PortableMarkdownPanel";
import { workspaceNavigation as nav } from "../shell/navigation";
import StorageHealth from "../StorageHealth";
import { AppearancePicker } from "../ThemeControls";
import { useDraftScope } from "../useRecoverableDraft";
import { useWorkspaceScope } from "../WorkspaceScope";
import type { useWorkspaceData } from "../useWorkspaceData";
import { useWorkspacePermissions } from "../WorkspacePermissions";

export default function WorkspaceSettings(
  props: FeatureProps & {
    onPerson: (person: Person | "new") => void;
    prefs: WorkspacePreferences;
    savePrefs: (preferences: WorkspacePreferences) => void;
    onShortcuts: () => void;
    data: ReturnType<typeof useWorkspaceData>;
    onReview: () => void;
  },
) {
  const { workspace, mutate, notify, prefs, savePrefs } = props;
  const { account } = useWorkspaceScope();
  const local = account.policy?.mode !== "online";
  const settingsScope = useDraftScope();
  const permissions = useWorkspacePermissions(workspace);
  const [name, setName] = useState(workspace.name);
  const [nameError, setNameError] = useState("");
  const [importError, setImportError] = useState("");
  const nameErrorId = useId();
  const settingsRef = useRef<HTMLDivElement>(null);
  function jumpTo(group: string) {
    const target = settingsRef.current?.querySelector<HTMLDetailsElement>(
      `[data-settings-group="${group}"]`,
    );
    if (!target) return;
    target.open = true;
    target.querySelector("summary")?.focus();
    target.scrollIntoView({ block: "start" });
  }
  const [importing, setImporting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const nameBaseline = useRef(workspace.name);
  const [renaming, setRenaming] = useState(false);
  function exportData() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "projectanvil-" + today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify("Workspace exported");
  }
  return (
    <div ref={settingsRef} className="page settings-page">
      <PageHeader
        title="Workspace settings"
        description="Manage your workspace, appearance, storage, and access."
      />

      <nav className="settings-jump-nav" aria-label="Settings sections">
        <button className="btn" onClick={() => jumpTo("workspace")}>
          <Settings2 size={17} aria-hidden="true" />
          Workspace
        </button>
        <button className="btn" onClick={() => jumpTo("appearance")}>
          <Palette size={17} aria-hidden="true" />
          Appearance &amp; workflow
        </button>
        <button className="btn" onClick={() => jumpTo("data")}>
          <HardDrive size={17} aria-hidden="true" />
          Data &amp; offline
        </button>
        <button className="btn" onClick={() => jumpTo("people")}>
          <Users size={17} aria-hidden="true" />
          People &amp; access
        </button>
      </nav>
      <SettingsGroup
        id="workspace"
        title="Workspace"
        description="Workspace name and record counts."
        icon={Settings2}
        initiallyOpen
      >
        <section className="panel settings-section">
          <h2>Workspace details</h2>
          <p>
            {local
              ? "Workspace data is stored on this PC."
              : "Workspace data is stored by this service."}
          </p>
          <label className="form-label">
            Workspace name
            <div className="settings-inline">
              <input
                className="field"
                value={name}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? nameErrorId : undefined}
                disabled={permissions.role !== "owner"}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError("");
                }}
              />
              <button
                className="btn btn-primary"
                disabled={
                  permissions.role !== "owner" || renaming || !name.trim()
                }
                onClick={async () => {
                  if (renaming) return;
                  setRenaming(true);
                  setNameError("");
                  try {
                    const saved = await mutate({
                      action: "rename",
                      name: name.trim(),
                      base: { name: nameBaseline.current },
                    });
                    nameBaseline.current = saved.name;
                    setName(saved.name);
                    notify("Workspace renamed");
                  } catch (error) {
                    setNameError(
                      error instanceof Error
                        ? error.message
                        : "The workspace could not be renamed.",
                    );
                  } finally {
                    setRenaming(false);
                  }
                }}
              >
                {renaming ? "Saving…" : "Save name"}
              </button>
            </div>
          </label>
          {nameError && (
            <p id={nameErrorId} className="form-error" role="alert">
              {nameError}
            </p>
          )}
          <div className="settings-stats">
            {workspace.projects.length} projects<span>·</span>
            {workspace.tasks.length} tasks<span>·</span>
            {workspace.notes.length} notes<span>·</span>
            {workspace.media.length} attachments
          </div>
        </section>
      </SettingsGroup>
      <SettingsGroup
        id="appearance"
        title="Appearance & workflow"
        description="Themes, spacing, shortcuts, and your startup view."
        icon={Palette}
        initiallyOpen
      >
        <section className="panel settings-section appearance-section">
          <h2>Appearance</h2>
          <p>Choose a theme for this device.</p>
          <AppearancePicker />
        </section>
        <section className="panel settings-section">
          <h2>Your preferences</h2>
          <p>These preferences are saved on this device.</p>
          <label className="setting-toggle">
            <span>
              <strong>Compact workspace</strong>
              <small>Reduce spacing to see more work at once.</small>
            </span>
            <input
              type="checkbox"
              checked={prefs.compact}
              onChange={(e) =>
                savePrefs({ ...prefs, compact: e.target.checked })
              }
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>New task keyboard shortcut</strong>
              <small>A single letter, active when you’re not typing.</small>
            </span>
            <input
              className="field shortcut-field"
              value={prefs.taskShortcut}
              maxLength={1}
              onChange={(e) => {
                const k = e.target.value.toLowerCase().replace(/[^a-z]/g, "");
                if (k) savePrefs({ ...prefs, taskShortcut: k });
              }}
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>Open this view on startup</strong>
              <small>Choose the view that opens when you start the app.</small>
            </span>
            <select
              className="field"
              value={prefs.savedPage}
              onChange={(e) =>
                savePrefs(
                  parseWorkspacePreferences({
                    ...prefs,
                    savedPage: e.target.value,
                  }),
                )
              }
            >
              {nav.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={props.onShortcuts}>
            <Command size={15} />
            See keyboard shortcuts
          </button>
        </section>
      </SettingsGroup>
      <SettingsGroup
        id="data"
        title="Data & offline"
        description="Installation, device copies, import, export, and recovery."
        icon={HardDrive}
      >
        <InstallAppPanel
          canReload={async () => {
            if (!(await prepareWorkspaceReload(settingsScope))) {
              notify(
                "Synchronize or review queued changes before restarting to update.",
              );
              return false;
            }
            return true;
          }}
        />
        <OfflineWorkspacePanel
          copy={props.data.offlineCopy}
          error={props.data.offlineError}
          queued={props.data.outboxSize}
          busy={props.data.pending > 0}
          onEnable={props.data.enableOffline}
          onForget={props.data.forgetOffline}
          onSynchronize={async () => {
            await props.data.load();
            await props.data.retrySaves();
          }}
          onReview={props.onReview}
          notify={notify}
        />
        <PortableMarkdownPanel
          workspace={workspace}
          notify={notify}
          onImported={props.data.load}
          connected={!props.data.isOffline}
        />
        <section
          className="panel settings-section settings-records"
          data-tour="workspace-records"
        >
          <h2>Workspace records</h2>
          <p>
            Download your workspace records as JSON. Import workspace replaces
            current records, so export a copy before replacing anything.
          </p>
          <details className="settings-format-details">
            <summary>Export contents and backup limits</summary>
            <p>
              Export workspace records as JSON, including notes, tasks,
              discussions, relationships, canvas layouts, custom note types,
              decisions, presets, and brainstorming boards. Archived note
              history, personal work rooms, accounts, and attachment files
              require a complete local backup. Importing resets relationship
              review markers against the imported content. New imported ideas
              start without votes; matching ideas keep their current trusted
              votes.
            </p>
          </details>
          <div className="settings-data-actions">
            <button className="btn" onClick={exportData}>
              <Download size={15} />
              Export workspace
            </button>
            <button
              className="btn"
              disabled={permissions.role !== "owner" || importing}
              onClick={() => uploadRef.current?.click()}
            >
              <Upload size={15} />
              {importing ? "Importing…" : "Import workspace"}
            </button>
            <input
              type="file"
              accept="application/json,.json"
              hidden
              ref={uploadRef}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  !window.confirm(
                    "Replace current workspace records with this export? Download a backup first.",
                  )
                ) {
                  e.target.value = "";
                  return;
                }
                setImporting(true);
                setImportError("");
                try {
                  const text = await file.text();
                  let imported;
                  try {
                    imported = JSON.parse(text);
                  } catch {
                    setImportError(
                      "This file isn't valid JSON. Choose a ProjectAnvil workspace export.",
                    );
                    return;
                  }
                  await mutate({
                    action: "import",
                    workspace: { ...imported, revision: workspace.revision },
                  });
                  notify("Workspace imported");
                } catch (err) {
                  setImportError(
                    err instanceof Error
                      ? err.message
                      : "Couldn't import this workspace. Try again.",
                  );
                } finally {
                  setImporting(false);
                  e.target.value = "";
                }
              }}
            />
          </div>
          {importError && (
            <p className="form-error" role="alert">
              {importError}
            </p>
          )}
        </section>
        {permissions.canManage ? (
          <StorageHealth />
        ) : (
          <p className="muted">
            Workspace storage and complete recovery reports are managed by
            owners and admins.
          </p>
        )}
      </SettingsGroup>
      <SettingsGroup
        id="people"
        title="People & access"
        description="Assignment labels and workspace permissions."
        icon={Users}
      >
        <section className="panel settings-section">
          <h2>Assignment labels</h2>
          <p>
            Optional labels for planning. To give someone access, invite their
            registered username through Teams &amp; workspaces.
          </p>
          <div className="settings-data-actions">
            <button
              className="btn"
              onClick={() => props.onPerson("new")}
              disabled={!permissions.canCreate}
            >
              <Plus size={15} />
              Add assignment label
            </button>
            {workspace.people
              .filter((p) => !p.userId)
              .map((p) => (
                <button
                  className="btn"
                  key={p.id}
                  onClick={() => props.onPerson(p)}
                  disabled={!permissions.canCreate}
                >
                  {p.name}
                </button>
              ))}
          </div>
        </section>
        <section className="panel settings-section">
          <h2>Workspace access</h2>
          <p>
            {local
              ? "This installation runs on this PC. Other devices can't connect to its local address. "
              : "Sign-in is required for this installation. "}
            Personal workspaces are private. Team roles and project permissions
            control shared work.
          </p>
          <div className="info-note">
            <Network size={17} />
            <p>
              Live updates keep open windows in sync. Offline copies and pending
              changes stay in this browser. Reconnect to sync them.
            </p>
          </div>
        </section>
      </SettingsGroup>
    </div>
  );
}
