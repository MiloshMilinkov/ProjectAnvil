'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Check,Compass,X} from 'lucide-react';
import './guided-tour.css';

export type TourPage='overview'|'my-work'|'tasks'|'projects'|'notes'|'graph'|'canvas'|'collections'|'daily'|'team'|'settings';
type TourStep={id:string;page:TourPage;title:string;body:string;tip?:string;anchors:string[]};

// Each step explains existing controls. Visiting the tour never creates records.
export const tourSteps:TourStep[]=[
 {id:'welcome',page:'overview',title:'Your ideas and your work, together',body:'Overview brings together project progress, open tasks, and recent notes. Start with a project, capture your ideas in Knowledge, then turn the next steps into tasks.',tip:'You are using a local guest workspace. No account is needed.',anchors:['[data-tour="overview"]','.view-overview .page-heading','.view-overview .overview-hero']},
 {id:'projects',page:'projects',title:'Give each game a home',body:'Create a project for a game, prototype, or milestone. Add a description, goal, accent color, and target date. Projects connect their tasks and notes so you can follow progress in one place.',tip:'The project list in the sidebar also filters your work.',anchors:['[data-tour="new-project"]','.view-projects .heading-actions','.project-add']},
 {id:'new-task',page:'tasks',title:'Turn the plan into a task',body:'New task creates an actionable piece of work with a project, type, status, priority, due date, and optional assignee. Open a saved task to edit its Markdown description, checklist, linked notes, dependencies, and discussion.',tip:'Tasks also work without a project or person.',anchors:['[data-tour="new-task"]','.view-tasks .heading-actions','.view-tasks .page-heading']},
 {id:'task-layouts',page:'tasks',title:'Choose how to see the work',body:'Board organizes tasks into status columns; drag a card to move work forward. List makes many tasks easy to scan and edit. Timeline puts dated tasks on a calendar so you can spot upcoming work.',tip:'Use the status field as an alternative to dragging.',anchors:['[data-tour="task-layouts"]','.task-view-toolbar .view-tabs']},
 {id:'task-filters',page:'tasks',title:'Find exactly what matters',body:'Filter tasks by text, project, person, priority, or status. Combine filters for a focused view, then use Save view to keep that combination available. Clear the filters to return to the wider picture.',anchors:['[data-tour="task-filters"]','.view-tasks .filters']},
 {id:'my-work',page:'my-work',title:'Focus on your next steps',body:'My work shows unassigned tasks in this guest workspace, so you can plan immediately. Status and priority help you decide what to pick up next. Use the task board’s assignee filter when you want to see one person’s assigned work.',tip:'People are optional assignment labels. They do not require accounts.',anchors:['[data-tour="my-work"]','.view-my-work .page-heading']},
 {id:'knowledge',page:'notes',title:'Capture the world behind the game',body:'Knowledge stores your notes, documentation, research, and worldbuilding. Create a blank note or use a reusable structure for characters, worlds, research, meetings, or a journal.',tip:'Templates are starting structures; every part stays editable.',anchors:['[data-tour="new-note"]','.note-browser-title button','.knowledge-empty .btn-primary','.note-workspace']},
 {id:'markdown',page:'notes',title:'Write with Markdown',body:'Write headings, lists, checkboxes, tables, quotes, highlighted text, footnotes, and code. Write, Split, and Read switch between editing and preview. Equations and Mermaid diagrams also render in notes.',tip:'Changes save automatically. The note toolbar shows the save state.',anchors:['[data-tour="note-editor"]','.note-editor-toolbar','.knowledge-empty','.note-workspace']},
 {id:'note-links',page:'notes',title:'Connect an idea to another',body:'Type [[Note title]] to link a note, [[Note#Heading]] for a section, or ![[Note title]] to embed it. Backlinks show notes that refer here; linked tasks keep the idea attached to the work.',tip:'These connections also appear in the relationship graph.',anchors:['[data-tour="note-links"]','.note-details','.note-editor-toolbar','.knowledge-empty']},
 {id:'note-organize',page:'notes',title:'Organize without losing the connections',body:'Use folders, tags, bookmarks, and project links to find your notes again. Custom properties hold structured details such as faction, status, or estimated effort. Note search searches titles, text, and tags.',anchors:['[data-tour="note-organize"]','.note-filter-row','.note-search','.knowledge-empty']},
 {id:'media',page:'notes',title:'Keep references beside your notes',body:'The attachment button adds images, PDFs, audio, video, or text files. The microphone records audio when you allow access. Uploaded references can be displayed in notes and used as cards on a canvas.',tip:'Attachments are stored on this PC. Each upload can be up to 20 MB.',anchors:['[data-tour="note-media"]','.note-format-tools','.knowledge-empty']},
 {id:'note-tools',page:'notes',title:'Revisit, reshape, and present',body:'A note’s More menu opens version history, Markdown export, and a separate window. Extract selected text splits part of a note into another; Combine with another note joins their content. Present as slides turns sections separated by --- into a simple presentation.',tip:'Version history retains up to 12 earlier note versions.',anchors:['[data-tour="note-tools"]','.note-toolbar-actions','.knowledge-empty']},
 {id:'graph',page:'graph',title:'Explore the relationships',body:'The graph connects notes, tasks, and projects. Select a node to inspect its neighbors; double-click to open it. Filter node types, search for an idea, or use Local graph to explore one or two connections away.',tip:'Drag to pan, scroll to zoom, and use Fit graph to bring everything into view.',anchors:['[data-tour="graph-controls"]','.graph-toolbar','.visual-heading']},
 {id:'canvas',page:'canvas',title:'Plan on an open canvas',body:'Arrange notes, tasks, loose thoughts, uploaded media, and web references as cards. Move and resize them, connect them with arrows, and label the relationships. Keep separate canvases for maps, story arcs, or systems.',tip:'Pan the background, scroll to zoom, and select a card to edit its details.',anchors:['[data-tour="canvas-controls"]','.canvas-toolbar','.visual-heading']},
 {id:'collections',page:'collections',title:'Give your notes a structured view',body:'Collections shows the same notes as a table, list, gallery, or Kanban board. Filter, sort, and group them by their properties. Edit table values directly; Properties adds columns and calculations such as sums and averages.',tip:'A character roster, lore index, or research tracker can all use your existing notes.',anchors:['[data-tour="collection-layouts"]','.base-view-tabs','.base-topline']},
 {id:'daily',page:'daily',title:'Make a small plan for today',body:'Daily planner opens a dated journal for your focus, development log, discoveries, and reflection. Your daily notes stay searchable and connected to the rest of your Knowledge.',tip:'The guide previews this page without creating a journal entry.',anchors:['[data-tour="daily-planner"]','.daily-knowledge .note-browser-title','.daily-knowledge .knowledge-empty','.note-workspace']},
 {id:'people',page:'team',title:'Add people when you need assignments',body:'Add a person’s name, role, and color, then assign tasks to that person. Their View tasks button and the task board’s assignee filter show the work assigned to them. For now everyone works as a guest; these labels do not create user accounts.',tip:'You can use every feature without adding a person.',anchors:['[data-tour="people"]','.view-team .page-heading','.view-team .info-note']},
 {id:'search',page:'overview',title:'Jump to anything',body:'Search finds tasks, notes, and projects across the workspace. Open it with Ctrl K (⌘ K on Mac), then select a result. The same search panel offers quick actions for creating a task and opening today’s planner.',tip:'On a small screen, open the navigation menu to find Search anything.',anchors:['[data-tour="search"]','.top-search','.sidebar-search','.mobile-menu']},
 {id:'preferences',page:'settings',title:'Make the workspace yours',body:'Settings lets you rename the workspace, adjust spacing, choose a new-task shortcut, and save the view to open on startup. Use the keyboard shortcuts button for a reminder of the available keys.',tip:'Preferences and appearance are saved in this browser.',anchors:['[data-tour="preferences"]','.settings-section:has(.shortcut-field)','.settings-page .page-heading']},
 {id:'backups',page:'settings',title:'Keep a copy of your work',body:'Export workspace downloads your records as JSON; Import workspace restores an export after confirmation. Exported notes contain attachment references, so keep a copy of the project’s .wrangler/state folder to preserve the uploaded files too.',tip:'Copy the local storage folder while Forgeboard is stopped for a complete backup.',anchors:['[data-tour="backups"]','.settings-data-actions']},
 {id:'appearance',page:'overview',title:'A familiar place to return',body:'The appearance button switches between Light, Dark, and the original Current theme. The guide button beside it restarts this tour whenever you need a reminder. You are ready to make the workspace your own.',tip:'Next steps: create a project, write an idea, then make your first task.',anchors:['[data-tour="tour-button"]','[data-tour="appearance"]','.appearance-menu']},
];

