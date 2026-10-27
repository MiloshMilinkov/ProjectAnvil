"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import type { DraftScope } from "../lib/draft-store";
import type { Media, Workspace } from "../lib/types";
import {
  canonicalMediaAddress,
  scopedMediaSource,
} from "../lib/workspace-transport";
import {
  offlineMediaUrl,
  readOfflineMedia,
  readOfflineWorkspace,
  subscribeOfflineStorage,
  type OfflineWorkspaceCopy,
} from "../lib/offline-store";
import "./offline-media.css";

type MediaState = { url?: string; loading: boolean; unavailable: boolean };
const loading: MediaState = { loading: true, unavailable: false };
const unavailable: MediaState = { loading: false, unavailable: true };
const noopSubscribe = () => () => {};
const emptySnapshot = () => null;
const fileKey = (file: Media) =>
  JSON.stringify([
    file.id,
    file.url,
    file.size,
    file.type,
    file.createdAt,
    file.projectId || "",
  ]);

/** Blob addresses are ephemeral display state, never persisted note content. */
class OfflineMediaManager {
  private files: Map<string, Media>;
  private states = new Map<string, MediaState>();
  private listeners = new Set<() => void>();
  private requested = new Set<string>();
  private versions = new Map<string, number>();
  private availability = new Map<string, string>();
  private disposed = false;
  private refreshVersion = 0;

  constructor(
    readonly scope: DraftScope,
    files: Media[],
    readonly offline: boolean,
  ) {
    this.files = new Map(files.map((file) => [file.id, file]));
  }

