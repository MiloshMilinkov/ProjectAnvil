'use client';

import {useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown, Eye, EyeOff, Home, LoaderCircle, LogIn, LogOut, Mail, Plus, ShieldCheck, UserRound, Users, X} from 'lucide-react';
import type {AccountContext, WorkspaceAccess} from '../lib/access-types';
import './accounts.css';

type MaybeAsync = void | Promise<void>;
type AccountMenuProps = {account:AccountContext; onAuthChanged:()=>MaybeAsync; onOpenTeams:()=>void};
type WorkspaceSwitcherProps = {account:AccountContext; activeId:string; onSwitch:(id:string)=>MaybeAsync; onManage:()=>void};
type TeamManagerProps = {account:AccountContext; activeId:string; onChanged:(account:AccountContext)=>MaybeAsync; onSwitch:(id:string)=>MaybeAsync; notify:(message:string)=>void; onSignIn?:()=>void};
type TeamDetails = {members:{id:string; username:string; role:'owner'|'member'}[]; invitations:{id:string; username:string}[]};
type ConfirmAction = {action:'remove'|'leave'|'cancel'; title:string; description:string; workspaceId:string; userId?:string; invitationId?:string};
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/;
const readableError = (error:unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

async function request<T>(url:string, body?:unknown, signal?:AbortSignal,expectedAccount='guest'):Promise<T> {
 const response = await fetch(url,{method:body===undefined?'GET':'POST',headers:{'X-Account-Id':expectedAccount,...(body===undefined?{}:{'Content-Type':'application/json'})},credentials:'same-origin',cache:'no-store',signal,body:body===undefined?undefined:JSON.stringify(body)});
 const result = await response.json().catch(()=>null) as {error?:string|{message?:string};message?:string}|null;
 if(!response.ok){
  const message=typeof result?.error==='string'?result.error:result?.error?.message||result?.message;
  throw new Error(message|| (response.status===429?'Too many attempts. Please wait a moment and try again.':'The request could not be completed. Please try again.'));
 }
 return result as T;
}

function Busy({busy,children}:{busy:boolean;children:ReactNode}) {return <>{busy&&<LoaderCircle size={16} className="account-spinner" aria-hidden="true"/>}{children}</>}
function useDismiss(open:boolean, close:()=>void, ref:RefObject<HTMLDivElement|null>) {
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))close()};
  const key=(event:KeyboardEvent)=>{
   if(!ref.current?.contains(event.target as Node))return;
   if(event.key==='Escape'){event.preventDefault();close();ref.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    const buttons=Array.from(ref.current.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not([disabled])'));
    if(!buttons.length)return;
    event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(index+1)%buttons.length:(index<0?buttons.length-1:(index-1+buttons.length)%buttons.length);
    buttons[next]?.focus();
   }
  };
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)};
 },[open,close,ref]);
}

function AccountDialog({title,onClose,children,labelId}:{title:string;onClose:()=>void;children:ReactNode;labelId:string}) {
 const container=useRef<HTMLElement>(null);
 useEffect(()=>{
  const returnFocus=document.activeElement as HTMLElement|null;
  const original=document.body.style.overflow;document.body.style.overflow='hidden';
  const first=container.current?.querySelector<HTMLElement>('[data-initial-focus]')||container.current?.querySelector<HTMLElement>('input')||container.current?.querySelector<HTMLElement>('button');first?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();onClose()}
   if(event.key==='Tab'){
    const nodes=Array.from(container.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),[tabindex="0"]')||[]).filter(node=>node.getClientRects().length>0);
    const firstNode=nodes[0],lastNode=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===firstNode){event.preventDefault();lastNode?.focus()}
    else if(!event.shiftKey&&document.activeElement===lastNode){event.preventDefault();firstNode?.focus()}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=original;document.removeEventListener('keydown',key);returnFocus?.focus()};
 },[onClose]);
 return createPortal(<div className="account-dialog-shade" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section ref={container} className="account-dialog" role="dialog" aria-modal="true" aria-labelledby={labelId}><header className="account-dialog-heading"><div className="account-dialog-mark"><UserRound size={22}/></div><h2 id={labelId}>{title}</h2><button type="button" className="account-icon-button" aria-label="Close account dialog" onClick={onClose}><X size={20}/></button></header>{children}</section></div>,document.body);
}

