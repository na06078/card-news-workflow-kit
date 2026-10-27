import {useEffect,useRef,useState} from 'react';
import {ExportListSchema,type ExportList,type FrontendClient,type ProjectSnapshot} from '../../shared/포트.js';
import {createHttpClient,clientError} from '../클라이언트.js';
import {asFailure,type Send} from '../상태.js';
export function 다운로드({p,onRefresh,busy,developmentMock,client,send}:{p:ProjectSnapshot;onRefresh:()=>void;busy:boolean;developmentMock:boolean;client?:FrontendClient;send?:Send}){
 const [api]=useState(()=>client??createHttpClient()),[list,setList]=useState<ExportList|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[downloading,setDownloading]=useState(false),[refresh,setRefresh]=useState(0);
 const r=p.result,approved=!!r&&r.finalApprovedVersion===r.version,key=`${p.projectId}:${r?.version}:${approved}`,current=useRef(key);current.current=key;
 const [loadedKey,setLoadedKey]=useState(''),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 async function readList(){
  const data=ExportListSchema.safeParse(await api.getExports(p.projectId));
  if(!data.success)throw clientError('CLIENT_PROTOCOL_ERROR','파일 목록 응답 형식이 일치하지 않습니다. 파일 상태를 다시 확인하세요.');
  if(data.data.resultVersion!==r?.version||data.data.entries.some(e=>e.projectId!==p.projectId||e.resultVersion!==r.version||(e.kind==='png'&&!r.cards.some(c=>c.cardId===e.cardId&&c.revision===e.cardRevision))))throw clientError('EXPORT_STALE','현재 승인 버전의 파일 목록이 아닙니다. 상태를 다시 확인하세요.');
  return data.data;
 }
 useEffect(()=>{let alive=true;setList(null);setError('');if(!approved||developmentMock)return;setLoading(true);
  void readList().then(data=>{if(alive){setList(data);setLoadedKey(key);}}).catch(e=>{if(alive)setError(asFailure(e).error.message);}).finally(()=>{if(alive)setLoading(false);});return ()=>{alive=false;};
 },[api,key,p.projectVersion,refresh,developmentMock]);
 const entries=loadedKey===key?list?.entries??[]:[];
 async function download(exportId:string){
  if(busy||downloading||!approved)return;setDownloading(true);setError('');const started=key;
  try{const latest=await readList();if(!mounted.current||current.current!==started)return;const entry=latest.entries.find(e=>e.exportId===exportId);
   if(!entry)throw clientError('EXPORT_STALE','이 파일은 현재 승인 목록에 없습니다. 파일 상태를 다시 확인하세요.');
   if(!api.downloadExport)throw clientError('CLIENT_PROTOCOL_ERROR','이 연결은 안전한 파일 다운로드를 지원하지 않습니다. 앱 연결을 갱신하세요.');
   const blob=await api.downloadExport(p.projectId,exportId);if(!mounted.current||current.current!==started)return;
   if(!blob.size||(blob.type.includes('json')&&entry.mimeType!=='application/json'))throw clientError('CLIENT_PROTOCOL_ERROR','파일 대신 빈 응답 또는 예상하지 않은 JSON 응답이 반환됐습니다.');
   const url=URL.createObjectURL(blob);try{const a=document.createElement('a');a.href=url;a.download=entry.filename;document.body.append(a);a.click();a.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),0);}
  }catch(e){if(current.current===started)setError(asFailure(e).error.message);}finally{if(current.current===started)setDownloading(false);}
 }
 return <section className="panel downloads"><p className="eyebrow">05 / DELIVERABLES</p><h2>내려받기</h2>
 {developmentMock?<p className="note">모의 모드에서는 실제 파일을 제공하지 않습니다. PNG·ZIP·출처 및 이미지 기록은 실제 서버 통합에서 검증해야 합니다.</p>:!approved?<p>현재 결과의 최종 승인이 필요합니다. 이전 승인 파일은 내려받을 수 없습니다.</p>:<>
 {error&&<p role="alert" className="error">{error}</p>}
 {loading?<p role="status">현재 승인 버전의 파일 목록 확인 중</p>:entries.length===0?<div className="empty"><h3>최종 승인됨 · 파일 준비 상태 확인 필요</h3><p>승인이 곧 파일 완성을 뜻하지 않습니다. 파일 조회 실패와 생성 실패는 별개입니다.</p></div>:<ul>
 {entries.map(e=><li key={e.exportId}><div><strong>{e.kind==='png'?'PNG':e.kind==='zip'?'ZIP':'출처·이미지 기록'}</strong><p>{e.filename} · 결과 v{e.resultVersion}{e.cardRevision?` · 개정 ${e.cardRevision}`:''} · {e.bytes.toLocaleString('ko-KR')} bytes</p></div><button disabled={busy||downloading||loading} onClick={()=>void download(e.exportId)}>{e.kind.toUpperCase()} 내려받기</button></li>)}
 </ul>}
 {list?.exportRun?.status==='failed'&&<p role="alert">내보내기 작업 실패 · {list.exportRun.error?.message??'파일 생성 상태를 확인하세요.'}</p>}
 <button disabled={busy||loading||downloading} onClick={()=>{setRefresh(n=>n+1);onRefresh();}}>파일 상태 다시 확인</button>
 <p>파일만 다시 생성해도 현재 최종 승인·원고·그림은 유지됩니다. 새 생성이 끝난 후 목록을 다시 확인하세요.</p>
 <button disabled={busy||downloading||!!p.activeRun||!send||!p.allowedActions.includes('rebuild_exports')} onClick={()=>void send?.('rebuildExports')}>승인 유지 · 파일만 다시 생성</button>
 {!p.allowedActions.includes('rebuild_exports')&&<p className="hint">현재 서버 상태에서는 파일 재생성이 허용되지 않습니다. 활성 내보내기 작업을 확인하세요.</p>}
 </>}
 <p className="hint">생성 이미지는 실제 제품 화면·사건 사진이 아닐 수 있습니다. 출처와 도구·날짜·프롬프트·사용 조건 기록을 함께 확인하세요.</p></section>;
}