  reference(
    source: string | undefined,
  ): { id: string; fragment: string } | null {
    if (!source) return null;
    const match =
      /^\/api\/media\/([A-Za-z0-9_-]{1,120})(?:\?[^#]*)?(#.*)?$/.exec(source);
    if (!match || !this.files.has(match[1])) return null;
    try {
      canonicalMediaAddress(
        {
          id: match[1],
          url: source.slice(0, source.length - (match[2]?.length || 0)),
        },
        this.scope.workspaceId,
      );
    } catch {
      return null;
    }
    return { id: match[1], fragment: match[2] || "" };
  }

  snapshot(source: string | undefined): MediaState | null {
    if (!this.offline) return null;
    const ref = this.reference(source);
    return ref ? this.states.get(ref.id) || loading : unavailable;
  }

  onlineUrl(source: string | undefined): string | undefined {
    const ref = this.reference(source);
    const file = ref && this.files.get(ref.id);
    return file && source
      ? scopedMediaSource(file, source, this.scope.workspaceId)
      : source;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private key(copy: OfflineWorkspaceCopy | null, id: string) {
    const expected = this.files.get(id);
    const cached = copy?.workspace?.media.find((file) => file.id === id);
    const attachment = copy?.attachments.find((file) => file.id === id);
    return expected &&
      cached &&
      attachment &&
      fileKey(expected) === fileKey(cached)
      ? `${copy!.token}:${attachment.fingerprint}`
      : "missing";
  }

  request(source: string | undefined) {
    if (!this.offline || this.disposed) return;
    const ref = this.reference(source);
    if (!ref || this.requested.has(ref.id)) return;
    this.requested.add(ref.id);
    void this.load(ref.id);
  }

  async refresh() {
    if (!this.offline || this.disposed || !this.requested.size) return;
    const version = ++this.refreshVersion;
    let copy: OfflineWorkspaceCopy | null = null;
    try {
      copy = await readOfflineWorkspace(this.scope);
    } catch {}
    if (this.disposed || version !== this.refreshVersion) return;
    for (const id of this.requested) {
      const key = this.key(copy, id);
      if (this.availability.get(id) !== key) void this.load(id, copy);
    }
  }

  private async load(id: string, knownCopy?: OfflineWorkspaceCopy | null) {
    const version = (this.versions.get(id) || 0) + 1;
    this.versions.set(id, version);
    const old = this.states.get(id)?.url;
    if (old) URL.revokeObjectURL(old);
    this.states.set(id, loading);
    this.emit();
    try {
      const copy =
        knownCopy === undefined
          ? await readOfflineWorkspace(this.scope)
          : knownCopy;
      const key = this.key(copy, id);
      const file = this.files.get(id);
      const blob =
        key !== "missing" &&
        file &&
        offlineMediaUrl(file, this.scope.workspaceId)
          ? await readOfflineMedia(this.scope, id)
          : null;
      if (this.disposed || this.versions.get(id) !== version) return;
      this.availability.set(id, key);
      this.states.set(
        id,
        blob
          ? {
              url: URL.createObjectURL(blob),
              loading: false,
              unavailable: false,
            }
          : unavailable,
      );
    } catch {
      if (this.disposed || this.versions.get(id) !== version) return;
      this.availability.set(id, "missing");
      this.states.set(id, unavailable);
    }
    this.emit();
  }

  dispose() {
    this.disposed = true;
    for (const state of this.states.values())
      if (state.url) URL.revokeObjectURL(state.url);
    this.states.clear();
    this.listeners.clear();
  }

  start() {
    if (!this.disposed) return;
    this.disposed = false;
    for (const id of this.requested) void this.load(id);
  }
}

const OfflineMediaContext = createContext<OfflineMediaManager | null>(null);

export function OfflineMediaProvider({
  scope,
  workspace,
  isOffline,
  children,
}: {
  scope: DraftScope;
  workspace: Workspace;
  isOffline: boolean;
  children: ReactNode;
}) {
  const { accountId, workspaceId } = scope;
  const mediaSignature = JSON.stringify(workspace.media);
  const manager = useMemo(
    () =>
      new OfflineMediaManager(
        { accountId, workspaceId },
        JSON.parse(mediaSignature) as Media[],
        isOffline,
      ),
    [accountId, workspaceId, mediaSignature, isOffline],
  );
  useEffect(() => {
    manager.start();
    const unsubscribe = subscribeOfflineStorage(() => void manager.refresh());
    return () => {
      unsubscribe();
      manager.dispose();
    };
  }, [manager]);
  return (
    <OfflineMediaContext.Provider value={manager}>
      {children}
    </OfflineMediaContext.Provider>
  );
}

export function useOfflineMediaUrl(source: string | undefined) {
  const manager = useContext(OfflineMediaContext);
  const state = useSyncExternalStore(
    manager?.subscribe || noopSubscribe,
    () => manager?.snapshot(source) || null,
    emptySnapshot,
  );
  useEffect(() => {
    manager?.request(source);
  }, [manager, source]);
  if (!manager?.offline)
    return {
      url: manager ? manager.onlineUrl(source) : source,
      isOffline: false,
      loading: false,
      unavailable: false,
    };
  const fragment = manager.reference(source)?.fragment || "";
  return {
    url: state?.url ? state.url + fragment : undefined,
    isOffline: true,
    loading: state?.loading ?? false,
    unavailable: state?.unavailable ?? true,
  };
}

export function OfflineMediaUnavailable({
  name,
  loading: pending = false,
}: {
  name: string;
  loading?: boolean;
}) {
  return (
    <span
      className="offline-media-unavailable"
      role={pending ? "status" : undefined}
    >
      <strong>{name || "Attachment"}</strong>
      <span>
        {pending
          ? "Opening offline copy…"
          : "Connect to open · This file is not kept offline."}
      </span>
    </span>
  );
}

export function OfflineAttachmentLink({
  href,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string }) {
  const media = useOfflineMediaUrl(href);
  if (media.unavailable || media.loading)
    return (
      <span
        className="offline-attachment-link"
        title={
          media.loading
            ? "Opening offline copy"
            : "Connect to open this attachment"
        }
      >
        {children}
        <small>
          {media.loading ? "Opening offline copy…" : "Connect to open"}
        </small>
      </span>
    );
  return (
    <a {...props} href={media.url}>
      {children}
    </a>
  );
}
