import {useState} from 'react';
import {canonicalJson,type FactSourceScope,type ProjectSnapshot,type SemanticReviewReport} from '../../shared/포트.js';
import type {Send} from '../상태.js';
import {출처표시} from './출처표시.js';
const classifications={factual_error:'사실 오류',scope_difference:'기준·범위 차이',unverifiable:'확인 불가',explained_discrepancy:'차이 설명·발표자 귀속',supported:'근거 지지'};
function 비교({c}:{c:FactSourceScope}){return <><p className="hint">수집 모델이 정리한 비교값입니다. 이 표의 개별 항목을 독립적으로 확정한 사실로 취급하지 마세요.</p><dl>{([['국가',c.country],['사건',c.event],['시점·기간',c.period],['대상',c.population],['지표',c.metric],['단위',c.unit],['수치',c.value],['집계',c.aggregation],['잠정치',c.provisional===null?null:c.provisional?'예':'아니요']] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'미확인'}</dd></div>)}</dl></>;}
const verdicts={supported:'근거 지지',unsupported:'근거 지지 안 됨',unverifiable:'확인 불가'};
function 의미보고서({report,p,sources,title}:{report:SemanticReviewReport;p:ProjectSnapshot;sources:ProjectSnapshot['sources'];title:string}){
 const units=p.result?.cards??p.storyboard?.cards??[];
 return <article className="semantic-report"><h4>{title}</h4><p>검수 제공자: {report.reviewer.provider} · 요청 모델: {report.reviewer.model??'SDK 기본값'}</p><p>관측 모델: {report.actualModel??'미확인'} · 검토 시각: {report.reviewedAt}</p><p>LLM 판정: {report.verdict} · {verdicts[report.verdict]} · 이슈 {report.issues.length}개</p><p>검토 범위: 카드 {report.reviewedCardIds.length}개 · 주장 {report.reviewedClaimIndices.length}개</p><p className="hint">수집 근거에 대한 LLM 의견이며 독립 사실 보증이 아닙니다. 사용자 직접 검수와 최종 승인은 별도입니다.</p><details className="review-details"><summary>검토 범위·입력 해시 상세</summary><p>검토 카드: {report.reviewedCardIds.map(id=>units.find(c=>c.cardId===id)?.order??id).join(', ')||'없음'} · 검토 주장: {report.reviewedClaimIndices.map(i=>i+1).join(', ')||'없음'}</p><p>입력 해시: {report.inputHash}</p></details>{report.issues.map((i,n)=><details className="semantic-issue" key={n}><summary>의견 {n+1} · 카드 {i.cardId===null?'전체/미지정':units.find(c=>c.cardId===i.cardId)?.order??i.cardId} · 주장 {i.claimIndex===null?'전체/미지정':i.claimIndex+1} · 참조 출처 {i.sourceIds.length}개</summary><p>{i.message}</p><p>수정 제안: {i.suggestion??'없음 · 근거와 원고를 직접 확인하세요.'}</p><details><summary>참조 출처 식별자</summary><p>{i.sourceIds.length===0?'없음 · 근거 미확인':i.sourceIds.join(', ')}</p></details><출처표시 ids={i.sourceIds} sources={sources}/></details>)}</article>;
}
/** 선택은 요청 범위일 뿐 기계 판정을 바꾸지 않습니다. 적용 전 원고를 보존합니다. */
export function 사실검수({p,busy,send,dirty=false}:{p:ProjectSnapshot;busy:boolean;send:Send;dirty?:boolean}){
 // 접수/실패 버전은 선택의 정체성이 아닙니다. 주장 index와 카드 원고·근거가 달라지면 안전하게 초기화합니다.
 const identity=JSON.stringify([p.projectId,p.selectedCandidateIds,p.claims,p.sources,(p.result?.cards??p.storyboard?.cards??[]).map(c=>[c.cardId,c.order,c.title,c.body,c.sourceIds])]);
 return <사실검수입력 key={identity} p={p} busy={busy} send={send} dirty={dirty}/>;
}
function 사실검수입력({p,busy,send,dirty}:{p:ProjectSnapshot;busy:boolean;send:Send;dirty:boolean}){
 const [claims,setClaims]=useState<number[]>([]),[cards,setCards]=useState<string[]>([]);
 const [reviewer,setReviewer]=useState<'agy'|'claude'>('agy'),[reviewEffort,setReviewEffort]=useState<'high'|'medium'|'low'>('high');
 const locked=busy||!!p.activeRun;
 const recovery=p.factRecovery;
 const recoveryBlocked=busy?'요청 전송 또는 미확정 결과 확인을 완료한 뒤 계속하세요.':p.activeRun?'진행 중인 작업과 취소 정리를 완료한 뒤 계속하세요.':p.question?.status==='open'?'열린 질문을 완료한 뒤 계속하세요.':dirty?'미제출 초안을 저장하거나 버린 뒤 계속하세요.':!recovery?.available?(recovery?.reason??'현재 저장된 복구로 계속할 수 없습니다.'):!p.allowedActions.includes('resume_fact_review')?'현재 서버 상태에서는 부분 복구를 계속할 수 없습니다.':!p.factReview||p.factReview.claimIndices.length===0||p.factReview.cardIds.length===0?'저장된 요청 범위가 없어 계속할 수 없습니다.':null;
 const units=p.result?.cards??p.storyboard?.cards??[],review=p.factReview,proposal=review?.proposal;
 const current=review?.readyVersion===p.projectVersion&&review.storyboardVersion===p.storyboard?.version&&review.resultVersion===(p.result?.version??null);
 const changes=proposal?.cards.some(c=>{const b=proposal.beforeCards.find(b=>b.cardId===c.cardId);return b&&(b.title!==c.title||b.body!==c.body||JSON.stringify(b.sourceIds)!==JSON.stringify(c.sourceIds));})??false;
 const reportOnly=!!proposal?.cards.length&&proposal.semanticReview?.verdict==='supported'&&!changes;
 const canApply=review?.state==='ready'&&!!proposal?.semanticReview&&current&&(changes||reportOnly)&&p.allowedActions.includes('apply_fact_proposal')&&!p.activeRun&&!busy;
 const sources=[...p.sources,...(proposal?.sources??[])].filter((s,i,a)=>a.findIndex(t=>t.sourceId===s.sourceId)===i);
 const selectedSources=p.claims.filter((_,i)=>claims.includes(i)).flatMap(c=>c.sourceIds);
 const activeReview=review&&p.activeRun?.runId===review.runId?p.activeRun:null;
 const reviewRun=activeReview??(review&&p.lastRun?.runId===review.runId?p.lastRun:null);
 const stoppedLabels:Record<string,string>={failed:'실패',canceled:'취소됨',interrupted:'중단됨',succeeded:'제안 저장 미확인'};
 const reviewLabel=review?.state==='applied'?'적용됨':review?.state==='ready'?'수정안 검토':activeReview?(activeReview.status==='queued'?'진행 대기':activeReview.status==='cancel_requested'?'취소 정리 중':'진행 중'):stoppedLabels[reviewRun?.status??'']??'이전 요청 미완료';
 const lastFailure=reviewRun?.status==='failed'?reviewRun:null;
 const missing=[...(busy?['요청 전송 또는 결과 확인 중입니다. 완료 후 요청하세요.']:[]),...(p.activeRun?['진행 중인 작업을 완료하거나 취소 정리가 끝난 뒤 요청하세요.']:[]),...(!p.allowedActions.includes('reverify_facts')?['현재 서버 상태에서는 사실 재검증 요청이 허용되지 않습니다.']:[]),...(claims.length===0?['문제 주장을 1~100개 선택하세요.']:claims.length>100?['선택한 문제 주장을 100개 이하로 줄이세요.']:[]),...(cards.length===0?['영향 카드를 1~20개 선택하세요.']:cards.length>20?['선택한 영향 카드를 20개 이하로 줄이세요.']:[])];
 const selectAll=()=>{setClaims(p.claims.map((_,i)=>i));setCards(units.map(c=>c.cardId));};
 const allDisabled=locked||p.claims.length===0||p.claims.length>100||units.length===0||units.length>20;
 return <section className="panel" style={{minWidth:0,overflowWrap:'anywhere'}} aria-label="사실 문제와 복구"><h3>사실·출처 문제와 수정안</h3>
 {p.factRecovery&&<section aria-label="저장된 재검증 부분 복구" className="warning"><h4>저장된 재검증 이어서 검토</h4><p>{p.factRecovery.step==='links'?'누락된 주장·카드 연결만 보완한 뒤 내용 의미 검수를 진행합니다.':'연결 검사는 다시 확인하고 내용 의미 검수부터 다시 시도합니다.'}</p>{review&&<p>저장 범위: 주장 {review.claimIndices.length}개 · 카드 {review.cardIds.length}개 · 고정 검수자: {review.reviewer?.provider??'미기록'} · 요청 모델: {review.reviewer?.model??'SDK 기본값'} · 아래 다음 요청 선택은 재개에 사용하지 않습니다.</p>}{p.factRecovery.issues.map((issue,i)=><p key={i}>{issue.code==='FACT_CARD_LINK_MISSING'?`카드 ${issue.cardIds.map(id=>{const c=units.find(c=>c.cardId===id);return c?`${c.order} 「${c.title}」`:id;}).join(', ')} 수정안은 있지만 검토 결과의 주장 연결이 빠졌습니다. 사용자 선택 오류나 뉴스가 거짓이라는 뜻이 아닙니다.`:issue.message}</p>)}<p>기존 출처와 후보 수정안을 재사용하며 전체 재수집·이미지 생성 없이 이어갑니다.</p><p>추가 LLM 사용량이 발생합니다. 원고를 자동 적용·승인하지 않습니다.</p>{recoveryBlocked&&<p role="status">{recoveryBlocked}</p>}<button disabled={!!recoveryBlocked} onClick={()=>{if(!recoveryBlocked&&p.factReview&&p.factRecovery)void send('factReview',{claimIndices:[...p.factReview.claimIndices],cardIds:[...p.factReview.cardIds],resumeFromRunId:p.factRecovery.sourceRunId,checkpointId:p.factRecovery.checkpointId});}}>{p.factRecovery.step==='links'?'누락 부분 보완 후 계속':'내용 검수부터 다시 시도'}</button></section>}
 {p.factIssues===undefined?<p className="hint">세부 사실 경고 기록이 없습니다. 아래 주장·출처를 참고하세요. 직접 확인 승인은 AI 판정을 바꾸지 않고 별도로 기록됩니다.</p>:p.factIssues.length===0?<p>현재 저장된 사실 경고 없음 · 직접 확인은 별도입니다.</p>:<ul>{p.factIssues.map((i,n)=><li key={n}><strong>{[...i.message].length>160?[...i.message].slice(0,160).join('')+'…':i.message}</strong>{[...i.message].length>160&&<details className="review-details"><summary>차단 이유 전문 · 주장 {i.claimIndex===null?'전체/미지정':i.claimIndex+1}</summary><p>{i.message}</p></details>}<p>{i.code}{i.claimIndex!==null?` · 주장 ${i.claimIndex+1}`:''} · 영향 카드 {i.cardIds.map(id=>units.find(c=>c.cardId===id)?.order??'미확인').join(', ')||'미확인'}</p><출처표시 ids={i.sourceIds} sources={sources}/></li>)}</ul>}
 {!p.factRecovery&&lastFailure&&<p className="hint">저장된 부분 복구 자료가 없습니다. 이 이전 실패는 부분 재개할 수 없습니다.</p>}
 {p.result?.semanticReview&&<의미보고서 report={p.result.semanticReview} p={p} sources={p.sources} title="현재 결과 LLM 의미 검수 의견"/>}
 {p.result&&<p className="hint">AI 검사 실패·대기·보고서 없음은 참고 경고입니다. 필요하면 재검수를 요청할 수 있으며, 현재 카드 직접 확인으로 별도 승인할 수 있습니다.</p>}
 <h4>새 전체 재검수 · 별도 요청</h4><p>새 전체 재검수는 선택 범위의 원문 근거를 다시 수집합니다. 위 저장된 부분 복구와 다른 작업이며 아래 선택·검수자를 사용합니다.</p>
 <p>Claude가 원문 근거를 수집하고 수정안을 작성한 뒤, 선택한 검수자가 전체 발행 원고와 수집 근거의 의미를 검토합니다. LLM 의견은 독립 진실 검증이나 사용자 최종 승인을 대신하지 않습니다.</p>
 <label>다음 요청 의미 검수자<select value={reviewer} disabled={locked} onChange={e=>setReviewer(e.target.value as 'agy'|'claude')}><option value="agy">agy · Gemini 3.8 Flash</option><option value="claude">Claude · 프로젝트 모델</option></select></label>
 {reviewer==='agy'?<label>Gemini 검수 노력<select value={reviewEffort} disabled={locked} onChange={e=>setReviewEffort(e.target.value as 'high'|'medium'|'low')}><option value="high">High (기본)</option><option value="medium">Medium</option><option value="low">Low</option></select></label>:<p>Claude 요청 모델: {p.claudeModel??'SDK 기본값 (실제 모델은 실행 후 관측)'} · 작성 모델 설정은 변경하지 않습니다.</p>}
 <p>선택은 다음 명시 요청에만 적용됩니다. 자동 검수·자동 모델 전환은 없습니다.</p>
 <button disabled={allDisabled} onClick={selectAll}>모든 주장·카드 선택</button>
 <p>문제 주장과 영향 카드를 직접 선택하세요. 출처가 겹치는 카드는 추천일 뿐 의미 연결 확정이 아닙니다. 재검증 요청은 원고·승인을 바꾸지 않으며 별도 적용이 필요합니다.</p>
 {p.claims.map((c,i)=><div key={i}><label><input type="checkbox" disabled={busy||!!p.activeRun} checked={claims.includes(i)} onChange={()=>setClaims(a=>a.includes(i)?a.filter(n=>n!==i):[...a,i])}/>{`문제 주장 ${i+1} 선택`} · {c.text}</label><p>{c.kind} · {c.availability} · {c.conditions.join(' / ')}</p><출처표시 ids={c.sourceIds} sources={p.sources}/></div>)}
 {units.map(c=><div key={c.cardId}><label><input type="checkbox" checked={cards.includes(c.cardId)} disabled={busy||!!p.activeRun} onChange={()=>setCards(a=>a.includes(c.cardId)?a.filter(id=>id!==c.cardId):[...a,c.cardId])}/>{`영향 카드 ${c.order} 선택`}</label>{c.sourceIds.some(id=>selectedSources.includes(id))&&<small> 출처 겹침 추천 · 사용자 선택 필요</small>}</div>)}
 <div role="group" aria-label="사실 재검증 요청과 상태">
 <p role="status">선택한 주장 {claims.length}/{p.claims.length}개 · 카드 {cards.length}/{units.length}개</p>
 {lastFailure&&<div role="alert" className="error"><p>마지막 재검증 실패 · 단계: {lastFailure.phase} · {lastFailure.error?.code??'원인 코드 미기록'}</p><p>{lastFailure.error?.message??'완료 보고서를 확인하지 못했습니다.'}</p><p>원문 수집 후보 준비는 사실 검증 성공이 아닙니다. 완료된 의미 검수 보고서가 없으면 통과로 표시하지 않습니다.</p></div>}
 {!p.result?.semanticReview&&<p>{activeReview?'재검증 진행 중 · 완료 보고서는 아직 없습니다.':lastFailure?'재검증 실패 · 완료된 의미 검수 보고서가 없습니다.':review?'이전 재검증 기록을 확인하세요. 현재 원고의 의미 검수 보고서는 아직 없습니다.':'아직 사실 재검증을 요청하지 않았습니다. 현재 원고의 의미 검수 보고서가 없습니다.'}</p>}
 {missing.length>0?<ul className="hint">{missing.map(text=><li key={text}>{text}</li>)}</ul>:<p>요청 조건을 충족했습니다. 아래 버튼으로 새 사실 재검증을 명시 요청할 수 있습니다.</p>}
 {!activeReview&&review&&<p>이전 요청은 사용량을 소모했을 수 있습니다. 새 요청은 추가 사용량이 발생할 수 있으며 자동 재시도하지 않습니다.</p>}
 <p>다음 행동: 선택 범위와 위 검수자를 확인한 뒤 새 재검증을 요청하세요. 원고·그림·기존 승인은 제안 생성만으로 바뀌지 않으며, 제안 적용과 최종 승인은 별도입니다.</p>
 <button disabled={allDisabled} onClick={selectAll}>요청 위치에서 모든 주장·카드 선택</button>
 <button disabled={missing.length>0} onClick={()=>void send('factReview',{claimIndices:claims,cardIds:cards,reviewer,reviewEffort})}>선택한 주장·카드 사실 재검증</button>
 </div>
 {review&&<div><h4>재검증 {reviewLabel} · 기준 프로젝트 v{review.baseVersion}</h4><p>접수된 검수자: {review.reviewer?.provider??'미기록'} · 요청 모델: {review.reviewer?review.reviewer.model??'SDK 기본값':'미기록'}</p>{activeReview&&<p>의미 검수 결과 대기 · Claude 근거 수집·수정안 작성 후 선택 검수자가 검토합니다. 완료 보고서 전에는 의미 검수 통과가 아닙니다.</p>}{review.state==='pending'&&!activeReview&&<><p>이 재검증은 현재 실행 중이 아닙니다. 기존 원고와 검수 기록은 유지됩니다. 자동으로 재요청하지 않습니다.</p>{reviewRun?.error&&!lastFailure&&<p role="alert" className="error">{reviewRun.error.message}</p>}</>}{proposal&&<>
 {proposal.semanticReview?(canonicalJson(proposal.semanticReview)!==canonicalJson(p.result?.semanticReview??null)&&<의미보고서 report={proposal.semanticReview} p={p} sources={sources} title="적용 전 제안 LLM 의미 검수 의견"/>):<p className="hint">이전 제안에 LLM 의미 검수 기록이 없습니다. 원고·근거는 보존되며 현재 버전에서 명시 재검증해야 적용할 수 있습니다.</p>}<h4>앱이 관측한 접근 상태 · {proposal.observations.length}건</h4><p>HTTP·수신량은 접근 관측입니다. SDK 처리 결과나 모델의 근거 지지를 독립 사실 검증으로 취급하지 않습니다.</p>
 {proposal.observations.length===0&&<p>실제 원문 접근 관측 없음 · 근거 미확인</p>}
 <details className="review-details"><summary>원문 접근·근거 해시 상세 {proposal.observations.length}건</summary>{proposal.observations.map((o,i)=><article key={i}><p>HTTP {o.statusCode??'미확인'} · {o.outcome} · {o.bytes??'미확인'} bytes · {o.observedAt}</p><p>근거 해시 {o.evidenceSha256??'없음 · 근거 미확인'}</p><출처표시 ids={[o.sourceId]} sources={sources}/></article>)}</details>
 {proposal.findings.some(f=>f.classification==='unverifiable')&&<p className="warning">확인 불가 판정은 적용 후에도 기록에 남습니다. 직접 확인 승인은 AI 판정을 통과로 바꾸지 않습니다.</p>}
 {proposal.findings.map(f=><details className="review-details" key={f.claimIndex}><summary>주장 {f.claimIndex+1} · {classifications[f.classification]} · 영향 카드 {f.cardIds.map(id=>units.find(c=>c.cardId===id)?.order??'미확인').join(', ')}</summary><p>{f.reason}</p><p>변경 전: {proposal.beforeClaims.find(b=>b.claimIndex===f.claimIndex)?.claim.text??'변경 전 기록 없음'}</p><p>제안: {f.afterClaim.text} · {f.afterClaim.kind} · {f.afterClaim.availability}</p><ul>{f.afterClaim.conditions.map(c=><li key={c}>{c}</li>)}</ul>{f.comparisons.map((c,i)=><div key={i}><출처표시 ids={[c.sourceId]} sources={sources}/><비교 c={c}/></div>)}</details>)}
 {proposal.sources.length>0&&<div><h4>제안 출처 · {proposal.sources.length}개</h4><출처표시 ids={proposal.sources.map(s=>s.sourceId)} sources={sources}/></div>}
 {proposal.cards.map(c=>{const before=proposal.beforeCards.find(b=>b.cardId===c.cardId);return <details className="review-details" key={c.cardId}><summary>카드 {units.find(u=>u.cardId===c.cardId)?.order??'미확인'} 원고 전후</summary><p>변경 전 제목: {before?.title??'기록 없음'}</p><p className="prewrap">{before?.body??'기록 없음'}</p><p>변경 후 제목: {c.title}</p><p className="prewrap">{c.body}</p><출처표시 ids={c.sourceIds} sources={sources}/></details>;})}
 <p>제안은 전체 단위로 적용됩니다. 기존 이미지를 재사용하며, 적용 후 기계 재판정과 직접 검수가 필요합니다. 현재 차단 사유는 적용 전까지 유지됩니다.</p>
 {!proposal.cards.some(c=>{const b=proposal.beforeCards.find(b=>b.cardId===c.cardId);return b&&(b.title!==c.title||b.body!==c.body);})&&<p>문구 정정 제안이 없습니다. 근거만 확인한 결과인지, 확인 불가로 수정하지 못한 결과인지 판정 이유를 확인하세요.</p>}
 {reportOnly&&<p>원고 변경 없이 의미 검수 기록을 적용합니다. 기존 그림을 재사용해 서버가 적용·재판정하며 사용자 최종 승인은 별도입니다.</p>}
 {!changes&&!reportOnly&&<p>실제 원고·출처 수정안이 없어 적용할 수 없습니다. 확인 불가·근거 부족은 그대로 남습니다.</p>}{!current&&review.state==='ready'&&<p>오래된 제안입니다. 현재 버전에서 다시 재검증하세요.</p>}
 <button disabled={!canApply} onClick={()=>void send('factApply',{reviewRunId:review.runId})}>사실 수정안 전체 적용</button>
 </>}</div>}
 </section>;
}
