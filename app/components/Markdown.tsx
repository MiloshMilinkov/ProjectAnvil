'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import './knowledge.css';
import type { Note, Workspace } from '../lib/types';

export const headingSlug = (text:string) => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s+/g,'-');
const textOf = (children:React.ReactNode):string => React.Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : React.isValidElement<{children?:React.ReactNode}>(child) ? textOf(child.props.children) : '').join('');

// Build highlight nodes directly in the Markdown tree, without accepting raw HTML.
function remarkHighlights(){
  return (tree:any)=>{
    const walk=(node:any)=>{
      if(!Array.isArray(node.children) || node.type==='code' || node.type==='inlineCode')return;
      node.children=node.children.flatMap((child:any)=>{
        if(child.type!=='text'){walk(child);return [child];}
        return String(child.value).split(/(==[^=\n]+==)/g).filter(Boolean).map(value=>value.startsWith('==') && value.endsWith('==')?{type:'mark',data:{hName:'mark'},children:[{type:'text',value:value.slice(2,-2)}]}:{type:'text',value});
      });
    };
    walk(tree);
  };
}

function Mermaid({ source }:{source:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let live=true;
    setError(false);
    import('mermaid').then(async ({default:mermaid})=>{
      mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'strict',fontFamily:'Inter, system-ui, sans-serif'});
      const {svg}=await mermaid.render(`diagram-${crypto.randomUUID().replace(/-/g,'')}`,source);
      if(live && ref.current) ref.current.innerHTML=svg;
    }).catch(()=>{if(live)setError(true);});
    return()=>{live=false;};
  },[source]);
  return error ? <pre className="diagram-error"><code>{source}</code><small>Check the Mermaid diagram syntax.</small></pre> : <div ref={ref} className="mermaid-diagram" aria-label="Mermaid diagram" />;
}

function fragment(note:Note, anchor:string) {
  if(!anchor)return note.content;
  if(anchor.startsWith('^')){
    const lines=note.content.split('\n');
    const end=lines.findIndex(line=>line.trim().endsWith(anchor));
    if(end<0)return `Block ${anchor} was not found.`;
    let start=end;
    while(start>0 && lines[start-1].trim())start--;
    return lines.slice(start,end+1).join('\n').replace(new RegExp(`\\s*\\^${anchor.slice(1)}\\s*$`),'');
  }
  const lines=note.content.split('\n');
  const start=lines.findIndex(line=>/^#{1,6}\s/.test(line) && headingSlug(line.replace(/^#+\s*/,''))===headingSlug(anchor));
  if(start<0)return `Heading “${anchor}” was not found.`;
  const level=lines[start].match(/^#+/)![0].length;
  let end=start+1;
  while(end<lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[end])))end++;
  return lines.slice(start,end).join('\n');
}

function resolveNote(workspace:Workspace,target:string){
  return workspace.notes.find(note=>note.title.toLocaleLowerCase()===target.trim().toLocaleLowerCase() || note.id===target.trim() || `${note.folder}/${note.title}`.toLocaleLowerCase()===target.trim().toLocaleLowerCase());
}

function wikiLinks(content:string,workspace:Workspace){
  // Leave fenced and inline code untouched while converting wiki syntax into safe links.
  return content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g).map((part,index)=>index%2?part:part.replace(/\[\[([^\]]+)\]\]/g,(_,value:string)=>{
    const [target,alias]=value.split('|');
    const hash=target.indexOf('#');
    const title=hash<0?target:target.slice(0,hash);
    const anchor=hash<0?'':target.slice(hash+1);
    const note=resolveNote(workspace,title);
    const label=(alias || target).replace(/[\[\]]/g,'');
    return `[${label}](#note:${encodeURIComponent(note?.id || title)}:${encodeURIComponent(anchor)})`;
  })).join('');
}

export interface MarkdownProps { content:string; workspace:Workspace; onNoteClick:(id:string)=>void }