export function AccountMenu({account,onAuthChanged,onOpenTeams}:AccountMenuProps) {
 const [open,setOpen]=useState(false),[auth,setAuth]=useState<'login'|'register'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[show,setShow]=useState(false);
 const menu=useRef<HTMLDivElement>(null),dialogId=useId();
 const close=useCallback(()=>setOpen(false),[]),closeAuth=useCallback(()=>{setAuth(null);setError('');setShow(false)},[]);
 useDismiss(open,close,menu);
 function openAuth(mode:'login'|'register'){setOpen(false);setError('');setShow(false);setAuth(mode)}
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setError('');
  const values=new FormData(event.currentTarget),username=String(values.get('username')||'').trim(),password=String(values.get('password')||'');
  if(!usernamePattern.test(username)){setError('Choose a username with 3–30 letters, numbers, underscores, or dots.');return}
  if(auth==='register'){
   if(password.length<12||password.length>128){setError('Use a password with 12–128 characters.');return}
   if(password!==String(values.get('confirmPassword')||'')){setError('The passwords do not match.');return}
  }
  setBusy(true);
  try{
   await request(auth==='register'?'/api/auth/sign-up/email':'/api/auth/sign-in/username',auth==='register'?{email:String(values.get('email')||'').trim(),name:username,username,password}:{username,password});
   await onAuthChanged();closeAuth();
  }catch(e){setError(readableError(e))}finally{setBusy(false)}
 }
 async function signOut(){if(busy)return;setBusy(true);setError('');try{await request('/api/auth/sign-out',{},undefined,account.user?.id||'guest');await onAuthChanged();setOpen(false)}catch(e){setError(readableError(e))}finally{setBusy(false)}}
 return <>
  <div className="account-menu" ref={menu}>
   {account.user?<button type="button" className="account-trigger" aria-label={'Account: '+account.user.username} aria-haspopup="menu" aria-expanded={open} onClick={()=>{setError('');setOpen(value=>!value)}}><span className="account-avatar" aria-hidden="true">{account.user.username.slice(0,2).toUpperCase()}</span><span className="account-trigger-name">{account.user.username}</span><ChevronDown size={14}/></button>:<button type="button" className="account-trigger account-guest-trigger" onClick={()=>openAuth('login')} aria-label="Sign in or create account"><UserRound size={17}/><span>Sign in</span></button>}
   {open&&account.user&&<div className="account-dropdown" role="menu" aria-label="Account options"><div className="account-identity"><strong>{account.user.username}</strong><span>{account.user.email}</span></div><button type="button" role="menuitem" onClick={()=>{setOpen(false);onOpenTeams()}}><Users size={17}/>Teams & workspaces{account.invitations.length>0&&<span className="account-count">{account.invitations.length}</span>}</button><button type="button" role="menuitem" onClick={signOut} disabled={busy}><LogOut size={17}/><Busy busy={busy}>Sign out</Busy></button>{error&&<p role="alert" className="account-error">{error}</p>}</div>}
  </div>
  {auth&&<AccountDialog labelId={dialogId} title={auth==='login'?'Welcome back':'Create your account'} onClose={closeAuth}><div className="account-auth-tabs" aria-label="Account access"><button type="button" aria-pressed={auth==='login'} onClick={()=>{setAuth('login');setError('')}}>Sign in</button><button type="button" aria-pressed={auth==='register'} onClick={()=>{setAuth('register');setError('')}}>Register</button></div><p className="account-intro">{auth==='login'?'Open your personal work and the team workspaces you belong to.':'Your account starts with a private personal workspace. Join a team when you are ready to share.'}</p><form onSubmit={submit} className="account-auth-form" key={auth}>
   {auth==='register'&&<label className="account-field"><span>Email address</span><input type="email" name="email" autoComplete="email" required maxLength={254} placeholder="you@gmail.com" disabled={busy}/><small>Use your email address and create a password for ProjectAnvil.</small></label>}
   <label className="account-field"><span>Username</span><input data-initial-focus={auth==='login'?true:undefined} type="text" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]{3,30}" placeholder="Your display name" disabled={busy}/>{auth==='register'&&<small>3–30 letters, numbers, underscores, or dots. Usernames are not case-sensitive.</small>}</label>
   <label className="account-field"><span>Password</span><div className="account-password"><input type={show?'text':'password'} name="password" autoComplete={auth==='register'?'new-password':'current-password'} required minLength={auth==='register'?12:undefined} maxLength={128} disabled={busy}/><button className="account-icon-button" type="button" aria-label={show?'Hide password':'Show password'} aria-pressed={show} onClick={()=>setShow(value=>!value)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{auth==='register'&&<small>12–128 characters. Use a password you have not used elsewhere.</small>}</label>
   {auth==='register'&&<label className="account-field"><span>Confirm password</span><input type={show?'text':'password'} name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/></label>}
   {error&&<p role="alert" className="account-error">{error}</p>}<button className="account-button account-primary account-submit" type="submit" disabled={busy}><Busy busy={busy}>{auth==='register'?'Create account':'Sign in'}</Busy>{!busy&&<LogIn size={17}/>}</button>
  </form><p className="account-footnote"><ShieldCheck size={15}/>Guest work stays in its existing workspace when you sign in.</p></AccountDialog>}
 </>;
}

