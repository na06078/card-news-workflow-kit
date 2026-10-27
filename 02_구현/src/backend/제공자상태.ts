import {ProviderDashboardSchema,type ProviderDashboard,type ProviderReading,type ProviderService} from '../shared/작업공간계약.js';
import {metadataDiagnostic} from '../providers/사용량.js';
export interface ProviderServiceOptions {
 reader:(signal?:AbortSignal)=>Promise<ProviderReading>;
 clock?:()=>Date;
 timeoutMs?:number;
}
const emptyDashboard=():ProviderDashboard=>({
 refreshing:false,
 models:{status:'unknown',checkedAt:null,models:[],error:null},
 providers:([{provider:'claude',label:'Claude'},{provider:'agy',label:'Antigravity'}] as const)
  .map(provider=>({...provider,status:'unknown',checkedAt:null,metrics:[],message:null})),
});
export function createProviderService(options:ProviderServiceOptions):ProviderService {
 let state=emptyDashboard();
 let disposed=false,generation=0;
 type Reading={controller:AbortController;timer:ReturnType<typeof setTimeout>;done:Promise<void>};
 let pending:Reading|null=null;
 const status=()=>structuredClone(state);
 const failure=()=>{
  const d=metadataDiagnostic(undefined);
  state={refreshing:false,models:{...state.models,status:'error',error:d.message,errorCode:d.errorCode},
   providers:state.providers.map(provider=>({...provider,status:'error',message:d.message,errorCode:d.errorCode}))};
 };
 return {
  status,
  invalidate(){
   generation++;
   if(pending){clearTimeout(pending.timer);pending.controller.abort();pending=null;}
   state=emptyDashboard();
  },
  refresh(_requestId){
   if(disposed||pending)return status();
   state.refreshing=true;
   const currentGeneration=generation,controller=new AbortController();
   const ownsState=()=>!disposed&&generation===currentGeneration&&pending===reading;
   const timer=setTimeout(()=>{controller.abort();if(ownsState())failure();},options.timeoutMs??40000);
   const reading:Reading={controller,timer,done:Promise.resolve()};
   pending=reading;
   reading.done=Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw new Error('ABORTED');
    return options.reader(controller.signal);
   }).then(result=>{
    // Late success is never authoritative; owned failure diagnostics may still arrive after abort/cleanup.
    if(!ownsState())return;
    const next=ProviderDashboardSchema.parse({...result,refreshing:false});
    const modelError=metadataDiagnostic(next.models.errorCode);
    state={...next,models:next.models.status==='error'?{...state.models,status:'error',error:modelError.message,errorCode:modelError.errorCode}:controller.signal.aborted?state.models:next.models,
     providers:state.providers.map(old=>{
      const fresh=next.providers.find(provider=>provider.provider===old.provider);
      const d=metadataDiagnostic(fresh?.errorCode);
      return !fresh||fresh.status==='error'?{...old,status:'error',message:d.message,errorCode:d.errorCode}:controller.signal.aborted?old:fresh;
     })};
   }).catch(()=>{if(ownsState()&&!controller.signal.aborted)failure();}).finally(()=>{
    clearTimeout(timer);
    if(pending===reading)pending=null;
   });
   return status();
  },
  assertModel(model){
   if(model===null)return;
   if(state.models.status!=='ready')throw Object.assign(new Error('모델 목록을 확인하지 못했습니다.'),{status:503,code:'MODEL_CATALOG_UNAVAILABLE'});
   if(!state.models.models.some(item=>item.value===model))throw Object.assign(new Error('현재 선택할 수 없는 모델입니다.'),{status:422,code:'MODEL_UNAVAILABLE'});
  },
  async dispose(){
   disposed=true;state.refreshing=false;
   const current=pending;
   if(!current)return;
   clearTimeout(current.timer);current.controller.abort();
   let timer:ReturnType<typeof setTimeout>|undefined;
   await Promise.race([current.done,new Promise<void>(resolve=>{timer=setTimeout(resolve,6000);})]);
   if(timer)clearTimeout(timer);
  },
 };
}

