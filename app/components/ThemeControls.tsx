'use client';

import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,ChevronDown,Contrast,Flower2,Moon,Palette,Sun} from 'lucide-react';
import './appearance.css';
import {readBrowserPreference} from '../lib/browser-preferences';

export type Appearance='light'|'dark'|'warp'|'focus'|'soft';
const key='projectanvil-appearance';
const appearances:Appearance[]=['light','dark','warp','focus','soft'];
const valid=(value:unknown):Appearance=>typeof value==='string'&&appearances.includes(value as Appearance)?value as Appearance:'warp';
const options=[
 {id:'light' as const,label:'Light',description:'A bright, clear workspace.',icon:Sun,bg:'#f4f6f9',sidebar:'#eef0f5',panel:'#ffffff',text:'#334155',accent:'#6d55cc'},
 {id:'dark' as const,label:'Dark',description:'Quiet charcoal and cool accents.',icon:Moon,bg:'#111318',sidebar:'#181b22',panel:'#222630',text:'#dce4ee',accent:'#92b9ec'},
 {id:'warp' as const,label:'Warp',description:'The original violet appearance.',icon:Palette,bg:'#15151a',sidebar:'#19191f',panel:'#2d2337',text:'#dfd0eb',accent:'#c3a3e8'},
 {id:'focus' as const,label:'Focus',description:'Light slate surfaces, dark framing.',icon:Contrast,bg:'#e4e8ee',sidebar:'#17191c',panel:'#f3f5f8',text:'#202e41',accent:'#385f87'},
 {id:'soft' as const,label:'Soft',description:'Blush pink, mauve, and gentle pastels.',icon:Flower2,bg:'#fff4f7',sidebar:'#faf2f6',panel:'#fffafd',text:'#432b41',accent:'#99536f'},
];
const ThemeContext=createContext<{appearance:Appearance;choose:(theme:Appearance)=>void}>({appearance:'warp',choose:()=>{}});

export function ThemeProvider({children}:{children:ReactNode}){
 const [appearance,setAppearance]=useState<Appearance>('warp');
 useEffect(()=>{
  const apply=(value:Appearance)=>{document.documentElement.dataset.theme=value;setAppearance(value)};
  try{const stored=readBrowserPreference(key),next=valid(stored);apply(next);if(stored!==next)localStorage.setItem(key,next)}catch{apply('warp')}
  const sync=(event:StorageEvent)=>{if(event.key===key||event.key===null)apply(valid(event.newValue))};
  window.addEventListener('storage',sync);
  return()=>window.removeEventListener('storage',sync);
 },[]);
 const choose=(theme:Appearance)=>{document.documentElement.dataset.theme=theme;setAppearance(theme);try{localStorage.setItem(key,theme)}catch{/* The selected appearance still applies when storage is unavailable. */}};
 return <ThemeContext.Provider value={{appearance,choose}}>{children}</ThemeContext.Provider>;
}

export function useAppearance(){return useContext(ThemeContext)}

export function AppearancePicker(){
 const {appearance,choose}=useAppearance();
 return <div className="appearance-options" role="radiogroup" aria-label="Workspace appearance">{options.map(option=><button type="button" role="radio" aria-checked={appearance===option.id} key={option.id} className={'appearance-option '+(appearance===option.id?'is-selected':'')} onClick={()=>choose(option.id)}>
  <div className="appearance-preview" aria-hidden="true" style={{background:option.bg,borderColor:(option.id==='focus'?'#dce4ee':option.text)+'25'}}><div className="appearance-preview-sidebar" style={{background:option.sidebar}}><i style={{background:option.accent}}/><span style={{background:(option.id==='focus'?'#dce4ee':option.text)+'25'}}/><span style={{background:option.accent+'65'}}/><span style={{background:(option.id==='focus'?'#dce4ee':option.text)+'25'}}/></div><div className="appearance-preview-body"><strong style={{background:option.text+'85'}}/><div style={{background:option.panel,borderColor:option.text+'20'}}/><section>{[0,1,2].map(i=><span key={i} style={{background:option.panel,borderColor:option.text+'20'}}><i style={{background:option.accent}}/></span>)}</section></div></div>
  <div className="appearance-option-label"><option.icon size={15}/><strong>{option.label}</strong><span className="appearance-radio">{appearance===option.id&&<Check size={11}/>}</span></div><p>{option.description}</p>
 </button>)}</div>;
}

export function AppearanceMenu(){
 const {appearance,choose}=useAppearance();
 const [open,setOpen]=useState(false);
 const menu=useRef<HTMLDivElement>(null);
 const selected=options.find(o=>o.id===appearance)!;
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))setOpen(false)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
 return <div className="appearance-menu" ref={menu}><button className={'btn-icon appearance-trigger '+(open?'is-open':'')} type="button" title={'Appearance: '+selected.label} aria-label={'Appearance: '+selected.label} aria-expanded={open} aria-haspopup="menu" onClick={()=>setOpen(value=>!value)}><selected.icon size={17}/></button>{open&&<div role="menu" aria-label="Choose appearance" className="appearance-dropdown"><span>APPEARANCE</span>{options.map(option=><button type="button" key={option.id} role="menuitemradio" aria-checked={appearance===option.id} onClick={()=>{choose(option.id);setOpen(false)}}><option.icon size={15}/><div><strong>{option.label}</strong><small>{option.description}</small></div>{appearance===option.id&&<Check size={14}/>}</button>)}<p>Saved on this device</p></div>}</div>;
}
