import {test,expect,vi} from 'vitest';
import {imageProgress} from '../../src/providers/이미지진행.js';
import {nativeErrorMetadata} from '../../src/providers/안전오류.js';
const init=JSON.stringify({event:'init',conversation_id:'cid',init:{cwd:process.cwd()}})+'\n';
const step=(state:string)=>JSON.stringify({event:'step_update',step_update:{step_index:0,step_type:'tool',tool_name:'generate_image',state}})+'\n';
test.each(['{bad}\n','null\n',JSON.stringify({event:'step_update',step_update:{conversation_id:'other',step_index:0,step_type:'tool',tool_name:'generate_image',state:'DONE'}})+'\n'])('잘못된 프레임/CID 경계를 거절한다 %s',async line=>{const emit=vi.fn(),p=imageProgress(process.cwd(),emit,new AbortController().signal);p.push(init);p.push(line);await expect(p.finish()).rejects.toHaveProperty('code','PROVIDER_PROTOCOL_ERROR');expect(emit).not.toHaveBeenCalled();});
test('취소 후 진행 callback 없음',async()=>{const emit=vi.fn(),ac=new AbortController(),p=imageProgress(process.cwd(),emit,ac.signal);p.push(init);ac.abort();p.push(step('DONE'));await p.finish();expect(emit).not.toHaveBeenCalled();});
test('callback rejection은 처리되고 성공으로 감추지 않는다',async()=>{const p=imageProgress(process.cwd(),async()=>{throw Error('SECRET');},new AbortController().signal);p.push(init+step('ACTIVE'));await expect(p.finish()).rejects.toHaveProperty('code','PROVIDER_PROTOCOL_ERROR');});
test('native 자연어/최종 설명은 quota 근거가 아니며 JSON 안전 필드만 추출',()=>{expect(nativeErrorMetadata({message:'quota exhausted retry in 3 hours token SECRET'})).toBeUndefined();expect(nativeErrorMetadata({message:JSON.stringify({error:{code:429,status:'RESOURCE_EXHAUSTED',retryAfterSeconds:30,model:'gemini-3.1-flash-image',token:'SECRET'}})})).toEqual({status:429,errorCode:'RESOURCE_EXHAUSTED',retryAfterSeconds:30,model:'gemini-3.1-flash-image'});});
