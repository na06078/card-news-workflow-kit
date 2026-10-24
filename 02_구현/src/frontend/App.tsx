import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {IdSchema,type AppProps} from '../shared/포트.js';
import {MOCK_NOTICE} from '../shared/모의자료.js';
import {createHttpClient} from './클라이언트.js';
import {createMockClient} from './모의클라이언트.js';
import {createController,asFailure} from './상태.js';
import {주제} from './화면/주제.js';
import {후보} from './화면/후보.js';
import {질문} from './화면/질문.js';
import {스토리보드} from './화면/스토리보드.js';
import {검수} from './화면/검수.js';
import {다운로드} from './화면/다운로드.js';
import {진행상태,nextText} from './컴포넌트/진행상태.js';
import './스타일.css';
import {계정연결} from './컴포넌트/계정연결.js';
import {createConnectionClient,type ConnectionClient} from './연결클라이언트.js';
const steps=[{id:'brief',label:'주제·조사'},{id:'candidates',label:'후보 선택'},{id:'plan',label:'편집·기획'},{id:'review',label:'제작·검수'},{id:'exports',label:'내려받기'}];
function savedId(){const id=new URLSearchParams(location.search).get('project');return IdSchema.safeParse(id).success?id!:undefined;}
function saveId(id:string){const url=new URL(location.href);url.searchParams.set('project',id);history.replaceState(null,'',url);}
export const App=({client:injected,initialProjectId,dataMode='real',connectionClient}:AppProps & {connectionClient?:ConnectionClient})=>{
 const [showConnections,setShowConnections]=useState(false);
 const connections=useMemo(()=>connectionClient??createConnectionClient(),[connectionClient]);
 const client=useMemo(()=>injected??(dataMode==='mock'?createMockClient():createHttpClient()),[injected,dataMode]);
 const ctl=useMemo(()=>createController(client,saveId),[client]);const state=useSyncExternalStore(ctl.subscribe,ctl.getState,ctl.getState);const p=state.snapshot;
 const [tab,setTab]=useState<string|null>(null);const [pollError,setPollError]=useState('');
 useEffect(()=>{const id=initialProjectId??savedId();if(id)void ctl.open(id);},[ctl,initialProjectId]);
 // 単一 timeout/poll。 waitingは正常、通信失敗は上限15秒 backoff、terminalは停止。
 useEffect(()=>{if(!p?.activeRun&&!state.historyMore)return;let disposed=false,timer:ReturnType<typeof setTimeout>,failures=0;
  const tick=async()=>{if(disposed)return;let delay=document.hidden?5000:p?.activeRun?.status==='waiting_for_user'?3000:1000;
   try{const more=await ctl.poll();failures=0;if(!disposed)setPollError('');if(more)delay=0;}catch(e){failures++;delay=Math.min(15000,1000*2**failures);if(!disposed)setPollError(asFailure(e).error.message);}
   if(!disposed)timer=setTimeout(tick,delay);
  };timer=setTimeout(tick,1000);return()=>{disposed=true;clearTimeout(timer);};
 },[ctl,p?.projectId,p?.activeRun?.runId,p?.activeRun?.status,state.historyMore]);
 useEffect(()=>{setTab(null);},[p?.stage,p?.question?.questionId]);
 const mock=dataMode==='mock'||p?.dataMode==='mock';const developmentMock=dataMode==='mock';const busy=state.busy||state.pendingRetry;
 const current=p?.stage==='export'?'exports':p?.result||p?.stage==='production'?'review':p?.storyboard||p?.stage==='editorial'?'plan':p?.stage==='selection'?'candidates':'brief';
 const view=tab??current;
 const available=(id:string)=>id==='brief'||!!p&&(id==='candidates'?p.researchVersion>0:id==='plan'?!!p.storyboard||p.stage==='editorial':id==='review'?!!p.result||p.stage==='production':id==='exports'?p.stage==='export':false);
 const q=p?.question?.status==='open'?p.question:null;
 return <div className="app-shell"><a className="skip" href="#workspace">본문으로 건너뛰기</a><header className="topbar"><a className="brand" href="#workspace"><span className="brand-mark">C</span><span>CARDNOTE<small>함께 만드는 카드뉴스</small></span></a><span className={'mode '+(mock?'mock':'')}>{mock?MOCK_NOTICE:'로컬 작업 공간 · 실제 HTTP'}</span><button aria-expanded={showConnections} aria-controls="connection-settings" onClick={()=>setShowConnections(v=>!v)}>계정 연결</button></header><div className="layout"><aside className="sidebar"><p className="eyebrow">YOUR WORKFLOW</p><nav aria-label="제작 단계"><ol>{steps.map((step,i)=><li key={step.id}><button aria-current={view===step.id?'step':undefined} disabled={!available(step.id)} onClick={()=>setTab(step.id)}><span>{String(i+1).padStart(2,'0')}</span>{step.label}</button></li>)}</ol></nav><div className="sidebar-note"><strong>선택은 직접,<br/>제작은 단계별로.</strong><p>원문과 한계를 확인하고<br/>현재 버전을 승인합니다.</p><span>CN-1 · 구독 전용</span></div></aside><main id="workspace" tabIndex={-1}><div className="workspace-head"><div><p className="eyebrow">CARD NEWS STUDIO</p><h1>{p?p.topic:'작은 소식을, 선명한 이야기로.'}</h1></div>{p&&<div className="actions"><button disabled={state.busy||state.loading} onClick={()=>void ctl.refreshSafely()}>상태 새로고침</button><button disabled={busy} onClick={()=>{ctl.reset();const u=new URL(location.href);u.searchParams.delete('project');history.replaceState(null,'',u);setTab(null);}}>새 프로젝트</button></div>}</div>{p&&<div className="project-meta"><span>저장 v{p.projectVersion}</span><span>조사 기준 {new Date(p.period.anchorAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} KST</span><span>{new Date(p.period.from).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})} ~ {new Date(p.period.to).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})} · {p.period.days}일</span><small>프로젝트 {p.projectId}</small></div>}
 {showConnections&&<div id="connection-settings"><계정연결 client={connections} working={!!p?.activeRun}/></div>}
 {state.loading&&<p role="status" className="loading">저장된 상태를 불러오는 중…</p>}{state.busy&&<p role="status" className="loading">요청 전송 중 · 중복 제출을 막고 있습니다.</p>}{state.notice&&<p role="status" className="notice">{state.notice}</p>}{state.error&&<section className="error panel" role="alert"><h2>요청을 확인해 주세요</h2><strong>{state.error.error.code}</strong><p>{state.error.error.message}</p>{state.error.status===409&&['VERSION_CONFLICT','QUESTION_STALE','REQUEST_ID_CONFLICT','STAGE_CONFLICT','RUN_ACTIVE','EXPORT_STALE'].includes(state.error.error.code)&&<p>현재 상태를 다시 확인하고 제출하세요. 이전 입력을 자동으로 덮어쓰지 않습니다. 재조회가 실패했다면 상태 새로고침을 이용하세요.</p>}<ul>{state.error.error.nextActions?.map(a=><li key={a}>{nextText[a]}</li>)}</ul>{state.pendingRetry?<><p>응답이 유실되었을 수 있습니다. 아래 버튼은 같은 요청 ID와 입력으로 다시 확인합니다.</p><button disabled={state.busy} onClick={()=>void ctl.retryPending()}>같은 요청 다시 보내기</button></>:<button disabled={state.busy} onClick={()=>{if(!p&&(initialProjectId??savedId()))void ctl.open((initialProjectId??savedId())!);else void ctl.refreshSafely();}}>서버 상태 다시 확인</button>}</section>}{pollError&&<p role="alert" className="warning">{pollError} · 연결 재확인 중입니다. 완료로 표시하지 않습니다.</p>}
 {p&&<진행상태 key={`${p.activeRun?.runId??p.lastRun?.runId}`} p={p} busy={busy} send={ctl.send} events={state.events} lastSyncedAt={state.lastSyncedAt}/>}
 {q&&<질문 key={`${q.questionId}:${q.version}`} q={q} busy={busy||!p!.allowedActions.includes('answer')} onAnswer={answer=>void ctl.send('answers',{questionId:q.questionId,answer})}/>}
 {!p&&!state.loading&&!initialProjectId&&<주제 busy={busy} onCreate={ctl.create}/>}
 {p&&view==='brief'&&<section className="panel"><h2>조사 시작</h2><p>프로젝트는 저장되었습니다. 조사 기준 시각·기간을 확인한 후 시작하세요.</p><button className="primary" disabled={busy||!!p.activeRun||!['topic','selection'].includes(p.stage)||!!p.storyboard||!!q} onClick={()=>void ctl.send('research')}>자료 조사 시작</button></section>}
 {p&&view==='candidates'&&!q&&<후보 key={`${p.projectId}:${p.researchVersion}:${p.selectedCandidateIds.join(',')}`} p={p} busy={busy} send={ctl.send}/>}
 {p&&view==='plan'&&!q&&(p.storyboard?<스토리보드 key={`${p.storyboard.version}:${p.storyboard.approvedVersion}`} p={p} busy={busy} send={ctl.send}/>:<div className="empty">선택한 원문을 확인하고 편집 방향을 준비하고 있습니다. 필요한 질문이 생기면 이곳에 표시됩니다.</div>)}
 {p&&view==='review'&&(p.result?<검수 developmentMock={developmentMock} key={`${p.result.version}`} p={p} busy={busy} send={ctl.send}/>:<div className="empty"><h2>카드 제작 중</h2><p>이미지·글자 렌더링의 서버 검증 결과를 기다립니다. 실제 결과를 받기 전에는 미리보기나 완료를 표시하지 않습니다.</p></div>)}
 {p&&view==='exports'&&<><다운로드 p={p} developmentMock={developmentMock} busy={busy} onRefresh={()=>void ctl.refreshSafely()}/>{p.result&&<검수 developmentMock={developmentMock} key={p.result.version} p={p} busy={busy} send={ctl.send}/>}</>}
 </main></div><footer>조사 → 선택 → 승인 → 제작 → 검수 · 자동 게시하지 않습니다.</footer></div>;
};
export default App;
