'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Bookmark, CalendarDays, Check, ChevronLeft, ChevronRight, Columns2, Copy, ExternalLink, FileText, Folder, GitMerge, History, ImagePlus, Link2, LoaderCircle, Mic, MoreHorizontal, Plus, Presentation, Scissors, Search, Settings2, Square, Tag, Trash2, X } from 'lucide-react';
import type { FeatureProps, Media, Note, Workspace } from '../lib/types';
import { today, uid } from '../lib/types';
import Markdown from './Markdown';
import './knowledge.css';

type Props=FeatureProps & {selectedNote:string;mode:'notes'|'daily';tourActive?:boolean;onSelectNote:(id:string)=>void};
type Kind=Note['kind'];
type EditableKey='title'|'content'|'folder'|'tags'|'projectId'|'kind'|'bookmarked'|'properties';
const editableKeys:EditableKey[]=['title','content','folder','tags','projectId','kind','bookmarked','properties'];
type LocalEdit={value:Note[EditableKey];version:number};
const templates:{kind:Kind;label:string;description:string;folder:string;body:string}[]=[
  {kind:'note',label:'Blank note',description:'Give a new idea room to grow.',folder:'Notes',body:'# Overview\n\n'},
  {kind:'world',label:'Worldbuilding',description:'Places, histories, systems, and lore.',folder:'Worldbuilding',body:'# Overview\n\n## Atmosphere\n\n## History\n\n## Locations\n\n## Rules of the world\n\n## Open questions\n\n- [ ] Explore this idea\n'},
  {kind:'character',label:'Character',description:'Make someone worth remembering.',folder:'Characters',body:'# Identity\n\n| Property | Detail |\n| --- | --- |\n| Role | |\n| Motivation | |\n| Home | |\n\n## Backstory\n\n## Personality\n\n## Relationships\n\n## Character arc\n'},
  {kind:'research',label:'Research',description:'Sources, findings, and next steps.',folder:'Research',body:'# Question\n\n## Sources\n\n## Findings\n\n## Implications\n\n## Next steps\n\n- [ ] Review findings\n'},
  {kind:'meeting',label:'Meeting',description:'Decisions that become action.',folder:'Meetings',body:'# Agenda\n\n- \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n'},
  {kind:'daily',label:'Daily journal',description:'A small plan for a good day.',folder:'Journal',body:'# Today’s focus\n\n- [ ] \n\n## Development log\n\n## Ideas & discoveries\n\n## End-of-day reflection\n'},
];

function newNote(kind:Kind,title:string,projectId:string):Note {
  const template=templates.find(item=>item.kind===kind)!;
  const now=new Date().toISOString();
  return {id:uid(),title,content:template.body,kind,folder:template.folder,tags:[],projectId,bookmarked:false,properties:kind==='character'?{Role:'',Faction:'',Status:'Draft'}:{Status:'Draft'},snapshots:[],createdAt:now,updatedAt:now};
}
const shortDate=(value:string)=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const kindLabel=(kind:Kind)=>kind==='note'?'Note':templates.find(item=>item.kind===kind)?.label || 'Note';