type Box={left:number;top:number;width:number;height:number};
type Placement='left'|'right'|'above'|'below'|'center';
type Layout={anchor:Box|null;left:number;top:number;placement:Placement};
const clamp=(number:number,min:number,max:number)=>Math.max(min,Math.min(number,max));

function locateAnchor(selectors:string[]):HTMLElement|null{
 for(const selector of selectors){
  const candidates=document.querySelectorAll<HTMLElement>(selector);
  for(const candidate of candidates){
   const rect=candidate.getBoundingClientRect(),style=getComputedStyle(candidate);
   if(rect.width>0&&rect.height>0&&rect.right>0&&rect.left<window.innerWidth&&style.display!=='none'&&style.visibility!=='hidden')return candidate;
  }
 }
 return null;
}

function positionCard(anchor:Box|null,width:number,height:number):Layout{
 const viewportWidth=window.innerWidth,viewportHeight=window.innerHeight,padding=14,gap=17;
 const centered={anchor,left:Math.max(padding,(viewportWidth-width)/2),top:Math.max(padding,(viewportHeight-height)/2),placement:'center' as const};
 if(!anchor)return centered;
 const right=anchor.left+anchor.width,bottom=anchor.top+anchor.height;
 const verticalCenter=clamp(anchor.top+anchor.height/2-height/2,padding,viewportHeight-height-padding);
 if(viewportWidth>680&&right+gap+width<=viewportWidth-padding)return {anchor,left:right+gap,top:verticalCenter,placement:'right'};
 if(viewportWidth>680&&anchor.left-gap-width>=padding)return {anchor,left:anchor.left-gap-width,top:verticalCenter,placement:'left'};
 const left=clamp(anchor.left+anchor.width/2-width/2,padding,viewportWidth-width-padding);
 if(bottom+gap+height<=viewportHeight-padding)return {anchor,left,top:bottom+gap,placement:'below'};
 if(anchor.top-gap-height>=padding)return {anchor,left,top:anchor.top-gap-height,placement:'above'};
 // Large surfaces need a bottom sheet; the highlighted control remains visible above it.
 return {anchor,left:Math.max(padding,(viewportWidth-width)/2),top:Math.max(padding,viewportHeight-height-padding),placement:'center'};
}