function MarkdownBody({content,workspace,onNoteClick,visited=[]}:{content:string;workspace:Workspace;onNoteClick:(id:string)=>void;visited?:string[]}){
  const parts=content.split(/(!\[\[[^\]]+\]\])/g);
  const goToNote=(id:string,anchor:string)=>{
    if(!workspace.notes.some(note=>note.id===id))return;
    onNoteClick(id);
    if(anchor){
      const target=anchor.startsWith('^')?`block-${anchor.slice(1)}`:headingSlug(anchor);
      window.setTimeout(()=>document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'start'}),180);
    }
  };
  return <>{parts.map((part,partIndex)=>{
    if(part.startsWith('![[') && part.endsWith(']]')){
      const target=part.slice(3,-2).split('|')[0];
      const hash=target.indexOf('#');
      const title=hash<0?target:target.slice(0,hash);
      const anchor=hash<0?'':target.slice(hash+1);
      const note=resolveNote(workspace,title);
      if(!note)return <div className="note-embed missing" key={partIndex}>Embedded note “{title}” was not found.</div>;
      if(visited.includes(note.id) || visited.length>=3)return <button className="wiki-link embed-reference" key={partIndex} onClick={()=>goToNote(note.id,anchor)}>↗ {note.title}</button>;
      return <section className="note-embed" key={partIndex}><button className="embed-title" onClick={()=>goToNote(note.id,anchor)}>↗ {note.title}{anchor && ` · ${anchor}`}</button><MarkdownBody content={fragment(note,anchor)} workspace={workspace} onNoteClick={onNoteClick} visited={[...visited,note.id]}/></section>;
    }
    if(!part)return null;
    return <ReactMarkdown key={partIndex} remarkPlugins={[remarkGfm,remarkMath,remarkHighlights]} rehypePlugins={[rehypeKatex,[rehypeHighlight,{ignoreMissing:true}]]} components={{
      a:({href,children})=>{
        if(href?.startsWith('#note:')){
          const [id,anchor]=href.slice(6).split(':').map(value=>decodeURIComponent(value));
          const exists=workspace.notes.some(note=>note.id===id);
          return <button className={`wiki-link ${exists?'':'broken-link'}`} title={exists?'Open linked note':'This note does not exist yet'} onClick={()=>goToNote(id,anchor || '')}>{children}</button>;
        }
        if(href?.startsWith('#'))return <a href={href}>{children}</a>;
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      },
      h1:({children})=><h1 id={headingSlug(textOf(children))}>{children}</h1>,
      h2:({children})=><h2 id={headingSlug(textOf(children))}>{children}</h2>,
      h3:({children})=><h3 id={headingSlug(textOf(children))}>{children}</h3>,
      h4:({children})=><h4 id={headingSlug(textOf(children))}>{children}</h4>,
      h5:({children})=><h5 id={headingSlug(textOf(children))}>{children}</h5>,
      h6:({children})=><h6 id={headingSlug(textOf(children))}>{children}</h6>,
      p:({children})=>{
        const arr=React.Children.toArray(children);
        const last=arr[arr.length-1];
        const block=typeof last==='string'?last.match(/\s+\^([a-zA-Z0-9-]+)\s*$/):null;
        if(block && typeof last==='string')arr[arr.length-1]=last.replace(/\s+\^[a-zA-Z0-9-]+\s*$/,'');
        return <p id={block?`block-${block[1]}`:undefined}>{arr}</p>;
      },
      pre:({children})=>{
        const child=React.Children.toArray(children)[0];
        if(React.isValidElement<{className?:string;children?:React.ReactNode}>(child) && child.props.className?.includes('language-mermaid'))return <Mermaid source={textOf(child.props.children).trim()}/>;
        return <pre>{children}</pre>;
      },
      img:({src,alt})=>{
        const media=workspace.media.find(item=>item.url===src);
        if(media?.type.startsWith('audio/'))return <audio controls preload="metadata" src={String(src)} aria-label={alt || media.name}/>;
        if(media?.type.startsWith('video/'))return <video controls preload="metadata" src={String(src)} aria-label={alt || media.name}/>;
        if(media?.type==='application/pdf')return <span className="pdf-attachment"><iframe src={String(src)} title={alt || media.name}/><a href={String(src)} target="_blank" rel="noopener noreferrer">Open {alt || media.name} ↗</a></span>;
        if(media && !media.type.startsWith('image/'))return <a className="file-attachment" href={media.url} download={media.name}>{alt || media.name} ↓</a>;
        return <img src={src} alt={alt || ''} loading="lazy"/>;
      },
      table:({children})=><div className="markdown-table"><table>{children}</table></div>,
      strong:({children})=><strong>{children}</strong>,
    }}>{wikiLinks(part,workspace)}</ReactMarkdown>;
  })}</>;
}

export default function Markdown(props:MarkdownProps){
  return <div className="markdown"><MarkdownBody {...props}/></div>;
}
