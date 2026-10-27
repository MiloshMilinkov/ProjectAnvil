"use client";
import { Command, Download, Network, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import {
  flushDraftGuards,
  hasUnpersistedDrafts,
  listDrafts,
} from "../../lib/draft-store";
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
  const settingsScope = useDraftScope();
  const permissions = useWorkspacePermissions(workspace);
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState("");
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
    <div className="page settings-page">
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="Workspace settings"
        description="Your workspace, your way of working."
      />
      <InstallAppPanel
        canReload={async () => {
          const flushed = await flushDraftGuards(settingsScope);
          if (
            !flushed ||
            hasUnpersistedDrafts(settingsScope) ||
            listDrafts(settingsScope, "mutations").length
          ) {
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
      <section className="panel settings-section">
        <h2>Workspace</h2>
        <p>
          Your projects, knowledge, tasks, and uploaded files are stored on this
          PC.
        </p>
        <label className="form-label">
          Workspace name
          <div className="settings-inline">
            <input
              className="field"
              value={name}
              disabled={permissions.role !== "owner"}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={
                permissions.role !== "owner" || renaming || !name.trim()
              }
              onClick={async () => {
                if (renaming) return;
                setRenaming(true);
                setError("");
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
                  setError(
                    error instanceof Error
                      ? error.message
                      : "The workspace could not be renamed.",
                  );
                } finally {
                  setRenaming(false);
                }
              }}
            >
              Save name
            </button>
          </div>
        </label>
        <div className="settings-stats">
          {workspace.projects.length} projects<span>·</span>
          {workspace.tasks.length} tasks<span>·</span>
          {workspace.notes.length} notes<span>·</span>
          {workspace.media.length} attachments
        </div>
      </section>
      <section className="panel settings-section appearance-section">
        <h2>Appearance</h2>
        <p>
          Choose a look for your workspace. Your choice is saved on this device.
        </p>
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
            onChange={(e) => savePrefs({ ...prefs, compact: e.target.checked })}
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
            <small>Save a default workspace layout.</small>
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
      <section className="panel settings-section">
        <h2>Your data stays portable</h2>
        <p>
          Export workspace records as JSON, including notes, tasks, discussions,
          relationships, canvas layouts, custom note types, decisions, presets,
          and brainstorming boards. Archived note history, personal work rooms,
          accounts, and attachment files require a complete local backup.
          Importing resets relationship review markers against the imported
          content. New imported ideas start without votes; matching ideas keep
          their current trusted votes.
        </p>
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
              setError("");
              try {
                const imported = JSON.parse(await file.text());
                await mutate({
                  action: "import",
                  workspace: { ...imported, revision: workspace.revision },
                });
                notify("Workspace imported");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setImporting(false);
                e.target.value = "";
              }
            }}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
      {permissions.canManage ? (
        <StorageHealth />
      ) : (
        <p className="muted">
          Workspace storage and complete recovery reports are managed by owners
          and admins.
        </p>
      )}
      <section className="panel settings-section">
        <h2>Assignment labels</h2>
        <p>
          Optional labels for planning. To give someone access, invite their
          registered username through Teams &amp; people.
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
        <h2>Local access</h2>
        <p>
          ProjectAnvil runs on this PC at http://127.0.0.1:5173. Other devices
          cannot open this local address. Accounts have private personal
          workspaces. Team workspaces share their projects, tasks, notes, and
          files with accepted members. Assignment labels do not grant access.
        </p>
        <div className="info-note">
          <Network size={17} />
          <p>
            Live updates refresh saved work across open windows. Optional
            offline copies and queued changes stay in this browser profile. Keep
            the local server running for accounts, attachments, and
            synchronization.
          </p>
        </div>
      </section>
    </div>
  );
}
