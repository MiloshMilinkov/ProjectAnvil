"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "./knowledge.css";
import { useAppearance } from "./ThemeControls";
import type { Note, Workspace } from "../lib/types";
import type { Root } from "mdast";
import {
  OfflineAttachmentLink,
  OfflineMediaUnavailable,
  useOfflineMediaUrl,
} from "./OfflineMediaProvider";

export const headingSlug = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
const textOf = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : React.isValidElement<{ children?: React.ReactNode }>(child)
          ? textOf(child.props.children)
          : "",
    )
    .join("");

// Build highlight nodes directly in the Markdown tree, without accepting raw HTML.
interface MarkdownSyntaxNode {
  type: string;
  value?: string;
  children?: MarkdownSyntaxNode[];
  data?: { hName?: string };
}

function remarkHighlights() {
  return (tree: Root) => {
    const walk = (node: MarkdownSyntaxNode) => {
      if (
        !Array.isArray(node.children) ||
        node.type === "code" ||
        node.type === "inlineCode"
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") {
          walk(child);
          return [child];
        }
        return String(child.value)
          .split(/(==[^=\n]+==)/g)
          .filter(Boolean)
          .map((value) =>
            value.startsWith("==") && value.endsWith("==")
              ? {
                  type: "mark",
                  data: { hName: "mark" },
                  children: [{ type: "text", value: value.slice(2, -2) }],
                }
              : { type: "text", value },
          );
      });
    };
    walk(tree);
  };
}

function Mermaid({ source }: { source: string }) {
  const { appearance } = useAppearance();
  const ref = useRef<HTMLDivElement>(null);
  const [failedRender, setFailedRender] = useState<{
    source: string;
    appearance: string;
  } | null>(null);
  const error =
    failedRender?.source === source && failedRender.appearance === appearance;
  useEffect(() => {
    let live = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        const styles = getComputedStyle(
          ref.current || document.documentElement,
        );
        const color = (name: string, fallback: string) =>
          styles.getPropertyValue(name).trim() || fallback;
        const themed = appearance === "focus" || appearance === "soft";
        const themeVariables = themed
          ? {
              darkMode: false,
              background: color("--panel", "#ffffff"),
              primaryColor: color("--panel-2", "#f2edf2"),
              primaryTextColor: color("--text", "#302c40"),
              primaryBorderColor: color("--accent", "#9787c3"),
              secondaryColor: color("--panel", "#ffffff"),
              tertiaryColor: color("--bg", "#f7f8fb"),
              lineColor: color("--muted", "#7d718c"),
              textColor: color("--text", "#302c40"),
              edgeLabelBackground: color("--panel", "#ffffff"),
            }
          : appearance === "light"
            ? {
                darkMode: false,
                background: "#ffffff",
                primaryColor: "#efecfa",
                primaryTextColor: "#302c40",
                primaryBorderColor: "#9787c3",
                secondaryColor: "#eef3f7",
                tertiaryColor: "#f7f8fb",
                lineColor: "#7d718c",
                textColor: "#302c40",
              }
            : {
                darkMode: true,
                background: "#191c23",
                primaryColor: "#273447",
                primaryTextColor: "#e2e8f0",
                primaryBorderColor: "#6c88a8",
                secondaryColor: "#232b38",
                tertiaryColor: "#1d232d",
                lineColor: "#9aadc4",
                textColor: "#e2e8f0",
              };
        mermaid.initialize({
          startOnLoad: false,
          theme: appearance === "warp" ? "dark" : "base",
          securityLevel: "strict",
          fontFamily: "DM Sans, system-ui, sans-serif",
          ...(appearance === "warp" ? {} : { themeVariables }),
        });
        const { svg } = await mermaid.render(
          `diagram-${crypto.randomUUID().replace(/-/g, "")}`,
          source,
        );
        if (live && ref.current) {
          ref.current.innerHTML = svg;
          setFailedRender(null);
        }
      })
      .catch(() => {
        if (live) setFailedRender({ source, appearance });
      });
    return () => {
      live = false;
    };
  }, [source, appearance]);
  return error ? (
    <pre className="diagram-error">
      <code>{source}</code>
      <small>Check the Mermaid diagram syntax.</small>
    </pre>
  ) : (
    <div ref={ref} className="mermaid-diagram" aria-label="Mermaid diagram" />
  );
}

