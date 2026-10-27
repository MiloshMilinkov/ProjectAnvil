import type { Media, Mutation, Workspace } from "./types";

const identifier = /^[A-Za-z0-9_-]{1,120}$/;

/** Workspace query strings are transport context, never persisted ownership. */
export function canonicalMediaAddress(
  file: Pick<Media, "id" | "url">,
  workspaceId: string,
): string {
  if (!identifier.test(file.id) || !identifier.test(workspaceId))
    throw new Error("Choose a valid attachment and workspace.");
  const canonical = `/api/media/${file.id}`;
  if (
    file.url !== canonical &&
    file.url !== `${canonical}?workspace=${encodeURIComponent(workspaceId)}`
  )
    throw new Error(
      "This attachment address does not belong to the selected workspace.",
    );
  return canonical;
}

/** Model validation accepts canonical media metadata; authored text is unchanged. */
export function canonicalWorkspaceMedia(
  workspace: Workspace,
  workspaceId: string,
): Workspace {
  return {
    ...workspace,
    media: workspace.media.map((file) => ({
      ...file,
      url: canonicalMediaAddress(file, workspaceId),
    })),
  };
}

export function scopedWorkspaceMedia(
  workspace: Workspace,
  workspaceId: string,
): Workspace {
  const canonical = canonicalWorkspaceMedia(workspace, workspaceId);
  return {
    ...canonical,
    media: canonical.media.map((file) => ({
      ...file,
      url: `${file.url}?workspace=${encodeURIComponent(workspaceId)}`,
    })),
  };
}

/** Authored links can remain canonical while browser requests carry their scope. */
export function scopedMediaSource(
  file: Pick<Media, "id" | "url">,
  source: string,
  workspaceId: string,
): string {
  const hash = source.indexOf("#");
  const address = hash < 0 ? source : source.slice(0, hash);
  const fragment = hash < 0 ? "" : source.slice(hash);
  canonicalMediaAddress({ id: file.id, url: address }, workspaceId);
  return `${canonicalMediaAddress(file, workspaceId)}?workspace=${encodeURIComponent(workspaceId)}${fragment}`;
}

export function canonicalMediaMutation(
  mutation: Mutation,
  workspaceId: string,
): Mutation {
  if (mutation.entity !== "media") return mutation;
  const normalize = (value: Record<string, unknown>) => {
    if (!Object.hasOwn(value, "url")) return value;
    if (typeof value.id !== "string" || typeof value.url !== "string")
      throw new Error("Choose a valid attachment address.");
    return {
      ...value,
      url: canonicalMediaAddress({ id: value.id, url: value.url }, workspaceId),
    };
  };
  return {
    ...mutation,
    ...(mutation.item
      ? { item: normalize(mutation.item as Record<string, unknown>) }
      : {}),
    ...(mutation.base ? { base: normalize(mutation.base) } : {}),
  };
}