export default function Knowledge({workspace,mutate,selectedNote,onSelectNote,mode,tourActive=false,projectFilter,openTask,openNote,notify}:Props){
  const [draft,setDraft]=useState<Note|null>(workspace.notes.find(note=>note.id===selectedNote) || null);
  const [view,setView]=useState<'edit'|'preview'|'split'>('split');
  const [search,setSearch]=useState('');
  const [folder,setFolder]=useState('all');
  const [tag,setTag]=useState('all');
  const [bookmarksOnly,setBookmarksOnly]=useState(false);
  const [newOpen,setNewOpen]=useState(false);
  const [newKind,setNewKind]=useState<Kind>('note');
  const [newTitle,setNewTitle]=useState('');
  const [creating,setCreating]=useState(false);
  const [saveState,setSaveState]=useState<'saved'|'saving'|'pending'|'error'>('saved');
  const [details,setDetails]=useState(true);
  const [snapshotsOpen,setSnapshotsOpen]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [mergeOpen,setMergeOpen]=useState(false);
  const [mergeId,setMergeId]=useState('');
  const [slides,setSlides]=useState(false);
  const [slideIndex,setSlideIndex]=useState(0);
  const [tagInput,setTagInput]=useState('');
  const [propertyName,setPropertyName]=useState('');
  const [uploading,setUploading]=useState(false);
  const [recording,setRecording]=useState(false);
  const [recordSeconds,setRecordSeconds]=useState(0);
  const [recordError,setRecordError]=useState('');
  const [mobileBrowser,setMobileBrowser]=useState(false);
  const [linkOpen,setLinkOpen]=useState(false);
  const draftRef=useRef(draft);
  const draftCache=useRef(new Map<string,Note>());
  const localEdits=useRef(new Map<string,Map<EditableKey,LocalEdit>>());
  const sentVersions=useRef(new Map<string,Map<EditableKey,number>>());
  const pending=useRef<Note|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  const mutateRef=useRef(mutate);
  const selectedRef=useRef(selectedNote);
  const version=useRef(0);
  const mounted=useRef(true);
  const editor=useRef<HTMLTextAreaElement>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const recorder=useRef<MediaRecorder|null>(null);
  const recordingStream=useRef<MediaStream|null>(null);
  const workspaceRef=useRef(workspace);
  mutateRef.current=mutate;
  workspaceRef.current=workspace;
  selectedRef.current=selectedNote;

  useEffect(()=>{if(window.innerWidth<=1050)setDetails(false);},[]);

  useEffect(()=>{
    if(mode!=='notes')return;
    const matching=workspace.notes.filter(note=>!projectFilter || projectFilter==='all' || note.projectId===projectFilter);
    if(workspace.notes.some(note=>note.id===selectedNote))return;
    const next=[...matching].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(next)onSelectNote(next.id);
    else if(selectedNote)onSelectNote('');
  },[mode,workspace.notes,projectFilter,selectedNote,onSelectNote]);

  const flush=useCallback(()=>{
    if(timer.current)clearTimeout(timer.current);
    timer.current=null;
    const note=pending.current;
    if(!note)return queue.current;
    pending.current=null;
    const changes=localEdits.current.get(note.id);
    const sent=sentVersions.current.get(note.id) || new Map<EditableKey,number>();
    const captured=[...(changes?.entries() || [])].filter(([key,change])=>change.version>(sent.get(key) || 0));
    if(!captured.length)return queue.current;
    for(const [key,change] of captured)sent.set(key,change.version);
    sentVersions.current.set(note.id,sent);
    if(mounted.current && selectedRef.current===note.id)setSaveState('saving');
    // Send only fields edited here. The server merges them with current teammate edits
    // and owns timestamps and snapshots; those fields never come from a local draft.
    const patch={id:note.id,...Object.fromEntries(captured.map(([key,change])=>[key,change.value]))};
    queue.current=queue.current.catch(()=>{}).then(()=>mutateRef.current({action:'upsert',entity:'notes',item:patch})).then(updated=>{
      const committed=updated.notes.find(item=>item.id===note.id);
      if(!committed)return;
      const remaining=localEdits.current.get(note.id) || new Map<EditableKey,LocalEdit>();
      for(const [key,change] of captured)if(remaining.get(key)?.version===change.version)remaining.delete(key);
      if(remaining.size)localEdits.current.set(note.id,remaining);else localEdits.current.delete(note.id);
      const rebased={...committed,...Object.fromEntries([...remaining.entries()].map(([key,change])=>[key,change.value]))} as Note;
      if(remaining.size)draftCache.current.set(note.id,rebased);else draftCache.current.delete(note.id);
      if(draftRef.current?.id===note.id){
        draftRef.current=rebased;
        if(mounted.current){
          setDraft(rebased);
          const hasUnsent=[...remaining.entries()].some(([key,change])=>change.version>(sentVersions.current.get(note.id)?.get(key) || 0));
          setSaveState(remaining.size?(hasUnsent?'pending':'saving'):'saved');
        }
      }
    }).catch(()=>{
      for(const [key,change] of captured)if(sentVersions.current.get(note.id)?.get(key)===change.version)sentVersions.current.get(note.id)?.set(key,0);
      if(!draftCache.current.has(note.id))draftCache.current.set(note.id,note);
      if(!pending.current && draftRef.current?.id===note.id)pending.current=draftRef.current;
      if(mounted.current && selectedRef.current===note.id)setSaveState('error');
      else if(mounted.current)notify('A note could not be saved. Open it again to retry; your edits are kept in this session.');
    });
    return queue.current;
  },[]);

  const edit=useCallback((patch:Partial<Note>)=>{
    if(!draftRef.current)return;
    const next={...draftRef.current,...patch};
    version.current++;
    const changes=localEdits.current.get(next.id) || new Map<EditableKey,LocalEdit>();
    for(const key of editableKeys)if(key in patch && JSON.stringify(patch[key])!==JSON.stringify(draftRef.current[key]))changes.set(key,{value:next[key],version:version.current});
    if(!changes.size)return;
    localEdits.current.set(next.id,changes);
    draftRef.current=next;
    draftCache.current.set(next.id,next);
    pending.current=next;
    setDraft(next);
    setSaveState('pending');
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>{void flush();},650);
  },[flush]);

  useEffect(()=>{
    void flush();
    const cached=draftCache.current.get(selectedNote);
    const note=cached || workspaceRef.current.notes.find(item=>item.id===selectedNote) || null;
    draftRef.current=note;
    setDraft(note);
    setSaveState(cached?'pending':'saved');
    setMoreOpen(false);
    setMobileBrowser(false);
    setTagInput('');
    version.current++;
    if(cached){pending.current=cached;timer.current=setTimeout(()=>void flush(),650);}
  },[selectedNote,flush]);

  // Rebase local dirty fields on teammate updates while keeping committed history.
  useEffect(()=>{
    const incoming=workspace.notes.find(note=>note.id===selectedNote);
    if(incoming && draftRef.current?.id===incoming.id && incoming.updatedAt!==draftRef.current.updatedAt){
      const changes=localEdits.current.get(incoming.id);
      const rebased={...incoming,...Object.fromEntries([...(changes?.entries() || [])].map(([key,change])=>[key,change.value]))} as Note;
      if(changes?.size)draftCache.current.set(incoming.id,rebased);
      draftRef.current=rebased;setDraft(rebased);
    }
  },[workspace.notes,selectedNote]);

  useEffect(()=>{
    mounted.current=true;
    return()=>{void flush();mounted.current=false;recorder.current?.stop();recordingStream.current?.getTracks().forEach(track=>track.stop());};
  },[flush]);

  useEffect(()=>{
    if(!recording)return;
    const interval=setInterval(()=>setRecordSeconds(seconds=>seconds+1),1000);
    return()=>clearInterval(interval);
  },[recording]);

  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if((event.ctrlKey || event.metaKey) && event.key==='s'){event.preventDefault();void flush();}
      if(event.key==='Escape'){setSlides(false);setNewOpen(false);setMoreOpen(false);setLinkOpen(false);}
      if(slides && event.key==='ArrowRight')setSlideIndex(index=>Math.min(index+1,(draftRef.current?.content.split(/^---\s*$/m).length || 1)-1));
      if(slides && event.key==='ArrowLeft')setSlideIndex(index=>Math.max(0,index-1));
    };
    window.addEventListener('keydown',handle);
    return()=>window.removeEventListener('keydown',handle);
  },[slides,flush]);

  const create=async(kind:Kind,title:string)=>{
    if(creating)return;
    setCreating(true);
    try{
      await flush();
      const note=newNote(kind,title.trim() || (kind==='daily'?today():'Untitled note'),projectFilter==='all'?'':projectFilter);
      const updated=await mutate({action:'upsert',entity:'notes',item:note});
      const committed=updated.notes.find(item=>item.id===note.id) || note;
      draftRef.current=committed;setDraft(committed);onSelectNote(note.id);setNewOpen(false);setNewTitle('');
      notify(`${kind==='daily'?'Daily journal':'Note'} created`);
    }catch{notify('Could not create the note. Please try again.');}
    finally{setCreating(false);}
  };

  const dailyMode=useRef(false);
  useEffect(()=>{
    if(tourActive || mode!=='daily'){dailyMode.current=false;return;}
    if(dailyMode.current)return;
    dailyMode.current=true;
    const note=workspaceRef.current.notes.find(item=>item.kind==='daily' && item.title===today());
    if(note)onSelectNote(note.id);
    else void create('daily',today());
  },[mode,tourActive]);

  const notes=workspace.notes.filter(note=>(mode!=='daily' || note.kind==='daily') && (projectFilter==='all' || !projectFilter || note.projectId===projectFilter));
  const folders=[...new Set(notes.map(note=>note.folder || 'Notes'))].sort();
  const tags=[...new Set(notes.flatMap(note=>note.tags))].sort();
  const visible=notes.filter(note=>(folder==='all' || (note.folder || 'Notes')===folder) && (tag==='all' || note.tags.includes(tag)) && (!bookmarksOnly || note.bookmarked) && `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const linkedTasks=draft?workspace.tasks.filter(task=>task.noteIds.includes(draft.id)):[];
  const backlinks=draft?workspace.notes.filter(note=>note.id!==draft.id && new RegExp(`\\[\\[${draft.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:[#|\\]])`,'i').test(note.content)):[];
  const wordCount=draft?.content.trim().split(/\s+/).filter(Boolean).length || 0;

  const insert=(text:string)=>{
    const current=draftRef.current;
    if(!current)return;
    const field=editor.current;
    const start=field?.selectionStart ?? current.content.length;
    const end=field?.selectionEnd ?? current.content.length;
    edit({content:current.content.slice(0,start)+text+current.content.slice(end)});
    setTimeout(()=>{field?.focus();field?.setSelectionRange(start+text.length,start+text.length);},0);
  };

  const upload=async(file:File,targetNoteId?:string)=>{
    const target=targetNoteId || draftRef.current?.id;
    if(!target)return;
    setUploading(true);setRecordError('');
    try{
      const data=new FormData();data.append('file',file);
      const response=await fetch('/api/media',{method:'POST',body:data});
      if(!response.ok)throw new Error('Upload failed');
      const {media,workspace:updatedWorkspace}=await response.json() as {media?:Media;workspace?:Workspace;error?:string};
      if(!media?.url)throw new Error('No file URL returned');
      // The upload route stores media in the shared workspace; upsert also refreshes clients.
      if(!updatedWorkspace)await mutate({action:'upsert',entity:'media',item:media});
      const syntax=`\n![${file.name.replace(/[\[\]]/g,'')}](${media.url})\n`;
      if(draftRef.current?.id===target)insert(syntax);
      else {
        const note=workspaceRef.current.notes.find(item=>item.id===target);
        if(note)await mutate({action:'upsert',entity:'notes',item:{id:note.id,content:note.content+syntax}});
      }
      notify('Attachment added');
    }catch{notify('The attachment could not be uploaded. Please try again.');}
    finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
  };

  const startRecording=async()=>{
    if(recording){recorder.current?.stop();return;}
    if(!draftRef.current)return;
    setRecordError('');
    try{
      if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined')throw new Error('unsupported');
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      recordingStream.current=stream;
      const type=['audio/webm','audio/mp4','audio/ogg'].find(format=>MediaRecorder.isTypeSupported(format));
      const device=new MediaRecorder(stream,type?{mimeType:type}:undefined);
      const chunks:BlobPart[]=[];
      const target=draftRef.current.id;
      device.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      device.onstop=()=>{
        stream.getTracks().forEach(track=>track.stop());
        setRecording(false);setRecordSeconds(0);
        if(chunks.length && mounted.current){
          const mime=device.mimeType || 'audio/webm';
          void upload(new File(chunks,`Voice note ${new Date().toISOString().slice(0,16).replace(/:/g,'-')}.${mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm'}`,{type:mime}),target);
        }
      };
      recorder.current=device;device.start();setRecording(true);
    }catch{setRecordError('Microphone access is unavailable. Allow microphone access in your browser and try again.');}
  };

  const exportNote=()=>{
    if(!draft)return;
    const blob=new Blob([`# ${draft.title}\n\n${draft.content}`],{type:'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`${draft.title.replace(/[^a-zA-Z0-9 _-]/g,'') || 'note'}.md`;anchor.click();URL.revokeObjectURL(url);setMoreOpen(false);
  };
  const splitSelection=async()=>{
    const current=draftRef.current;const field=editor.current;
    if(!current || !field || field.selectionEnd===field.selectionStart){notify('Select some text in the editor to move it into a new note.');setView('edit');setMoreOpen(false);return;}
    const text=current.content.slice(field.selectionStart,field.selectionEnd);
    const title=text.split('\n')[0].replace(/^#+\s*/, '').slice(0,70) || 'Extracted idea';
    const note={...newNote('note',title,current.projectId),folder:current.folder,content:text,tags:current.tags};
    try{await mutate({action:'upsert',entity:'notes',item:note});edit({content:current.content.slice(0,field.selectionStart)+`[[${note.title}]]`+current.content.slice(field.selectionEnd)});void flush();notify('Selection moved into a linked note');setMoreOpen(false);}catch{notify('Could not split this note. Please try again.');}
  };
  const merge=async()=>{
    if(!draft || !mergeId)return;
    const other=workspace.notes.find(note=>note.id===mergeId);if(!other)return;
    edit({content:`${draft.content}\n\n---\n\n# ${other.title}\n\n${other.content}`});
    await flush();setMergeOpen(false);notify('Note contents combined. Both original notes remain available.');
  };
  const remove=async()=>{
    if(!draft)return;
    if(timer.current)clearTimeout(timer.current);pending.current=null;
    try{await queue.current;await mutate({action:'delete',entity:'notes',id:draft.id});localEdits.current.delete(draft.id);sentVersions.current.delete(draft.id);draftCache.current.delete(draft.id);onSelectNote(notes.find(note=>note.id!==draft.id)?.id || '');setDeleteOpen(false);notify('Note deleted');}catch{notify('Could not delete the note.');}
  };
  const slidesContent=draft?.content.split(/^---\s*$/m) || [];

  return <div className={`knowledge ${mode==='daily'?'daily-knowledge':''}`}>
    <aside className={`note-browser ${mobileBrowser?'mobile-visible':''}`}>
      <div className="note-browser-title"><span>{mode==='daily'?<CalendarDays size={18}/>:<BookOpen size={18}/>} {mode==='daily'?'Daily journal':'Knowledge base'}</span><button className="btn-icon" title="New note" onClick={()=>{setNewKind(mode==='daily'?'daily':'note');setNewOpen(true);}}><Plus size={17}/></button></div>
      <label className="note-search"><Search size={15}/><input aria-label="Search notes" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find a note…"/><kbd>⌕</kbd></label>
      <div className="note-scope"><button className={bookmarksOnly?'active':''} onClick={()=>setBookmarksOnly(value=>!value)}><Bookmark size={13} fill={bookmarksOnly?'currentColor':'none'}/> Bookmarked</button><span>{notes.length} notes</span></div>
      <div className="note-filter-row"><label><Folder size={13}/><select aria-label="Filter notes by folder" value={folder} onChange={event=>setFolder(event.target.value)}><option value="all">All folders</option>{folders.map(item=><option key={item}>{item}</option>)}</select></label><label><Tag size={13}/><select aria-label="Filter notes by tag" value={tag} onChange={event=>setTag(event.target.value)}><option value="all">All tags</option>{tags.map(item=><option key={item}>{item}</option>)}</select></label></div>
      <div className="note-list">{visible.length?visible.map(note=><button key={note.id} className={`note-list-item ${selectedNote===note.id?'selected':''}`} onClick={()=>onSelectNote(note.id)}><div className="note-list-item-top"><span className={`note-type-symbol kind-${note.kind}`}>{note.kind==='daily'?<CalendarDays size={16}/>:<FileText size={16}/>}</span><span className="note-list-name">{note.title || 'Untitled note'}</span>{note.bookmarked && <Bookmark size={12} className="note-bookmarked" fill="currentColor"/>}</div><p>{note.content.replace(/[#*\[\]`>_=]/g,'').replace(/\s+/g,' ').slice(0,90) || 'A blank page, a new possibility.'}</p><div className="note-list-meta"><span>{note.folder}</span><span>{shortDate(note.updatedAt)}</span></div></button>):<div className="note-list-empty"><Search size={25}/><p>No notes here yet.</p><button className="btn" onClick={()=>setNewOpen(true)}>Create a note</button></div>}</div>
      <div className="note-browser-footer"><div className="note-vault-dot"/><span>Your studio knowledge</span><button className="btn-icon" title="New note from template" onClick={()=>setNewOpen(true)}><Plus size={15}/></button></div>
    </aside>

    <main className="note-workspace">
      {draft ? <>
        <div className="note-toolbar"><div className="note-breadcrumb"><button className="btn-icon mobile-note-toggle" title="Browse notes" onClick={()=>setMobileBrowser(value=>!value)}><BookOpen size={17}/></button><Folder size={14}/><span>{draft.folder || 'Notes'}</span><ChevronRight size={12}/><span className="note-breadcrumb-current">{draft.title}</span></div><div className="note-toolbar-actions"><span className={`note-save-state ${saveState}`}>{saveState==='saving'?<LoaderCircle size={12} className="spin"/>:saveState==='error'?<button onClick={()=>void flush()}>Retry save</button>:saveState==='pending'?<span className="pending-dot"/>:<Check size={12}/>}<span>{saveState==='saved'?'Saved':saveState==='saving'?'Saving…':saveState==='pending'?'Unsaved':'Save failed'}</span></span><button className={`btn-icon ${draft.bookmarked?'bookmarked':''}`} aria-label={draft.bookmarked?'Remove bookmark':'Bookmark note'} onClick={()=>edit({bookmarked:!draft.bookmarked})}><Bookmark size={16} fill={draft.bookmarked?'currentColor':'none'}/></button><button className={`btn-icon ${details?'is-active':''}`} aria-label="Toggle note details" onClick={()=>setDetails(value=>!value)}><Settings2 size={16}/></button><div className="note-more-wrap"><button className="btn-icon" aria-label="More note actions" onClick={()=>setMoreOpen(value=>!value)}><MoreHorizontal size={18}/></button>{moreOpen && <div className="note-menu"><button onClick={()=>{setSnapshotsOpen(true);setMoreOpen(false);}}><History size={15}/>Version history</button><button onClick={()=>{setSlideIndex(0);setSlides(true);setMoreOpen(false);}}><Presentation size={15}/>Present as slides</button><button onClick={()=>{window.open(`${window.location.pathname}?note=${encodeURIComponent(draft.id)}&focus=1`,'_blank','noopener,noreferrer');setMoreOpen(false);}}><ExternalLink size={15}/>Open in a new window</button><button onClick={splitSelection}><Scissors size={15}/>Extract selected text</button><button onClick={()=>{setMergeOpen(true);setMergeId('');setMoreOpen(false);}}><GitMerge size={15}/>Combine with another note</button><button onClick={exportNote}><ArrowDownToLine size={15}/>Export Markdown</button><button onClick={async()=>{try{await navigator.clipboard.writeText(`[[${draft.title}]]`);notify('Note link copied');setMoreOpen(false);}catch{notify('Clipboard is unavailable in this browser.');}}}><Copy size={15}/>Copy note link</button><button className="danger" onClick={()=>{setDeleteOpen(true);setMoreOpen(false);}}><Trash2 size={15}/>Delete note</button></div>}</div></div></div>

        <div className="note-content-shell"><div className="note-document">
          <div className="note-heading"><div className="note-kind-label"><span/>{kindLabel(draft.kind)}<span className="note-heading-date">Updated {shortDate(draft.updatedAt)}</span></div><input className="note-title-input" aria-label="Note title" value={draft.title} placeholder="Untitled note" onChange={event=>edit({title:event.target.value})}/><div className="note-tags">{draft.tags.map(item=><span className="note-tag" key={item}>#{item}<button aria-label={`Remove tag ${item}`} onClick={()=>edit({tags:draft.tags.filter(value=>value!==item)})}><X size={10}/></button></span>)}<input aria-label="Add tag" placeholder="+ Add tag" value={tagInput} onChange={event=>setTagInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter' || event.key===','){event.preventDefault();const value=tagInput.trim().replace(/^#/,'').replace(/,/g,'');if(value && !draft.tags.includes(value))edit({tags:[...draft.tags,value]});setTagInput('');}}}/></div></div>
          <div className="note-editor-toolbar"><div className="note-view-switch"><button className={view==='edit'?'active':''} onClick={()=>setView('edit')}>Write</button><button className={view==='split'?'active':''} onClick={()=>setView('split')}><Columns2 size={13}/>Split</button><button className={view==='preview'?'active':''} onClick={()=>setView('preview')}>Read</button></div><div className="note-format-tools"><button title="Heading" onClick={()=>insert('\n## Heading\n')}>H₂</button><button title="Bold text" onClick={()=>insert('**bold text**')}><strong>B</strong></button><button title="Checklist" onClick={()=>insert('\n- [ ] ')}>☑</button><button title="Link a note" onClick={()=>setLinkOpen(value=>!value)}><Link2 size={15}/></button><button title="Attach an image, PDF, audio, or video" onClick={()=>fileInput.current?.click()} disabled={uploading}>{uploading?<LoaderCircle size={15} className="spin"/>:<ImagePlus size={15}/>}</button><button className={recording?'is-recording':''} title={recording?'Stop recording':'Record audio'} onClick={()=>void startRecording()}>{recording?<Square size={13} fill="currentColor"/>:<Mic size={15}/>}</button>{recording && <span className="record-time">{Math.floor(recordSeconds/60)}:{String(recordSeconds%60).padStart(2,'0')}</span>}</div></div>
          {linkOpen && <div className="note-link-picker"><div><span>Link to a note</span><button className="btn-icon" aria-label="Close note picker" onClick={()=>setLinkOpen(false)}><X size={14}/></button></div>{workspace.notes.filter(note=>note.id!==draft.id).map(note=><button key={note.id} onClick={()=>{insert(`[[${note.title}]]`);setLinkOpen(false);}}><FileText size={13}/>{note.title}<span>{note.folder}</span></button>)}{workspace.notes.length<2 && <p>Create another note to connect it here.</p>}</div>}
          {recordError && <div className="note-inline-error">{recordError}<button onClick={()=>setRecordError('')} aria-label="Dismiss microphone message"><X size={13}/></button></div>}
          <div className={`note-editing-area view-${view}`} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();void upload(event.dataTransfer.files[0]);}}}>
            {view!=='preview' && <div className="note-source-pane"><div className="note-pane-label">MARKDOWN</div><textarea ref={editor} aria-label="Note content" spellCheck value={draft.content} placeholder="Start writing. Use [[note names]] to connect your ideas…" onChange={event=>edit({content:event.target.value})} onKeyDown={event=>{if(event.key==='Tab'){event.preventDefault();insert('  ');}}}/></div>}
            {view!=='edit' && <div className="note-preview-pane">{view==='split' && <div className="note-pane-label">PREVIEW</div>}<Markdown content={draft.content} workspace={workspace} onNoteClick={openNote}/>{!draft.content && <div className="note-preview-empty">Your next great idea starts here.</div>}</div>}
          </div>
          <div className="note-statusbar"><span>{wordCount} words <i>·</i> {draft.content.length.toLocaleString()} characters</span><span>Markdown <i>·</i> {Math.max(1,Math.ceil(wordCount/200))} min read</span></div>
        </div>

        {details && <aside className="note-details"><div className="note-details-title">NOTE DETAILS<button className="btn-icon" aria-label="Close note details" onClick={()=>setDetails(false)}><X size={13}/></button></div><div className="note-details-section"><h3>Properties</h3><label className="note-property"><span>Folder</span><input value={draft.folder} onChange={event=>edit({folder:event.target.value})}/></label><label className="note-property"><span>Project</span><select value={draft.projectId} onChange={event=>edit({projectId:event.target.value})}><option value="">No project</option>{workspace.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="note-property"><span>Template</span><select value={draft.kind} onChange={event=>edit({kind:event.target.value as Kind})}>{templates.map(item=><option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label>{Object.entries(draft.properties).map(([key,value])=><label className="note-property" key={key}><span title={key}>{key}</span><input value={value} placeholder="Empty" onChange={event=>edit({properties:{...draft.properties,[key]:event.target.value}})}/><button aria-label={`Remove property ${key}`} onClick={()=>{const properties={...draft.properties};delete properties[key];edit({properties});}}><X size={10}/></button></label>)}<form className="note-add-property" onSubmit={event=>{event.preventDefault();const key=propertyName.trim();if(key && !(key in draft.properties)){edit({properties:{...draft.properties,[key]:''}});setPropertyName('');}}}><Plus size={12}/><input value={propertyName} onChange={event=>setPropertyName(event.target.value)} placeholder="Add property" aria-label="New property name"/>{propertyName && <button type="submit" aria-label="Add property"><Check size={12}/></button>}</form></div>
          <div className="note-details-section"><h3><Link2 size={13}/>Backlinks<span>{backlinks.length}</span></h3>{backlinks.map(note=><button key={note.id} className="note-related" onClick={()=>openNote(note.id)}><FileText size={13}/><div><strong>{note.title}</strong><small>{note.folder}</small></div><ArrowUpRight size={12}/></button>)}{!backlinks.length && <p className="note-details-empty">Notes that link here will appear here. Connect an idea with <code>[[{draft.title}]]</code>.</p>}</div>
          <div className="note-details-section"><h3>Linked tasks<span>{linkedTasks.length}</span></h3>{linkedTasks.map(task=><button key={task.id} className="note-related" onClick={()=>openTask(task.id)}><span className={`linked-task-dot ${task.status}`}/><div><small>{task.key}</small><strong>{task.title}</strong></div><ArrowUpRight size={12}/></button>)}{!linkedTasks.length && <p className="note-details-empty">Link this note from a task to keep the plan and the work connected.</p>}</div>
          <div className="note-details-section note-syntax-help"><h3>A little writing magic</h3><p><code>[[Note title]]</code> connect ideas</p><p><code>![[Note title]]</code> embed a note</p><p><code>[[Note#Heading]]</code> link a section</p><p><code>- [ ]</code> create a checklist</p><p><code>$$ equation $$</code> write math</p><button onClick={()=>{setSnapshotsOpen(true);}}><History size={13}/>Version history <ChevronRight size={12}/></button></div>
        </aside>}
        </div>
      </> : <div className="knowledge-empty"><div><BookOpen size={32}/></div><span className="eyebrow">IDEAS BECOME WORLDS</span><h2>A home for everything you know.</h2><p>Capture a fleeting thought, build a character, or document the world your team is creating. Every idea can connect to the next.</p><button className="btn btn-primary" onClick={()=>setNewOpen(true)}><Plus size={16}/>{workspace.notes.length?'Create a note':'Create your first note'}</button><button className="btn mobile-note-toggle" onClick={()=>setMobileBrowser(true)}>Browse notes</button></div>}
    </main>
    <input ref={fileInput} type="file" className="note-hidden-input" accept="image/*,audio/*,video/*,application/pdf,.txt,.md" onChange={event=>{if(event.target.files?.[0])void upload(event.target.files[0]);}}/>

    {newOpen && <div className="knowledge-modal-backdrop" onClick={()=>!creating && setNewOpen(false)}><section className="knowledge-modal new-note-modal" onClick={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Create note"><div className="knowledge-modal-heading"><div><span className="eyebrow">MAKE SPACE FOR AN IDEA</span><h2>Create a note</h2></div><button className="btn-icon" aria-label="Close" onClick={()=>setNewOpen(false)}><X size={19}/></button></div><label className="note-new-title">Note title<input className="field" autoFocus value={newTitle} onChange={event=>setNewTitle(event.target.value)} placeholder={newKind==='daily'?today():'Give your idea a name…'} onKeyDown={event=>{if(event.key==='Enter')void create(newKind,newTitle);}}/></label><div className="note-template-label">START WITH A TEMPLATE</div><div className="note-template-grid">{templates.map(item=><button className={newKind===item.kind?'selected':''} key={item.kind} onClick={()=>setNewKind(item.kind)}><span className="note-template-icon">{item.kind==='daily'?<CalendarDays size={18}/>:<FileText size={18}/>}</span><strong>{item.label}</strong><p>{item.description}</p>{newKind===item.kind && <Check size={14} className="template-check"/>}</button>)}</div><div className="knowledge-modal-footer"><button className="btn" onClick={()=>setNewOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={creating} onClick={()=>void create(newKind,newTitle)}>{creating?<LoaderCircle size={15} className="spin"/>:<Plus size={15}/>}Create note</button></div></section></div>}

    {snapshotsOpen && draft && <div className="knowledge-modal-backdrop" onClick={()=>setSnapshotsOpen(false)}><section className="knowledge-modal snapshots-modal" onClick={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Version history"><div className="knowledge-modal-heading"><div><span className="eyebrow">NOTHING GOOD GETS LOST</span><h2>Version history</h2></div><button className="btn-icon" aria-label="Close version history" onClick={()=>setSnapshotsOpen(false)}><X size={18}/></button></div><p className="knowledge-modal-description">Up to 12 earlier versions are saved automatically as you write. Restoring a version also preserves your current content.</p>{draft.snapshots.length?[...draft.snapshots].reverse().map(snapshot=><div className="note-snapshot" key={snapshot.id}><div><strong>{new Date(snapshot.savedAt).toLocaleString()}</strong><pre>{snapshot.content.slice(0,230) || 'Empty note'}</pre></div><button className="btn" onClick={()=>{edit({content:snapshot.content});void flush();setSnapshotsOpen(false);notify('Earlier version restored');}}>Restore</button></div>):<div className="note-list-empty"><History size={28}/><p>Your earlier versions will appear as you edit this note.</p></div>}</section></div>}

    {mergeOpen && draft && <div className="knowledge-modal-backdrop" onClick={()=>setMergeOpen(false)}><section className="knowledge-modal compact-modal" onClick={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Combine notes"><div className="knowledge-modal-heading"><h2>Combine notes</h2><button className="btn-icon" aria-label="Close" onClick={()=>setMergeOpen(false)}><X size={18}/></button></div><p className="knowledge-modal-description">Append another note to “{draft.title}”. The original note stays available so existing links keep working.</p><select className="field" value={mergeId} onChange={event=>setMergeId(event.target.value)}><option value="">Choose a note…</option>{workspace.notes.filter(note=>note.id!==draft.id).map(note=><option value={note.id} key={note.id}>{note.title}</option>)}</select><div className="knowledge-modal-footer"><button className="btn" onClick={()=>setMergeOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!mergeId} onClick={()=>void merge()}><GitMerge size={15}/>Combine</button></div></section></div>}

    {deleteOpen && draft && <div className="knowledge-modal-backdrop" onClick={()=>setDeleteOpen(false)}><section className="knowledge-modal compact-modal" onClick={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Delete note"><div className="knowledge-modal-heading"><h2>Delete this note?</h2><button className="btn-icon" aria-label="Close" onClick={()=>setDeleteOpen(false)}><X size={18}/></button></div><p className="knowledge-modal-description">“{draft.title}” and its saved versions will be removed from your workspace.</p><div className="knowledge-modal-footer"><button className="btn" onClick={()=>setDeleteOpen(false)}>Keep note</button><button className="btn note-delete-button" onClick={()=>void remove()}><Trash2 size={15}/>Delete note</button></div></section></div>}

    {slides && draft && <div className="knowledge-slides" role="dialog" aria-modal="true" aria-label="Note presentation"><div className="slides-toolbar"><span><Presentation size={16}/>{draft.title}</span><button className="btn-icon" aria-label="Close presentation" onClick={()=>setSlides(false)}><X size={21}/></button></div><div className="slides-content"><Markdown content={slidesContent[slideIndex] || ''} workspace={workspace} onNoteClick={id=>{setSlides(false);openNote(id);}}/></div><div className="slides-footer"><span>Separate slides with <code>---</code> in your note.</span><div><button className="btn-icon" aria-label="Previous slide" disabled={slideIndex===0} onClick={()=>setSlideIndex(index=>index-1)}><ChevronLeft size={20}/></button><span>{slideIndex+1} / {slidesContent.length}</span><button className="btn-icon" aria-label="Next slide" disabled={slideIndex>=slidesContent.length-1} onClick={()=>setSlideIndex(index=>index+1)}><ChevronRight size={20}/></button></div></div></div>}
  </div>;
}

