import {useEffect,useRef,useState} from 'react';
import type {ConnectionProvider,ConnectionState} from '../../shared/연결계약.js';
import {type ConnectionClient,type ConnectionAction} from '../연결클라이언트.js';
import {asFailure} from '../상태.js';
const labels={agy:'Google/agy',claude:'Claude Agent SDK'};
const statuses={unknown:'미확인',checking:'연결 확인 중',connected:'연결 정보 확인됨',login_pending:'공식 로그인 대기',login_required:'로그인 필요',error:'연결 오류'};
const pending=(c:ConnectionState)=>c.status==='checking'||c.status==='login_pending';
const time=(s:string|null)=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'아직 없음';
function officialLink(c:ConnectionState):boolean {
 if(!c.loginUrl)return false;
 try{const u=new URL(c.loginUrl),hosts=c.provider==='claude'?['claude.ai','platform.claude.com']:['accounts.google.com','antigravity.google'];
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.includes(u.hostname)&&c.loginUrl.length<=8192&&(c.provider!=='claude'||/^\/(?:oauth|login)(?:\/|$)/.test(u.pathname))&&(u.hostname!=='antigravity.google'||/^\/(?:auth|oauth)(?:\/|$)/.test(u.pathname));
 }catch{return false;}
}
export function 계정연결({client,working=false}:{client:ConnectionClient;working?:boolean}){
 const [connections,setConnections]=useState<ConnectionState[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[sending,setSending]=useState<ConnectionProvider|null>(null);
 const locked=useRef(false),epoch=useRef(0);
 const [codes,setCodes]=useState<Partial<Record<ConnectionProvider,string>>>({});
 async function load(){const g=epoch.current;try{const data=await client.list();if(g===epoch.current){setConnections(data.connections);setError('');}}catch(e){if(g===epoch.current)setError(asFailure(e).error.message);}finally{if(g===epoch.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{epoch.current++;};},[client]);
 useEffect(()=>{setCodes(previous=>Object.fromEntries(Object.entries(previous).filter(([provider])=>connections.some(c=>c.provider===provider&&c.needsCode&&pending(c)))));},[connections]);
 const hasPending=connections.some(pending);
 useEffect(()=>{if(!hasPending)return;let disposed=false,timer:ReturnType<typeof setTimeout>;const tick=async()=>{if(!locked.current)await load();if(!disposed)timer=setTimeout(tick,1500);};timer=setTimeout(tick,1500);return()=>{disposed=true;clearTimeout(timer);};},[hasPending,client]);
 async function act(c:ConnectionState,action:ConnectionAction){
  if(locked.current)return;locked.current=true;epoch.current++;setSending(c.provider);setError('');
  const authorizationCode=codes[c.provider];if(action==='code')setCodes(s=>({...s,[c.provider]:''}));
  try{const updated=await client.act(c.provider,action,{requestId:crypto.randomUUID(),...((action==='cancel'||action==='code')?{operationId:c.operationId!}:{}),...(action==='code'?{authorizationCode}: {})});setConnections(s=>s.map(x=>x.provider===updated.provider?updated:x));}
  catch(e){setError(asFailure(e).error.message+' 상태 다시 조회로 실제 결과를 확인하세요.');}
  finally{locked.current=false;setSending(null);}
 }
 return <section className="panel connections" aria-label="계정 연결 관리"><h2>계정 연결</h2>
 <p>본인 Google 계정의 agy와 Claude 구독을 연결합니다. 로그인 시작 시 공식 브라우저가 열릴 수 있습니다. 비밀번호·API 키는 이 앱에 입력하지 않습니다.</p>
 <p className="hint">연결 정보 확인은 실제 검색·이미지 생성 성공이나 남은 구독 한도를 뜻하지 않습니다.</p>
 {working&&<p className="warning">작업 실행 중에는 새 로그인·연결 검사나 인증 교체를 시작할 수 없습니다. 작업 종료 후 진행하세요.</p>}
 {loading&&<p role="status">저장된 연결 상태를 조회하고 있습니다.</p>}{error&&<p role="alert" className="error">{error}</p>}
 <button disabled={loading||!!sending} onClick={()=>{setLoading(true);void load();}}>연결 상태 다시 조회</button>
 {connections.map(c=><article className="connection-row" key={c.provider}><div className="section-head"><h3>{labels[c.provider]}</h3><span className="badge" role="status">{statuses[c.status]}</span></div><p>{c.message}</p>
 {c.errorCode&&<p className="error">오류 코드: {c.errorCode}</p>}
 <dl className="connection-meta"><dt>설치 버전</dt><dd>{c.version??'미확인'}</dd><dt>인증 방식</dt><dd>{c.authMethod==='subscription'?'Claude 구독':c.authMethod==='google_account'?'Google 계정':'미확인'}</dd><dt>마지막 확인</dt><dd>{time(c.checkedAt)}</dd><dt>최근 연결 활동</dt><dd>{time(c.lastActivityAt)}</dd></dl>
 {c.checkedAt&&<p className="hint">위 시각에 확인한 정보입니다. 현재 유효 여부는 연결 확인으로 다시 검사하세요.</p>}
 <div className="actions"><button disabled={!!sending||pending(c)||working} onClick={()=>void act(c,'login')}>{labels[c.provider]} 로그인 시작</button><button disabled={!!sending||pending(c)||working} onClick={()=>void act(c,'check')}>{labels[c.provider]} 연결 확인</button>{pending(c)&&c.operationId&&<button disabled={!!sending} onClick={()=>void act(c,'cancel')}>{labels[c.provider]} 연결 작업 취소</button>}</div>
 {c.loginUrl&&officialLink(c)&&pending(c)&&<p><a href={c.loginUrl} target="_blank" rel="noopener noreferrer">{labels[c.provider]} 공식 로그인 열기</a></p>}
 {c.needsCode&&c.operationId&&pending(c)&&<form onSubmit={e=>{e.preventDefault();void act(c,'code');}}><label htmlFor={'code-'+c.provider}>공식 로그인 인증 코드</label><input id={'code-'+c.provider} type="password" autoComplete="off" value={codes[c.provider]??''} onChange={e=>setCodes(s=>({...s,[c.provider]:e.target.value}))}/><p className="hint">공식 로그인 프로그램이 요청한 코드만 입력하세요. 전송 즉시 입력을 지웁니다.</p><button disabled={!!sending||!codes[c.provider]?.trim()}>인증 코드 전달</button></form>}
 </article>)}
 </section>;
}