const workspaceLabel=(workspace:WorkspaceAccess)=>workspace.kind==='team'?'Team workspace':workspace.kind==='personal'?'Private personal workspace':'Guest workspace';

export function WorkspaceSwitcher({account,activeId,onSwitch,onManage}:WorkspaceSwitcherProps) {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const menu=useRef<HTMLDivElement>(null),close=useCallback(()=>setOpen(false),[]);
 const selected=account.workspaces.find(workspace=>workspace.id===activeId)||account.workspaces[0];
 useDismiss(open,close,menu);
 async function choose(id:string){if(busy)return;setBusy(id);setError('');try{await onSwitch(id);setOpen(false)}catch(e){setError(readableError(e))}finally{setBusy('')}}
 return <div className="account-workspace-switcher" ref={menu}><button type="button" className="account-workspace-trigger" aria-label={'Switch workspace: '+(selected?.name||'Guest workspace')} aria-expanded={open} aria-haspopup="menu" onClick={()=>{setOpen(value=>!value);setError('')}}><span className="account-workspace-icon">{selected?.kind==='team'?<Users size={19}/>:<Home size={19}/>}</span><span><strong>{selected?.name||'Guest workspace'}</strong><small>{selected?workspaceLabel(selected):'Guest workspace'}</small></span><ChevronDown size={16}/></button>{open&&<div role="menu" aria-label="Your workspaces" className="account-workspace-dropdown"><span className="account-menu-caption">YOUR WORKSPACES</span>{account.workspaces.map(workspace=><button role="menuitemradio" aria-checked={workspace.id===activeId} type="button" key={workspace.id} disabled={!!busy} onClick={()=>choose(workspace.id)}>{workspace.kind==='team'?<Users size={17}/>:<Home size={17}/>}<span><strong>{workspace.name}</strong><small>{workspaceLabel(workspace)}</small></span>{busy===workspace.id?<LoaderCircle size={16} className="account-spinner"/>:workspace.id===activeId&&<Check size={16}/>}</button>)}<button type="button" role="menuitem" className="account-manage-workspaces" onClick={()=>{setOpen(false);onManage()}}><Plus size={17}/>{account.user?'Teams & workspaces':'About workspaces'}{account.invitations.length>0&&<span className="account-count">{account.invitations.length}</span>}</button>{error&&<p role="alert" className="account-error">{error}</p>}</div>}</div>;
}