function fragment(note: Note, anchor: string) {
  if (!anchor) return note.content;
  if (anchor.startsWith("^")) {
    if (!/^[a-zA-Z0-9-]+$/.test(anchor.slice(1)))
      return "Use letters, numbers, or dashes for a block identifier.";
    const lines = note.content.split("\n");
    const end = lines.findIndex((line) => line.trim().endsWith(anchor));
    if (end < 0) return `Block ${anchor} was not found.`;
    let start = end;
    while (start > 0 && lines[start - 1].trim()) start--;
    return lines
      .slice(start, end + 1)
      .join("\n")
      .replace(new RegExp(`\\s*\\^${anchor.slice(1)}\\s*$`), "");
  }
  const lines = note.content.split("\n");
  const start = lines.findIndex(
    (line) =>
      /^#{1,6}\s/.test(line) &&
      headingSlug(line.replace(/^#+\s*/, "")) === headingSlug(anchor),
  );
  if (start < 0) return `Heading “${anchor}” was not found.`;
  const level = lines[start].match(/^#+/)![0].length;
  let end = start + 1;
  while (
    end < lines.length &&
    !new RegExp(`^#{1,${level}}\\s`).test(lines[end])
  )
    end++;
  return lines.slice(start, end).join("\n");
}

function resolveNote(workspace: Workspace, target: string) {
  return workspace.notes.find(
    (note) =>
      note.title.toLocaleLowerCase() === target.trim().toLocaleLowerCase() ||
      note.id === target.trim() ||
      `${note.folder}/${note.title}`.toLocaleLowerCase() ===
        target.trim().toLocaleLowerCase(),
  );
}

function wikiLinks(content: string, workspace: Workspace) {
  // Leave fenced and inline code untouched while converting wiki syntax into safe links.
  return content
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(/\[\[([^\]]+)\]\]/g, (_, value: string) => {
            const [target, alias] = value.split("|");
            const hash = target.indexOf("#");
            const title = hash < 0 ? target : target.slice(0, hash);
            const anchor = hash < 0 ? "" : target.slice(hash + 1);
            const note = resolveNote(workspace, title);
            const label = (alias || target).replace(/[\[\]]/g, "");
            return `[${label}](#note:${encodeURIComponent(note?.id || title)}:${encodeURIComponent(anchor)})`;
          }),
    )
    .join("");
}

export interface MarkdownProps {
  content: string;
  workspace: Workspace;
  onNoteClick: (id: string) => void;
}

function MarkdownAttachment({
  src,
  alt,
  workspace,
}: {
  src: string | undefined;
  alt: string | undefined;
  workspace: Workspace;
}) {
  const resolved = useOfflineMediaUrl(src);
  const id = src?.match(/^\/api\/media\/([A-Za-z0-9_-]{1,120})(?:[?#]|$)/)?.[1];
  const media = workspace.media.find(
    (item) => item.url === src || item.id === id,
  );
  const name = alt || media?.name || "Image";
  if (resolved.unavailable || resolved.loading)
    return <OfflineMediaUnavailable name={name} loading={resolved.loading} />;
  if (media?.type.startsWith("audio/"))
    return (
      <audio controls preload="metadata" src={resolved.url} aria-label={name} />
    );
  if (media?.type.startsWith("video/"))
    return (
      <video controls preload="metadata" src={resolved.url} aria-label={name} />
    );
  if (media?.type === "application/pdf")
    return (
      <span className="pdf-attachment">
        <iframe src={resolved.url} title={name} />
        <a href={resolved.url} target="_blank" rel="noopener noreferrer">
          Open {name} ↗
        </a>
      </span>
    );
  if (media && !media.type.startsWith("image/"))
    return (
      <a className="file-attachment" href={resolved.url} download={media.name}>
        {name} ↓
      </a>
    );
  // Authenticated attachment and ephemeral Blob URLs must not use a separate optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved.url} alt={alt || ""} loading="lazy" />;
}

function MarkdownBody({
  content,
  workspace,
  onNoteClick,
  visited = [],
}: {
  content: string;
  workspace: Workspace;
  onNoteClick: (id: string) => void;
  visited?: string[];
}) {
  const parts = content.split(/(!\[\[[^\]]+\]\])/g);
  const goToNote = (id: string, anchor: string) => {
    if (!workspace.notes.some((note) => note.id === id)) return;
    onNoteClick(id);
    if (anchor) {
      const target = anchor.startsWith("^")
        ? `block-${anchor.slice(1)}`
        : headingSlug(anchor);
      window.setTimeout(
        () =>
          document
            .getElementById(target)
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        180,
      );
    }
  };
  return (
    <>
      {parts.map((part, partIndex) => {
        if (part.startsWith("![[") && part.endsWith("]]")) {
          const target = part.slice(3, -2).split("|")[0];
          const hash = target.indexOf("#");
          const title = hash < 0 ? target : target.slice(0, hash);
          const anchor = hash < 0 ? "" : target.slice(hash + 1);
          const note = resolveNote(workspace, title);
          if (!note)
            return (
              <div className="note-embed missing" key={partIndex}>
                Embedded note “{title}” was not found.
              </div>
            );
          if (visited.includes(note.id) || visited.length >= 3)
            return (
              <button
                className="wiki-link embed-reference"
                key={partIndex}
                onClick={() => goToNote(note.id, anchor)}
              >
                ↗ {note.title}
              </button>
            );
          return (
            <section className="note-embed" key={partIndex}>
              <button
                className="embed-title"
                onClick={() => goToNote(note.id, anchor)}
              >
                ↗ {note.title}
                {anchor && ` · ${anchor}`}
              </button>
              <MarkdownBody
                content={fragment(note, anchor)}
                workspace={workspace}
                onNoteClick={onNoteClick}
                visited={[...visited, note.id]}
              />
            </section>
          );
        }
        if (!part) return null;
        return (
          <ReactMarkdown
            key={partIndex}
            remarkPlugins={[remarkGfm, remarkMath, remarkHighlights]}
            rehypePlugins={[
              rehypeKatex,
              [rehypeHighlight, { ignoreMissing: true }],
            ]}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("#note:")) {
                  let id: string, anchor: string | undefined;
                  try {
                    [id, anchor] = href
                      .slice(6)
                      .split(":")
                      .map((value) => decodeURIComponent(value));
                  } catch {
                    return (
                      <span
                        className="broken-link"
                        title="This note link contains an invalid address."
                      >
                        {children}
                      </span>
                    );
                  }
                  const exists = workspace.notes.some((note) => note.id === id);
                  return (
                    <button
                      className={`wiki-link ${exists ? "" : "broken-link"}`}
                      title={
                        exists
                          ? "Open linked note"
                          : "This note does not exist yet"
                      }
                      onClick={() => goToNote(id, anchor || "")}
                    >
                      {children}
                    </button>
                  );
                }
                if (href?.startsWith("#")) return <a href={href}>{children}</a>;
                if (
                  href &&
                  (workspace.media.some((file) => file.url === href) ||
                    /^\/api\/media\//.test(href))
                )
                  return (
                    <OfflineAttachmentLink
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </OfflineAttachmentLink>
                  );
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
              h1: ({ children }) => (
                <h1 id={headingSlug(textOf(children))}>{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 id={headingSlug(textOf(children))}>{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 id={headingSlug(textOf(children))}>{children}</h3>
              ),
              h4: ({ children }) => (
                <h4 id={headingSlug(textOf(children))}>{children}</h4>
              ),
              h5: ({ children }) => (
                <h5 id={headingSlug(textOf(children))}>{children}</h5>
              ),
              h6: ({ children }) => (
                <h6 id={headingSlug(textOf(children))}>{children}</h6>
              ),
              p: ({ children }) => {
                const arr = React.Children.toArray(children);
                const last = arr[arr.length - 1];
                const block =
                  typeof last === "string"
                    ? last.match(/\s+\^([a-zA-Z0-9-]+)\s*$/)
                    : null;
                if (block && typeof last === "string")
                  arr[arr.length - 1] = last.replace(
                    /\s+\^[a-zA-Z0-9-]+\s*$/,
                    "",
                  );
                return (
                  <p id={block ? `block-${block[1]}` : undefined}>{arr}</p>
                );
              },
              pre: ({ children }) => {
                const child = React.Children.toArray(children)[0];
                if (
                  React.isValidElement<{
                    className?: string;
                    children?: React.ReactNode;
                  }>(child) &&
                  child.props.className?.includes("language-mermaid")
                )
                  return (
                    <Mermaid source={textOf(child.props.children).trim()} />
                  );
                return <pre>{children}</pre>;
              },
              img: ({ src, alt }) => (
                <MarkdownAttachment
                  src={typeof src === "string" ? src : undefined}
                  alt={alt}
                  workspace={workspace}
                />
              ),
              table: ({ children }) => (
                <div className="markdown-table">
                  <table>{children}</table>
                </div>
              ),
              strong: ({ children }) => <strong>{children}</strong>,
            }}
          >
            {wikiLinks(part, workspace)}
          </ReactMarkdown>
        );
      })}
    </>
  );
}

export default function Markdown(props: MarkdownProps) {
  return (
    <div className="markdown">
      <MarkdownBody {...props} />
    </div>
  );
}
