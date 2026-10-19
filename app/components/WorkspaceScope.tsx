'use client';
import {createContext,useContext,useCallback} from 'react';
import type {AccountContext} from '../lib/access-types';
export interface WorkspaceScopeValue {account:AccountContext;activeId:string;onSwitch:(id:string)=>void;onAuthChanged:()=>Promise<void>;onChanged:(account:AccountContext)=>void;refreshAccount:()=>Promise<void>}
export const WorkspaceScope=createContext<WorkspaceScopeValue|null>(null);
export function useWorkspaceScope(){const scope=useContext(WorkspaceScope);if(!scope)throw new Error('Workspace context is unavailable');return scope}
export function useWorkspaceFetch(){const {activeId,account}=useWorkspaceScope();return useCallback((input:string,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('X-Workspace-Id',activeId);headers.set('X-Account-Id',account.user?.id||'guest');return fetch(input,{...init,headers,credentials:'same-origin'})},[activeId,account.user?.id])}
