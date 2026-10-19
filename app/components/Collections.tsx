'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, BookOpen, CalendarDays, Check, ChevronDown, Columns3, Database, FileText, Folder, GalleryHorizontalEnd, GripVertical, Hash, LayoutList, ListFilter, LoaderCircle, Network, Plus, Search, SlidersHorizontal, Table2, Users, X } from 'lucide-react';
import type { FeatureProps, Note } from '../lib/types';
import './collections.css';

type Layout='table'|'list'|'gallery'|'kanban';
type Preferences={layout:Layout;query:string;project:string;kind:string;tag:string;sort:string;descending:boolean;group:string;columns:string[];columnsConfigured:boolean;extraColumns:string[];summaryProperty:string;summaryOperation:'sum'|'average'|'count'};
const defaults:Preferences={layout:'table',query:'',project:'',kind:'',tag:'',sort:'title',descending:false,group:'none',columns:[],columnsConfigured:false,extraColumns:[],summaryProperty:'',summaryOperation:'sum'};
const layouts:{id:Layout;label:string;icon:typeof Table2}[]=[{id:'table',label:'Table',icon:Table2},{id:'list',label:'List',icon:LayoutList},{id:'gallery',label:'Gallery',icon:GalleryHorizontalEnd},{id:'kanban',label:'Board',icon:Columns3}];
const kinds=['note','world','character','research','daily','meeting'];
const kindIcons:Record<string,typeof BookOpen>={note:FileText,world:Network,character:Users,research:BookOpen,daily:CalendarDays,meeting:Users};
const label=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
const words=(note:Note)=>note.content.trim().split(/\s+/).filter(Boolean).length;
const excerpt=(content:string)=>content.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[#*`\[\]>_=]/g,'').replace(/\s+/g,' ').trim();
const numeric=(text:string)=>text.trim()!=='' && Number.isFinite(Number(text));
const format=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:2});
const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});

function PropertyCell({value,onCommit,name,numeric:asNumber=false}:{value:string;onCommit:(value:string)=>void;name:string;numeric?:boolean}){
  const [draft,setDraft]=useState(value);
  const focused=useRef(false);
  useEffect(()=>{if(!focused.current)setDraft(value);},[value]);
  return <input className={`base-property-input ${asNumber?'numeric':''}`} aria-label={name} value={draft} placeholder="—" inputMode={asNumber?'decimal':'text'} onFocus={()=>{focused.current=true;}} onChange={event=>setDraft(event.target.value)} onBlur={()=>{focused.current=false;if(draft!==value)onCommit(draft);}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){setDraft(value);event.currentTarget.blur();}}}/>;
}

