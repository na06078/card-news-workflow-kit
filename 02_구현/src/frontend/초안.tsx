import {createContext,useContext,useState,type Dispatch,type SetStateAction} from 'react';
export const DraftContext=createContext<Map<string,unknown>|null>(null);
/** 앱 수명 동안만 보관합니다. 계정·인증값은 저장하지 않습니다. */
export function useDraft<T>(key:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
 const drafts=useContext(DraftContext);const [value,setValue]=useState<T>(()=>drafts?.has(key)?drafts.get(key) as T:typeof initial==='function'?(initial as ()=>T)():initial);
 const update:Dispatch<SetStateAction<T>>=next=>setValue(previous=>{const value=typeof next==='function'?(next as (v:T)=>T)(previous):next;drafts?.set(key,value);return value;});return [value,update];
}