export function TeamManager({account,activeId,onChanged,onSwitch,notify,onSignIn}:TeamManagerProps) {
 const [teamName,setTeamName]=useState(''),[inviteName,setInviteName]=useState(''),[details,setDetails]=useState<TeamDetails|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[detailsError,setDetailsError]=useState(''),[revision,setRevision]=useState(0),[confirm,setConfirm]=useState<ConfirmAction|null>(null);
 const active=account.workspaces.find(workspace=>workspace.id===activeId),teams=account.workspaces.filter(workspace=>workspace.kind==='team'),personal=account.workspaces.find(workspace=>workspace.kind==='personal'),teamActive=active?.kind==='team',owner=teamActive&&active.role==='owner',confirmId=useId();
 useEffect(()=>{
  setDetails(null);setDetailsError('');setInviteName('');setConfirm(null);
  if(!account.user||!teamActive){setLoading(false);return}
  const controller=new AbortController();setLoading(true);
  request<TeamDetails>('/api/teams?workspaceId='+encodeURIComponent(activeId),undefined,controller.signal,account.user.id).then(result=>{setDetails(result);setLoading(false)}).catch(e=>{if(!controller.signal.aborted){setDetailsError(readableError(e));setLoading(false)}});
  return()=>controller.abort();
 },[activeId,teamActive,account.user?.id,revision]);
 async function action(key:string,body:Record<string,string>,success:string,after?:(next:AccountContext)=>MaybeAsync){
  if(busy)return;setBusy(key);setError('');
  try{const result=await request<AccountContext|{account:AccountContext}>('/api/teams',body,undefined,account.user?.id||'guest');const next='account' in result?result.account:result;await onChanged(next);await after?.(next);setRevision(value=>value+1);notify(success);setConfirm(null)}catch(e){setError(readableError(e))}finally{setBusy('')}
 }
 async function switchWorkspace(id:string){if(busy)return;setBusy('switch');setError('');try{await onSwitch(id)}catch(e){setError(readableError(e))}finally{setBusy('')}}
 async function createTeam(event:FormEvent){event.preventDefault();const name=teamName.trim();if(!name)return;const previous=new Set(teams.map(workspace=>workspace.id));await action('create',{action:'create',name},'Team workspace created',async next=>{setTeamName('');const created=next.workspaces.find(workspace=>workspace.kind==='team'&&!previous.has(workspace.id));if(created)await onSwitch(created.id)})}
 async function invite(event:FormEvent){event.preventDefault();const username=inviteName.trim();if(!usernamePattern.test(username)){setError('Enter a username with 3–30 letters, numbers, underscores, or dots.');return}await action('invite',{action:'invite',workspaceId:activeId,username},'Invitation sent in ProjectAnvil',()=>setInviteName(''))}
 const closeConfirm=useCallback(()=>setConfirm(null),[]);
 if(!account.user)return <section className="page account-team-page"><header className="account-page-heading"><span className="account-eyebrow">YOUR WORK, TOGETHER</span><h1>Teams & workspaces</h1><p>A place for your own plans, and a shared place for each team.</p></header><div className="account-model-grid"><article className="account-card"><Home size={23}/><h2>Personal workspace</h2><p>Register or sign in to keep projects, tasks, notes, and media private to your account.</p></article><article className="account-card"><Users size={23}/><h2>Team workspace</h2><p>Create a team or accept an invitation. Everyone in that team can work on the projects and their connected content.</p></article></div><section className="account-card account-guest-explanation"><h2>Guest work is still here</h2><p>Your existing guest workspace is kept separately. Creating an account does not copy it into a team or share it with anyone.</p>{onSignIn&&<button type="button" className="account-button account-primary" onClick={onSignIn}><LogIn size={17}/>Sign in or register</button>}</section></section>;
 return <section className="page account-team-page">
  <header className="account-page-heading"><span className="account-eyebrow">YOUR WORK, TOGETHER</span><h1>Teams & workspaces</h1><p>Keep your own work private. Open a team workspace to plan and build together.</p></header>
  <div className="account-workspace-explanation"><ShieldCheck size={19}/><p><strong>Workspace access is clear.</strong> Your personal workspace belongs to you. Everything created inside a team workspace is shared with that team, including projects, tasks, notes, canvases, and media. A person label on a task does not grant access.</p></div>
  {error&&<p role="alert" className="account-error account-page-error">{error}</p>}
  {account.invitations.length>0&&<section className="account-card account-invitations"><div className="account-section-heading"><Mail size={20}/><h2>Team invitations</h2><span className="account-count">{account.invitations.length}</span></div><p>Invitations appear here. Accept one to join the shared workspace.</p>{account.invitations.map(invitation=><div className="account-invitation-row" key={invitation.id}><div><strong>{invitation.workspaceName}</strong><span>Invited by {invitation.invitedBy}</span></div><div className="account-row-actions"><button className="account-button" type="button" disabled={!!busy} onClick={()=>action('decline-'+invitation.id,{action:'decline',invitationId:invitation.id},'Invitation declined')}><Busy busy={busy==='decline-'+invitation.id}>Decline</Busy></button><button className="account-button account-primary" type="button" disabled={!!busy} onClick={()=>action('accept-'+invitation.id,{action:'accept',invitationId:invitation.id},'You joined '+invitation.workspaceName,()=>onSwitch(invitation.workspaceId))}><Busy busy={busy==='accept-'+invitation.id}>Accept invitation</Busy></button></div></div>)}</section>}
  <div className="account-workspace-grid">
   {personal&&<article className={'account-card account-workspace-card '+(activeId===personal.id?'account-is-active':'')}><div className="account-section-heading"><Home size={21}/><span className="account-kind">PERSONAL</span>{activeId===personal.id&&<span className="account-active-label"><Check size={14}/>Current</span>}</div><h2>{personal.name}</h2><p>Only you can open the projects, notes, and tasks in this workspace.</p><button type="button" className="account-button" disabled={!!busy||activeId===personal.id} onClick={()=>switchWorkspace(personal.id)}>{activeId===personal.id?'You are here':'Open personal workspace'}</button></article>}
   {teams.map(workspace=><article key={workspace.id} className={'account-card account-workspace-card '+(activeId===workspace.id?'account-is-active':'')}><div className="account-section-heading"><Users size={21}/><span className="account-kind">TEAM · {workspace.role==='owner'?'OWNER':'MEMBER'}</span>{activeId===workspace.id&&<span className="account-active-label"><Check size={14}/>Current</span>}</div><h2>{workspace.name}</h2><p>Shared projects and connected work for everyone in this team.</p><button type="button" className="account-button" disabled={!!busy||activeId===workspace.id} onClick={()=>switchWorkspace(workspace.id)}>{activeId===workspace.id?'You are here':'Open team workspace'}</button></article>)}
   <article className="account-card account-create-team"><div className="account-section-heading"><Plus size={21}/><h2>Create a team</h2></div><p>Start an empty shared workspace. Invite registered users by their username.</p><form onSubmit={createTeam}><label className="account-field"><span>Team name</span><input name="teamName" value={teamName} onChange={event=>setTeamName(event.target.value)} required maxLength={80} placeholder="A name for your team" disabled={!!busy}/></label><button type="submit" className="account-button account-primary" disabled={!!busy||!teamName.trim()}><Busy busy={busy==='create'}>Create team workspace</Busy></button></form></article>
  </div>
  {teamActive&&<section className="account-card account-members-panel"><div className="account-section-heading"><Users size={22}/><h2>{active.name} members</h2>{owner&&<span className="account-role">You are the owner</span>}</div><p>All members can use this team workspace. The owner manages invitations and membership.</p>
   {loading&&<div className="account-loading" role="status"><LoaderCircle className="account-spinner" size={20}/>Loading members…</div>}
   {detailsError&&<div className="account-error" role="alert">{detailsError}<button className="account-button" type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button></div>}
   {details&&<><ul className="account-member-list">{details.members.map(member=><li key={member.id}><span className="account-avatar">{member.username.slice(0,2).toUpperCase()}</span><span className="account-member-name"><strong>{member.username}{member.id===account.user!.id&&<small> (you)</small>}</strong><span>{member.role==='owner'?'Owner':'Member'}</span></span>{owner&&member.role!=='owner'&&<button type="button" className="account-button account-subtle" disabled={!!busy} onClick={()=>setConfirm({action:'remove',title:'Remove '+member.username+'?',description:'They will lose access to this team workspace. Existing shared work stays in the workspace.',workspaceId:activeId,userId:member.id})}>Remove</button>}</li>)}</ul>
    {owner&&<><div className="account-invite-area"><h3>Invite a teammate</h3><p>They must already have a ProjectAnvil account. They get an invitation here in the app.</p><form onSubmit={invite}><label className="account-field"><span>Username</span><input name="inviteUsername" value={inviteName} onChange={event=>setInviteName(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]{3,30}" placeholder="Teammate’s username" disabled={!!busy}/></label><button className="account-button account-primary" type="submit" disabled={!!busy||!inviteName.trim()}><Busy busy={busy==='invite'}>Send invitation</Busy></button></form></div>{details.invitations.length>0&&<div className="account-pending"><h3>Pending invitations</h3>{details.invitations.map(invitation=><div className="account-pending-row" key={invitation.id}><span><strong>{invitation.username}</strong><small>Waiting for acceptance</small></span><button type="button" className="account-button account-subtle" disabled={!!busy} onClick={()=>setConfirm({action:'cancel',title:'Cancel this invitation?',description:invitation.username+' will no longer be able to accept this invitation.',workspaceId:activeId,invitationId:invitation.id})}>Cancel invitation</button></div>)}</div>}</>}
    {!owner&&<div className="account-leave-area"><p>Leave this team to remove your access. Shared work stays with the team.</p><button className="account-button account-danger" type="button" disabled={!!busy} onClick={()=>setConfirm({action:'leave',title:'Leave '+active.name+'?',description:'You will lose access to this team workspace. An owner can invite you again later.',workspaceId:activeId})}>Leave team</button></div>}
   </>}
  </section>}
  {confirm&&<AccountDialog labelId={confirmId} title={confirm.title} onClose={closeConfirm}><p className="account-confirm-description">{confirm.description}</p>{error&&<p role="alert" className="account-error">{error}</p>}<div className="account-confirm-actions"><button type="button" className="account-button" onClick={closeConfirm} disabled={!!busy}>Keep as is</button><button type="button" className="account-button account-danger" disabled={!!busy} onClick={()=>action('confirm',{action:confirm.action,workspaceId:confirm.workspaceId,...(confirm.userId?{userId:confirm.userId}:{}),...(confirm.invitationId?{invitationId:confirm.invitationId}:{})},confirm.action==='leave'?'You left the team':confirm.action==='remove'?'Team member removed':'Invitation cancelled',confirm.action==='leave'?next=>{const fallback=next.workspaces.find(workspace=>workspace.kind==='personal');if(fallback)return onSwitch(fallback.id)}:undefined)}><Busy busy={busy==='confirm'}>{confirm.action==='leave'?'Leave team':confirm.action==='remove'?'Remove member':'Cancel invitation'}</Busy></button></div></AccountDialog>}
 </section>;
}