export default function Collections({workspace,mutate,projectFilter,openNote,notify}:FeatureProps){
  const [prefs,setPrefs]=useState<Preferences>(defaults);
  const [ready,setReady]=useState(false);
  const [optionsOpen,setOptionsOpen]=useState(false);
  const [propertyName,setPropertyName]=useState('');
  const [dragging,setDragging]=useState('');
  const [dragColumn,setDragColumn]=useState('');
  const [saving,setSaving]=useState(0);
  const [saveError,setSaveError]=useState(false);
  const [optimistic,setOptimistic]=useState<Record<string,Record<string,string>>>({});
  const workspaceRef=useRef(workspace);
  const mutateRef=useRef(mutate);
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  const propertyVersions=useRef(new Map<string,number>());
  const counter=useRef(0);
  const mounted=useRef(true);
  const storageKey=`forgeboard.collections.${workspace.name}`;
  workspaceRef.current=workspace;mutateRef.current=mutate;
  const update=(patch:Partial<Preferences>)=>setPrefs(current=>({...current,...patch}));

  useEffect(()=>{
    setReady(false);
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<Preferences>|null;
      if(saved){
        setPrefs({...defaults,...saved,layout:layouts.some(item=>item.id===saved.layout)?saved.layout!:'table',columns:Array.isArray(saved.columns)?saved.columns.filter(value=>typeof value==='string'):[],extraColumns:Array.isArray(saved.extraColumns)?saved.extraColumns.filter(value=>typeof value==='string'):[]});
      }else setPrefs(defaults);
    }catch{setPrefs(defaults);}
    setReady(true);
  },[storageKey]);
  useEffect(()=>{if(ready)try{localStorage.setItem(storageKey,JSON.stringify(prefs));}catch{/* Browsers can disable local preference storage. */}},[prefs,ready,storageKey]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  const saveProperty=(noteId:string,key:string,value:string)=>{
    const version=++counter.current;
    const versionKey=`${noteId}:${key}`;
    propertyVersions.current.set(versionKey,version);
    setOptimistic(current=>({...current,[noteId]:{...current[noteId],[key]:value}}));
    setSaving(count=>count+1);setSaveError(false);
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      const current=workspaceRef.current.notes.find(note=>note.id===noteId);
      if(!current)throw new Error('Note removed');
      const next=await mutateRef.current({action:'upsert',entity:'notes',item:{id:noteId,properties:{...current.properties,[key]:value}}});
      if(next.revision>=workspaceRef.current.revision)workspaceRef.current=next;
    }).catch(()=>{if(mounted.current){setSaveError(true);notify('The property could not be saved. Please try editing it again.');}}).finally(()=>{
      if(!mounted.current)return;
      setSaving(count=>Math.max(0,count-1));
      if(propertyVersions.current.get(versionKey)===version)setOptimistic(current=>{
        const note={...current[noteId]};delete note[key];
        const next={...current};if(Object.keys(note).length)next[noteId]=note;else delete next[noteId];
        return next;
      });
    });
  };

  const allNotes=useMemo(()=>workspace.notes.map(note=>optimistic[note.id]?{...note,properties:{...note.properties,...optimistic[note.id]}}:note),[workspace.notes,optimistic]);
  const properties=[...new Set([...allNotes.flatMap(note=>Object.keys(note.properties)),...prefs.extraColumns])].sort();
  const visibleColumns=(prefs.columnsConfigured?prefs.columns:properties.slice(0,4)).filter(key=>properties.includes(key));
  const tags=[...new Set(allNotes.flatMap(note=>note.tags))].sort();
  const activeProject=projectFilter && projectFilter!=='all'?projectFilter:prefs.project;
  const projectName=(id:string)=>workspace.projects.find(project=>project.id===id)?.name || 'No project';
  const fieldValue=(note:Note,field:string):string=>field.startsWith('prop:')?note.properties[field.slice(5)] || '':field==='project'?projectName(note.projectId):field==='folder'?note.folder || 'Unfiled':field==='kind'?label(note.kind):field==='updated'?note.updatedAt:note.title;
  const query=prefs.query.trim().toLowerCase();
  const filtered=allNotes.filter(note=>(!activeProject || note.projectId===activeProject) && (!prefs.kind || note.kind===prefs.kind) && (!prefs.tag || note.tags.includes(prefs.tag)) && (!query || [note.title,note.content,note.folder,...note.tags,...Object.values(note.properties)].join(' ').toLowerCase().includes(query))).sort((a,b)=>{
    const av=fieldValue(a,prefs.sort),bv=fieldValue(b,prefs.sort);
    const result=numeric(av)&&numeric(bv)?Number(av)-Number(bv):av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'});
    return (prefs.descending?-1:1)*result;
  });
  const groups=prefs.group==='none'?[{name:'All notes',notes:filtered}]:[...new Set(filtered.map(note=>fieldValue(note,prefs.group) || 'Unspecified'))].sort((a,b)=>a.localeCompare(b)).map(name=>({name,notes:filtered.filter(note=>(fieldValue(note,prefs.group) || 'Unspecified')===name)}));
  const statusKey=properties.find(key=>key.toLowerCase()==='status') || 'Status';
  const statuses=[...new Set(['Draft','In progress','Review','Complete',...allNotes.map(note=>note.properties[statusKey]).filter(Boolean)])];
  const status=(note:Note)=>note.properties[statusKey] || 'Draft';
  const numericProperties=properties.filter(key=>{const values=filtered.map(note=>note.properties[key] || '').filter(value=>value.trim());return values.length>0 && values.every(numeric);});
  const summaryKey=prefs.summaryProperty && properties.includes(prefs.summaryProperty)?prefs.summaryProperty:numericProperties[0] || properties[0] || '';
  const summaryValues=filtered.map(note=>note.properties[summaryKey] || '').filter(value=>value.trim());
  const summaryNumbers=summaryValues.filter(numeric).map(Number);
  const sum=summaryNumbers.reduce((total,value)=>total+value,0);
  const calculated=prefs.summaryOperation==='count'?summaryValues.length:prefs.summaryOperation==='average'?(summaryNumbers.length?sum/summaryNumbers.length:0):sum;
  const hasFilters=!!(prefs.query || prefs.project || prefs.kind || prefs.tag);
  const totalWords=filtered.reduce((sum,note)=>sum+words(note),0);
  const groupingOptions=<><option value="none">No grouping</option><option value="folder">Folder</option><option value="kind">Note type</option><option value="project">Project</option>{properties.map(key=><option key={key} value={`prop:${key}`}>{key}</option>)}</>;
  const statusSelect=(note:Note)=><select className="base-status-select" value={status(note)} aria-label={`Status of ${note.title}`} onChange={event=>saveProperty(note.id,statusKey,event.target.value)}>{statuses.map(value=><option key={value}>{value}</option>)}</select>;
  const icon=(note:Note,size=16)=>{const Icon=kindIcons[note.kind] || FileText;return <Icon size={size}/>;};

  const table=(notes:Note[])=><div className="base-table-scroll"><table className="base-table"><thead><tr><th className="base-title-column">Name</th><th>Type</th><th>Folder / project</th><th>Tags</th>{visibleColumns.map(key=><th key={key}><span>{numericProperties.includes(key)?<Hash size={11}/>:<Database size={10}/>} {key}</span></th>)}<th>Words</th><th>Updated</th></tr></thead><tbody>{notes.map(note=><tr key={note.id}><td><button className="base-note-link" onClick={()=>openNote(note.id)}>{icon(note)}<strong>{note.title || 'Untitled note'}</strong></button></td><td><span className={`base-kind type-${note.kind}`}>{label(note.kind)}</span></td><td><div className="base-location"><span>{note.folder || 'Unfiled'}</span><small>{projectName(note.projectId)}</small></div></td><td><div className="base-tags">{note.tags.slice(0,3).map(tag=><button key={tag} onClick={()=>update({tag})}>#{tag}</button>)}{note.tags.length>3 && <span>+{note.tags.length-3}</span>}</div></td>{visibleColumns.map(key=><td className="base-editable-cell" key={key}>{key.toLowerCase()==='status'?statusSelect(note):<PropertyCell value={note.properties[key] || ''} name={`${key} for ${note.title}`} numeric={numericProperties.includes(key)} onCommit={value=>saveProperty(note.id,key,value)}/>}</td>)}<td className="base-word-count">{words(note).toLocaleString()}</td><td className="base-date">{date(note.updatedAt)}</td></tr>)}</tbody></table></div>;
  const list=(notes:Note[])=><div className="base-list">{notes.map(note=><div className="base-list-row" key={note.id}><span className={`base-list-icon type-${note.kind}`}>{icon(note,20)}</span><button className="base-list-main" onClick={()=>openNote(note.id)}><strong>{note.title || 'Untitled note'}</strong><span>{excerpt(note.content).slice(0,140) || 'An unwritten idea, ready to grow.'}</span><small>{note.folder || 'Unfiled'} <i>·</i> {projectName(note.projectId)}</small></button><div className="base-list-props">{statusSelect(note)}<span>{words(note)} words</span></div><button className="btn-icon" aria-label={`Open ${note.title}`} onClick={()=>openNote(note.id)}><BookOpen size={15}/></button></div>)}</div>;
  const gallery=(notes:Note[])=><div className="base-gallery">{notes.map(note=><article className="base-gallery-card" key={note.id}><button className={`base-gallery-art type-${note.kind}`} onClick={()=>openNote(note.id)} aria-label={`Open ${note.title}`}>{icon(note,36)}<span>{label(note.kind)}</span><span className="base-art-orbit"/></button><div className="base-gallery-content"><button className="base-gallery-title" onClick={()=>openNote(note.id)}>{note.title || 'Untitled note'}</button><p>{excerpt(note.content).slice(0,130) || 'A blank page with room for an idea.'}</p><div className="base-tags">{note.tags.slice(0,3).map(tag=><button key={tag} onClick={()=>update({tag})}>#{tag}</button>)}</div><div className="base-gallery-footer"><span><Folder size={10}/>{note.folder || 'Unfiled'}</span>{statusSelect(note)}</div></div></article>)}</div>;

  return <div className="page bases-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR KNOWLEDGE, ANOTHER ANGLE</div><h1>Collections</h1><p>Turn your worlds, characters, and ideas into something you can organize.</p></div><div className="heading-actions"><span className={`base-saving ${saveError?'error':''}`}>{saving?<><LoaderCircle size={12} className="base-spin"/>Saving…</>:saveError?'Some changes failed':<><Check size={12}/>All changes saved</>}</span><button className={`btn ${optionsOpen?'base-options-active':''}`} onClick={()=>setOptionsOpen(value=>!value)}><SlidersHorizontal size={14}/>Properties</button></div></div>

    <div className="base-topline"><div className="base-view-tabs" role="tablist" aria-label="Collection layout">{layouts.map(({id,label:labelText,icon:Icon})=><button key={id} role="tab" aria-selected={prefs.layout===id} className={prefs.layout===id?'selected':''} onClick={()=>update({layout:id})}><Icon size={14}/>{labelText}</button>)}</div><span className="base-preference-hint">View saved on this device</span></div>
    <div className="base-filterbar"><label className="base-search"><Search size={14}/><input aria-label="Search collection" value={prefs.query} onChange={event=>update({query:event.target.value})} placeholder="Search your collection…"/>{prefs.query && <button aria-label="Clear search" onClick={()=>update({query:''})}><X size={12}/></button>}</label><select aria-label="Filter collection by project" value={activeProject} disabled={!!projectFilter && projectFilter!=='all'} onChange={event=>update({project:event.target.value})}><option value="">All projects</option>{workspace.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Filter collection by type" value={prefs.kind} onChange={event=>update({kind:event.target.value})}><option value="">All types</option>{kinds.map(kind=><option key={kind} value={kind}>{label(kind)}</option>)}</select><select aria-label="Filter collection by tag" value={prefs.tag} onChange={event=>update({tag:event.target.value})}><option value="">All tags</option>{tags.map(tag=><option key={tag} value={tag}>#{tag}</option>)}</select>{hasFilters && <button className="base-clear-filters" onClick={()=>update({query:'',project:'',kind:'',tag:''})}>Clear filters</button>}<span className="base-result-count">{filtered.length} {filtered.length===1?'note':'notes'}</span></div>

    <div className="base-arrange-bar"><label><ArrowDownAZ size={12}/><span>Sort</span><select aria-label="Sort collection" value={prefs.sort} onChange={event=>update({sort:event.target.value})}><option value="title">Name</option><option value="updated">Updated</option><option value="folder">Folder</option><option value="kind">Type</option><option value="project">Project</option>{properties.map(key=><option key={key} value={`prop:${key}`}>{key}</option>)}</select></label><button className="base-sort-direction" title={prefs.descending?'Descending order':'Ascending order'} aria-label="Reverse sort direction" onClick={()=>update({descending:!prefs.descending})}>{prefs.descending?<ArrowDownAZ size={14}/>:<ArrowUpAZ size={14}/>}</button>{prefs.layout!=='kanban'?<label><ListFilter size={12}/><span>Group</span><select aria-label="Group collection" value={prefs.group} onChange={event=>update({group:event.target.value})}>{groupingOptions}</select></label>:<span className="base-board-hint"><GripVertical size={12}/>Drag cards or use a card’s status menu</span>}<span className="base-edit-hint">{prefs.layout==='table'?'Click a property to edit · Enter to save':''}</span></div>

    {optionsOpen && <section className="base-options panel"><div className="base-options-heading"><div><h3>Properties & calculations</h3><p>Properties live on each note. Add a column, then enter values in the table.</p></div><button className="btn-icon" aria-label="Close collection properties" onClick={()=>setOptionsOpen(false)}><X size={15}/></button></div><div className="base-options-body"><div><label className="base-options-caption">VISIBLE COLUMNS</label><div className="base-column-checks">{properties.map(key=><label key={key}><input type="checkbox" checked={visibleColumns.includes(key)} onChange={event=>update({columnsConfigured:true,columns:event.target.checked?[...visibleColumns,key]:visibleColumns.filter(value=>value!==key)})}/>{key}</label>)}{!properties.length && <span>No properties yet. Add your first column below.</span>}</div><form className="base-add-property" onSubmit={event=>{event.preventDefault();const name=propertyName.trim();if(!name)return;update({columnsConfigured:true,extraColumns:[...new Set([...prefs.extraColumns,name])],columns:[...new Set([...visibleColumns,name])]});setPropertyName('');}}><input className="field" aria-label="New collection property name" value={propertyName} onChange={event=>setPropertyName(event.target.value)} placeholder="e.g. Complexity or Estimated hours" maxLength={80}/><button className="btn" type="submit" disabled={!propertyName.trim()}><Plus size={13}/>Add</button></form></div><div><label className="base-options-caption">CALCULATE A PROPERTY</label><div className="base-calculation-options"><select className="field" aria-label="Calculation property" value={summaryKey} onChange={event=>update({summaryProperty:event.target.value})}><option value="">Choose a property</option>{properties.map(key=><option key={key}>{key}</option>)}</select><select className="field" aria-label="Calculation operation" value={prefs.summaryOperation} onChange={event=>update({summaryOperation:event.target.value as Preferences['summaryOperation']})}><option value="sum">Sum of numbers</option><option value="average">Average of numbers</option><option value="count">Count filled values</option></select></div><p className="base-calculation-note">Calculations use the notes matching your filters. Sum and average include numeric values; count includes any filled value.</p></div></div></section>}

    <div className="base-content">{filtered.length?prefs.layout==='kanban'?<div className="base-board">{statuses.map((column,index)=>{const notes=filtered.filter(note=>status(note)===column);return <section className={`base-board-column ${dragColumn===column?'drop-active':''}`} key={column} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';setDragColumn(column);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragColumn('');}} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData('application/forgeboard-note') || dragging;setDragging('');setDragColumn('');if(filtered.some(note=>note.id===id))saveProperty(id,statusKey,column);}}><div className="base-column-heading"><span className={`base-column-dot color-${index%5}`}/><h3>{column}</h3><span>{notes.length}</span></div><div className="base-board-cards">{notes.map(note=><article key={note.id} className={`base-board-card ${dragging===note.id?'dragging':''}`} draggable onDragStart={event=>{event.dataTransfer.setData('application/forgeboard-note',note.id);event.dataTransfer.effectAllowed='move';setDragging(note.id);}} onDragEnd={()=>{setDragging('');setDragColumn('');}}><div className="base-board-type">{icon(note,12)}{label(note.kind)}<GripVertical size={12}/></div><button className="base-board-title" onClick={()=>openNote(note.id)}>{note.title}</button><p>{excerpt(note.content).slice(0,95)}</p><div className="base-tags">{note.tags.slice(0,2).map(tag=><button key={tag} onClick={()=>update({tag})}>#{tag}</button>)}</div><div className="base-board-footer">{statusSelect(note)}<span>{words(note)}w</span></div></article>)}{!notes.length && <div className="base-board-empty">Drop a note here</div>}</div></section>;})}</div>:groups.map(group=><section className={`base-group ${prefs.group==='none'?'ungrouped':''}`} key={group.name}>{prefs.group!=='none' && <div className="base-group-heading"><ChevronDown size={13}/><h2>{group.name}</h2><span>{group.notes.length}</span><small>{group.notes.reduce((sum,note)=>sum+words(note),0).toLocaleString()} words</small></div>}{prefs.layout==='table'?<div className="panel">{table(group.notes)}</div>:prefs.layout==='list'?<div className="panel">{list(group.notes)}</div>:gallery(group.notes)}</section>):<div className="panel base-empty"><div><Database size={29}/></div><h2>No notes in this collection</h2><p>Try changing your filters, or create a note in Knowledge.</p>{hasFilters && <button className="btn" onClick={()=>update({query:'',project:'',kind:'',tag:''})}>Clear filters</button>}</div>}</div>

    <footer className="base-summary"><div><Database size={15}/><span>Notes<strong>{filtered.length.toLocaleString()}</strong></span></div><div><FileText size={15}/><span>Words<strong>{totalWords.toLocaleString()}</strong></span></div><div><Folder size={15}/><span>Folders<strong>{new Set(filtered.map(note=>note.folder || 'Unfiled')).size}</strong></span></div><button className="base-summary-calculation" onClick={()=>setOptionsOpen(true)}><Hash size={16}/><span>{summaryKey?`${label(prefs.summaryOperation)} · ${summaryKey}`:'Add a calculation'}<strong>{summaryKey?format(calculated):'—'}</strong></span><SlidersHorizontal size={12}/></button></footer>
  </div>;
}
