import {useEffect,useState} from 'react';
import type {ProjectSnapshot,RunStatus,EngineEvent} from '../../shared/포트.js';
import type {Send} from '../상태.js';
const statusText:Record<RunStatus,string>={queued:'작업 대기 중',running:'작업 실행 중',waiting_for_user:'사용자 답변 대기',cancel_requested:'취소 요청됨 · 정리 확인 중',succeeded:'이 작업 단계 완료',failed:'작업 실패',canceled:'작업 취소됨',interrupted:'작업 중단됨'};
const runningText={research:'자료 조사를 진행하고 있습니다.',editorial:'선택한 소식의 근거 확인과 기획을 진행하고 있습니다.',production:'실제 이미지 생성과 카드 렌더링을 진행하고 있습니다.',revision:'저장된 수정 요청을 처리하고 있습니다.',export:'PNG·ZIP·기록 파일을 준비하고 있습니다.'};
export const nextText:Record<string,string>={retry:'확인 후 명시적으로 재시도하세요.',answer:'현재 질문에 답변해 주세요.',select:'후보 1~3개를 선택해 주세요.',approve_storyboard:'계획과 크기를 검토한 뒤 승인하세요.',approve_final:'현재 결과를 직접 검수한 뒤 최종 승인하세요.',revise:'문제가 있는 카드만 수정 요청하세요.',cancel:'실행 중 작업을 취소할 수 있습니다.',check_login:'계정 연결에서 해당 도구의 공식 로그인 상태를 확인하세요. 비밀번호·API 키는 입력하지 마세요.',wait_quota:'제공자의 요청 제한 상태를 확인한 뒤 다시 시도하세요. 별도 API로 대체하지 않습니다.',contact_user:'작업 기록을 확인하고 담당자에게 문의하세요.'};
const phaseText:Record<string,string>={topic:'주제',research:'자료 조사',selection:'후보 선택',editorial:'편집·기획',storyboard:'스토리보드',production:'제작',revision:'수정',review:'검수',export:'내보내기'};
const operationText={authentication:'인증 확인',search:'검색',fetch:'원문 확인',planning:'기획',image:'이미지 생성',conversion:'PNG 변환',render:'카드 렌더링',export:'내보내기'};
const activityText={started:'시작',completed:'완료',failed:'실패',waiting:'대기'};
const time=(s:string|null|undefined)=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'아직 없음';
function formatEvent(e:EngineEvent,cardOrder?:number):string {
 if(e.type==='error')return `${e.error.code} · ${e.error.message}`;
 if(e.type==='need_input')return '사용자 답변 요청';
 if(e.type==='result')return `${({candidates:'후보',storyboard:'기획',cards:'카드',exports:'내보내기'})[e.kind]} 결과 저장 · v${e.version}`;
 const a=e.activity;
 return (a?`${a.provider==='claude'?'Claude Agent SDK':a.provider==='agy'?'Google/agy':'앱'} · ${operationText[a.operation]} ${activityText[a.status]}${a.cardId?` · ${cardOrder===undefined?'대상 카드':`카드 ${cardOrder}`}`:''}${a.tool?` · ${a.tool}`:''} — `:'')+e.message;
}
export function 진행상태({p,busy,send,events,lastSyncedAt}:{p:ProjectSnapshot;busy:boolean;send:Send;events:EngineEvent[];lastSyncedAt?:string|null}){const [confirmed,setConfirmed]=useState(false);const [now,setNow]=useState(Date.now);const run=p.activeRun??p.lastRun;
 useEffect(()=>{if(!p.activeRun)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[p.activeRun?.runId]);
 const eventText=(e:EngineEvent)=>formatEvent(e,e.type==='progress'?(p.result?.cards??p.storyboard?.cards??[]).find(c=>c.cardId===e.activity?.cardId)?.order:undefined);
 const ordered=events.filter(e=>e.projectId===p.projectId).slice().sort((a,b)=>a.seq-b.seq);
 const currentEvents=ordered.filter(e=>e.runId===run?.runId);
 const live=!!p.activeRun;
 const elapsed=run?Math.max(0,Math.floor(((live?now:Date.parse(run.updatedAt))-Date.parse(run.createdAt))/1000)):0;
 const cards=(p.result?.cards??((run?.kind==='production'||run?.kind==='revision')?p.storyboard?.cards:[])??[]).map(c=>({cardId:c.cardId,state:'state' in c?c.state:'pending'}));
 for(const e of currentEvents){if(!live||e.type!=='progress'||!e.activity?.cardId)continue;const activity=e.activity,card=cards.find(c=>c.cardId===activity.cardId);if(!card||card.state==='ready')continue;
  if(activity.status==='failed')card.state='failed';
  // 파일 렌더 완료와 DB 저장 완료는 다릅니다. ready는 저장 스냅샷만 결정합니다.
  else if(activity.operation==='render'&&activity.status==='completed')card.state='rendering';
  else if(activity.status==='started')card.state=activity.operation==='render'?'rendering':'generating';
  else if(activity.status==='waiting')card.state='pending';
 }
if(!run)return null;const error=run.error;const progress=currentEvents.filter(e=>e.type==='progress').at(-1);const retry=['failed','interrupted','canceled'].includes(run.status)&&run.retryAllowed&&p.allowedActions.includes('retry');return <section className="panel run-status" aria-label="작업 상태"><div className="section-head"><h2>{statusText[run.status]}</h2><span className="badge">시도 {run.attempt} · {phaseText[run.phase]??phaseText[run.kind]??'작업'}</span></div><p>{run.status==='waiting_for_user'?'오류가 아닙니다. 아래 질문에 답하면 작업을 이어갑니다.':run.status==='cancel_requested'?'하위 작업 정리가 끝나기 전에는 취소 완료로 표시하지 않습니다.':run.status==='interrupted'?'저장된 결과는 유지됩니다. 자동 재실행하지 않습니다.':run.status==='succeeded'?'단계 완료와 프로젝트 최종 승인은 다릅니다. 다음 화면을 확인하세요.':run.status==='failed'?'작업이 실패했습니다. 오류와 저장된 기록을 확인한 뒤 재시도 여부를 결정하세요.':(run.status==='running'?runningText[run.kind]:run.status==='queued'?'작업 시작을 기다리고 있습니다.':'작업이 취소됐습니다. 저장된 결과와 기록은 유지됩니다.')}</p><p role="status" aria-label="현재 작업">{live&&progress?.type==='progress'?eventText(progress):statusText[run.status]}</p>
 <dl className="progress-meta"><dt>경과시간</dt><dd>{Math.floor(elapsed/60)}분 {elapsed%60}초{live?'':' · 실행 종료'}</dd><dt>최근 실제 활동</dt><dd>{time(currentEvents.at(-1)?.at)}</dd><dt>최근 서버 조회</dt><dd>{time(lastSyncedAt)}</dd></dl>
 <p className="hint">서버 조회 시각은 모델 작업 진행의 증거가 아닙니다. 활동이 없으면 새 이벤트를 기다립니다.</p>
 {cards.length>0?<p className="card-counts">카드 완료 {cards.filter(c=>c.state==='ready').length}/{cards.length} · 대기 {cards.filter(c=>c.state==='pending').length} · 진행 {cards.filter(c=>c.state==='generating'||c.state==='rendering').length} · 오류 {cards.filter(c=>c.state==='failed').length}</p>:progress?.type==='progress'&&progress.completed!==null&&progress.total!==null&&<p>카드 완료 {progress.completed}/{progress.total}</p>}
 <details className="event-history" open><summary>시간순 작업 이력 · {ordered.length}건</summary>{ordered.length?<ol aria-label="시간순 작업 이력">{ordered.map(e=><li key={`${e.projectId}:${e.runId}:${e.seq}`}><time dateTime={e.at}>{time(e.at)}</time><span>시도 {e.attempt} · {eventText(e)}</span></li>)}</ol>:<p>아직 저장된 작업 이벤트가 없습니다.</p>}</details>{error&&<div className="error" role="alert"><strong>{error.code}</strong><p>{error.message}</p><ul>{error.nextActions.map(a=><li key={a}>{nextText[a]}</li>)}</ul></div>}{run.externalOutcome==='unknown'&&<label className="warning"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>외부 실행 결과가 불명확하여 중복 호출될 수 있음을 확인했습니다</label>}<div className="actions">{p.activeRun&&p.allowedActions.includes('cancel')&&<button disabled={busy||run.status==='cancel_requested'} onClick={()=>void send('cancel')}>작업 취소 요청</button>}{retry&&<button disabled={busy||(run.externalOutcome==='unknown'&&!confirmed)} onClick={()=>void send('retry',run.externalOutcome==='unknown'?{confirmUnknownOutcome:true}:{})}>실패·중단 작업 재시도</button>}</div></section>;}
