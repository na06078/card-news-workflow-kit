import {ProviderDashboardSchema,type ProviderDashboard,type ProviderReading,type ProviderService} from '../shared/작업공간계약.js';
import {METADATA_ERROR} from '../providers/사용량.js';
export interface ProviderServiceOptions {reader:(signal?:AbortSignal)=>Promise<ProviderReading>;clock?:()=>Date;timeoutMs?:number;}
export function createProviderService(options:ProviderServiceOptions):ProviderService {
 let state:ProviderDashboard={refreshing:false,models:{status:'unknown',checkedAt:null,models:[],error:null},providers:([{provider:'claude',label:'Claude'},{provider:'agy',label:'Antigravity'}] as const).map(p=>({...p,status:'unknown',checkedAt:null,metrics:[],message:null}))};
 let disposed=false,pending:Promise<void>|null=null,controller:AbortController|null=null,deadline:ReturnType<typeof setTimeout>|undefined;
 const status=()=>structuredClone(state);
 const failure=()=>{state={refreshing:false,models:{...state.models,status:'error',error:METADATA_ERROR},providers:state.providers.map(p=>({...p,status:'error',message:METADATA_ERROR}))};};
 return {status,refresh(_requestId){
 if(disposed||pending)return status();state.refreshing=true;
 const current=new AbortController();controller=current;
 const timer=deadline=setTimeout(()=>{current.abort();if(!disposed)failure();},options.timeoutMs??40000);
 pending=Promise.resolve().then(()=>{if(current.signal.aborted)throw new Error('ABORTED');return options.reader(current.signal);}).then(reading=>{
 if(disposed||current.signal.aborted)return;const next=ProviderDashboardSchema.parse({...reading,refreshing:false});
 state={...next,models:next.models.status==='error'?{...state.models,status:'error',error:METADATA_ERROR}:next.models,providers:state.providers.map(old=>{const fresh=next.providers.find(p=>p.provider===old.provider);return !fresh||fresh.status==='error'?{...old,status:'error',message:METADATA_ERROR}:fresh;})};
 }).catch(()=>{if(!disposed)failure();}).finally(()=>{clearTimeout(timer);pending=null;controller=null;});return status();
 },assertModel(model){if(model===null)return;if(state.models.status!=='ready')throw Object.assign(new Error('모델 목록을 확인하지 못했습니다.'),{status:503,code:'MODEL_CATALOG_UNAVAILABLE'});if(!state.models.models.some(m=>m.value===model))throw Object.assign(new Error('현재 선택할 수 없는 모델입니다.'),{status:422,code:'MODEL_UNAVAILABLE'});},async dispose(){disposed=true;state.refreshing=false;if(deadline)clearTimeout(deadline);controller?.abort();if(pending){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([pending,new Promise<void>(resolve=>{timer=setTimeout(resolve,6000);})]);if(timer)clearTimeout(timer);}}};
}
