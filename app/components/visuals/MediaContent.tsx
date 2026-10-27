"use client";
import { ArrowDownToLine } from "lucide-react";
import type { Media } from "../../lib/types";
import {
  OfflineMediaUnavailable,
  useOfflineMediaUrl,
} from "../OfflineMediaProvider";

export function MediaContent({ media }: { media: Media }) {
  const resolved = useOfflineMediaUrl(media.url);
  if (resolved.unavailable || resolved.loading)
    return (
      <OfflineMediaUnavailable name={media.name} loading={resolved.loading} />
    );
  // Media addresses come from the authenticated upload endpoint, never from card text.
  // Local authenticated media URLs need their original response; image optimization would add a second fetch path.
  if (media.type.startsWith("image/"))
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved.url}
        alt={media.name}
        draggable={false}
        loading="lazy"
      />
    );
  if (media.type.startsWith("video/"))
    return (
      <video
        controls
        preload="metadata"
        src={resolved.url}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  if (media.type.startsWith("audio/"))
    return (
      <div className="canvas-audio">
        <span>Audio reference</span>
        <audio
          controls
          preload="metadata"
          src={resolved.url}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <small>{media.name}</small>
      </div>
    );
  if (media.type === "application/pdf")
    return (
      <object data={resolved.url} type="application/pdf">
        <a href={resolved.url} target="_blank" rel="noopener noreferrer">
          Open {media.name}
        </a>
      </object>
    );
  return (
    <a href={resolved.url} target="_blank" rel="noopener noreferrer">
      <ArrowDownToLine size={16} /> Open {media.name}
    </a>
  );
}