export default function GuidedTour({onNavigate,onClose}:{onNavigate:(page:TourPage)=>void;onClose:()=>void}){
 const [index,setIndex]=useState(0),[mounted,setMounted]=useState(false),[layout,setLayout]=useState<Layout>({anchor:null,left:14,top:14,placement:'center'});
 const card=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),navigate=useRef(onNavigate),close=useRef(onClose);
 const step=tourSteps[index],last=index===tourSteps.length-1;
 navigate.current=onNavigate;close.current=onClose;

 useEffect(()=>{
  setMounted(true);
  const focused=document.activeElement as HTMLElement|null,bodyOverflow=document.body.style.overflow;
  const shell=document.querySelector<HTMLElement>('.app-shell'),wasInert=shell?.hasAttribute('inert');
  document.body.style.overflow='hidden';shell?.setAttribute('inert','');
  return()=>{
   document.body.style.overflow=bodyOverflow;
   if(!wasInert)shell?.removeAttribute('inert');
   if(focused?.isConnected&&focused!==document.body)focused.focus({preventScroll:true});
   else document.querySelector<HTMLElement>('[data-tour="tour-button"]')?.focus({preventScroll:true});
  };
 },[]);

 useEffect(()=>{
  navigate.current(step.page);
  let frame=0,scrolled=false,cancelled=false;
  const measure=()=>{
   if(cancelled)return;
   const element=locateAnchor(step.anchors);
   if(element&&!scrolled){
    const box=element.getBoundingClientRect();
    if(box.top<10||box.bottom>window.innerHeight-10)element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    scrolled=true;
   }
   const rect=element?.getBoundingClientRect(),margin=6;
   let anchor:Box|null=null;
   if(rect&&rect.bottom>margin&&rect.top<window.innerHeight-margin){
    const left=clamp(rect.left-margin,margin,window.innerWidth-margin),top=clamp(rect.top-margin,margin,window.innerHeight-margin);
    anchor={left,top,width:Math.max(0,Math.min(rect.right+margin,window.innerWidth-margin)-left),height:Math.max(0,Math.min(rect.bottom+margin,window.innerHeight-margin)-top)};
   }
   const cardBox=card.current?.getBoundingClientRect(),width=cardBox?.width||Math.min(378,window.innerWidth-28),height=cardBox?.height||330;
   const next=positionCard(anchor,width,height);
   setLayout(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
  schedule();
  const retry=window.setTimeout(schedule,90);
  const focusFrame=requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));
  const observer=new ResizeObserver(schedule);
  if(card.current)observer.observe(card.current);
  const shell=document.querySelector('.app-shell');
  if(shell)observer.observe(shell);
  const mutations=new MutationObserver(schedule);
  if(shell)mutations.observe(shell,{childList:true,subtree:true});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);
  return()=>{cancelled=true;cancelAnimationFrame(frame);cancelAnimationFrame(focusFrame);clearTimeout(retry);observer.disconnect();mutations.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);};
 },[index,mounted,step]);

 useEffect(()=>{
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close.current();return;}
   if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
    event.preventDefault();event.stopImmediatePropagation();setIndex(value=>clamp(value+(event.key==='ArrowRight'?1:-1),0,tourSteps.length-1));return;
   }
   if(event.key==='Tab'){
    const controls=card.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input,select,textarea,[tabindex="0"]');
    if(!controls?.length)return;
    const first=controls[0],final=controls[controls.length-1],active=document.activeElement;
    if(event.shiftKey&&(active===first||!card.current?.contains(active)||active===heading.current)){event.preventDefault();final.focus();}
    else if(!event.shiftKey&&(active===final||!card.current?.contains(active))){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',keyboard,true);
  return()=>document.removeEventListener('keydown',keyboard,true);
 },[]);

 if(!mounted)return null;
 const anchor=layout.anchor;
 return createPortal(<div className="guided-tour" data-testid="guided-tour">
  {anchor?<><div className="tour-shade" style={{top:0,left:0,right:0,height:anchor.top}}/><div className="tour-shade" style={{top:anchor.top+anchor.height,left:0,right:0,bottom:0}}/><div className="tour-shade" style={{top:anchor.top,left:0,width:anchor.left,height:anchor.height}}/><div className="tour-shade" style={{top:anchor.top,left:anchor.left+anchor.width,right:0,height:anchor.height}}/><div aria-hidden="true" className="tour-spotlight" style={anchor}/></>:<div className="tour-shade tour-shade-full"/>}
  <section ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" className="tour-card" data-placement={layout.placement} data-step={step.id} style={{left:layout.left,top:layout.top}} onKeyDown={event=>event.stopPropagation()}>
   <div className="tour-card-top"><span className="tour-label"><Compass size={14}/>FORGEBOARD GUIDE</span><button type="button" className="tour-close" aria-label="Close guide" title="Close guide (Esc)" onClick={()=>close.current()}><X size={18}/></button></div>
   <div className="tour-progress" aria-hidden="true"><span style={{width:`${(index+1)/tourSteps.length*100}%`}}/></div>
   <span className="tour-step-count" role="status" aria-live="polite">Step {index+1} of {tourSteps.length}</span>
   <h2 ref={heading} tabIndex={-1} id="tour-title">{step.title}</h2>
   <p id="tour-body">{step.body}</p>
   {step.tip&&<p className="tour-tip">{step.tip}</p>}
   <div className="tour-navigation"><button type="button" className="tour-skip" onClick={()=>close.current()}>Skip guide</button><button type="button" className="tour-previous" disabled={index===0} onClick={()=>setIndex(value=>value-1)}><ArrowLeft size={14}/><span>Previous</span></button><button type="button" className="tour-next" onClick={()=>last?close.current():setIndex(value=>value+1)}>{last?<><span>Finish</span><Check size={15}/></>:<><span>Next</span><ArrowRight size={15}/></>}</button></div>
   <p className="tour-key-hint">← → to move · Esc to close · Replay from the guide button</p>
  </section>
 </div>,document.body);
}
