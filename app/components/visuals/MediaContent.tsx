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
        aria-label={media.name}
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
          aria-label={media.name}
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
      <div className="canvas-pdf">
        <iframe src={resolved.url} title={media.name} />
        <a
          href={resolved.url}
          target="_blank"
          rel="noopener noreferrer"
          title={media.name}
        >
          Open {media.name}
        </a>
      </div>
    );
  return (
    <a href={resolved.url} target="_blank" rel="noopener noreferrer">
      <ArrowDownToLine size={16} /> Open {media.name}
    </a>
  );
}
