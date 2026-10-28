import {test,expect} from 'vitest';
import * as C from '../../src/shared/포트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
const normalize=(raw:unknown,p:C.ProjectSnapshot,r:C.RevisionRequest):C.RevisionDecision=>{
 const fn=(C as unknown as {normalizeRevisionDecision?:Function}).normalizeRevisionDecision;expect(typeof fn).toBe('function');return fn!(raw,p,r);
};
function fixture(){const p=createMockSnapshot('review'),card=p.result!.cards[0],r:C.RevisionRequest={requestId:crypto.randomUUID(),version:p.result!.version,scope:'layout',cardIds:[card.cardId],instruction:'가운데 정렬'};return {p,card,r};}
test('선택 카드의 허용된 patch만 정규화하며 원본 metadata를 변경하지 않는다',()=>{
 const {p,card,r}=fixture(),before=structuredClone(p),decision={kind:'revision',status:'patch',patches:[{cardId:card.cardId,scope:'layout',changes:{fontScale:'normal',textAlign:'center',placement:'bottom'}}]};
 expect(normalize(decision,p,r)).toEqual(decision);expect(p).toEqual(before);
});
test('기본값과 동일한 배치는 no_change이며 명시 재합성은 patch를 유지한다',()=>{
 const {p,card,r}=fixture();delete card.layout;const d={kind:'revision',status:'patch',patches:[{cardId:card.cardId,scope:'layout',changes:{fontScale:'normal',textAlign:'left',placement:'bottom'}}]};
 expect(normalize(d,p,r).status).toBe('no_change');expect(normalize(d,p,{...r,renderOnly:true}).status).toBe('patch');
});
test('범위 확인·질문·처리 불가는 카드 변경이 아닌 정상 결정으로 보존한다',()=>{
 const {p,r}=fixture();for(const d of [{kind:'revision',status:'needs_scope',requestedScope:'text',reason:'원고 수정 확인 필요'},{kind:'revision',status:'unsupported',reason:'지원하지 않는 배치'},{kind:'revision',status:'clarification',question:'어떤 문장을 바꿀까요?'},{kind:'revision',status:'no_change',reason:'이미 적용됨'}])expect(normalize(d,p,r)).toEqual(d);
});
test('비대상 카드·scope·앱 소유 metadata·없는 출처는 거절한다',()=>{
 const {p,card,r}=fixture(),valid={kind:'revision',status:'patch',patches:[{cardId:card.cardId,scope:'layout',changes:{fontScale:'normal',textAlign:'center',placement:'bottom'}}]};
 for(const d of [{...valid,patches:[{...valid.patches[0],cardId:crypto.randomUUID()}]},{...valid,patches:[{...valid.patches[0],changes:{...valid.patches[0].changes,previewAssetId:crypto.randomUUID()}}]},{kind:'revision',status:'patch',patches:[{cardId:card.cardId,scope:'text',changes:{title:'제목',body:'본문',sourceIds:[]}}]}])expect(()=>normalize(d,p,r)).toThrow(expect.objectContaining({code:'PROVIDER_PROTOCOL_ERROR'}));
 expect(()=>normalize({kind:'revision',status:'patch',patches:[{cardId:card.cardId,scope:'text',changes:{title:'제목',body:'본문',sourceIds:[crypto.randomUUID()]}}]},p,{...r,scope:'text'})).toThrow(expect.objectContaining({code:'PROVIDER_PROTOCOL_ERROR'}));
});
