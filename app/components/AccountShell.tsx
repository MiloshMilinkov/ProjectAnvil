'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountContext} from '../lib/access-types';
import ProjectAnvil from './ProjectAnvil';
import {WorkspaceScope} from './WorkspaceScope';

export default function AccountShell(){
 const [account,setAccount]=useState<AccountContext|null>(null),[activeId,setActiveId]=useState(''),[error,setError]=useState('');
 const latest=useRef<AccountContext|null>(null),requestVersion=useRef(0);
 const apply=useCallback((next:AccountContext)=>{
  const sameUser=latest.current?.user?.id===next.user?.id;
  latest.current=next;requestVersion.current++;setAccount(next);
  setActiveId(current=>{
   let saved='';try{saved=localStorage.getItem('projectanvil-workspace-'+(next.user?.id||'guest'))||''}catch{}
   const proposed=sameUser?current:saved;
   return next.workspaces.some(w=>w.id===proposed)?proposed:next.workspaces[0]?.id||'';
  });setError('');
 },[]);
 const refresh=useCallback(async()=>{
  const version=++requestVersion.current;
  try{
   const response=await fetch('/api/account',{cache:'no-store',credentials:'same-origin'});
   const result=await response.json() as AccountContext&{account?:AccountContext;error?:string};
   if(!response.ok)throw new Error(result.error||'Unable to open your account');
   if(version===requestVersion.current)apply(result.account||result);
  }catch(error){if(version===requestVersion.current)setError((error as Error).message);throw error}
 },[apply]);
 useEffect(()=>{refresh().catch(()=>{});const timer=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{})},10000);const wake=()=>refresh().catch(()=>{});window.addEventListener('focus',wake);return()=>{clearInterval(timer);window.removeEventListener('focus',wake);requestVersion.current++}},[refresh]);
 const updateAccount=useCallback((next:AccountContext)=>{if(latest.current?.user?.id===next.user?.id)apply(next)},[apply]);
 const switchWorkspace=useCallback((id:string)=>{
  const current=latest.current;if(!current?.workspaces.some(w=>w.id===id))return;
  setActiveId(id);try{localStorage.setItem('projectanvil-workspace-'+(current.user?.id||'guest'),id)}catch{}
 },[]);
 if(!account||!activeId)return <main className="loading-page"><h1>ProjectAnvil</h1><p>{error||'Opening your workspace…'}</p>{error&&<button className="btn" onClick={()=>refresh().catch(()=>{})}>Try again</button>}</main>;
 return <WorkspaceScope.Provider value={{account,activeId,onSwitch:switchWorkspace,onAuthChanged:refresh,onChanged:updateAccount,refreshAccount:refresh}}><ProjectAnvil key={(account.user?.id||'guest')+':'+activeId}/></WorkspaceScope.Provider>;
}
