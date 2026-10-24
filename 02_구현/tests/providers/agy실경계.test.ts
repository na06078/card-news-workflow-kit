import {it,expect,vi,beforeEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {PNG} from 'pngjs';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
const native=vi.hoisted(()=>({spawn:vi.fn(),version:'1.4.6',metadata:vi.fn(),conversionFails:false}));
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();const execFile=Object.assign(vi.fn(),{[Symbol.for('nodejs.util.promisify.custom')]:async(...args:unknown[])=>{native.metadata(...args);return {stdout:native.version,stderr:''};}});return {...actual,spawn:native.spawn,execFile};});
vi.mock('../../src/providers/프로세스격리.js',()=>({ownedDescendantsExited:async()=>true,captureDescendantCheck:()=>async()=>null}));
vi.mock('../../src/providers/이미지수집.js',()=>({materializeAgyImage:async()=>{if(native.conversionFails)throw Error('SECRET_CONVERSION');return {sourcePath:'OFFLINE',sourceSha256:'OFFLINE',sourceBytes:1,width:3,height:2};}}));
import {createAgyAdapter} from '../../src/providers/agy.js';
const livePermission={inference:true,search:true,image:true,approvalReference:'t_dc7d2a44'} as const;
beforeEach(()=>{native.spawn.mockReset();native.metadata.mockReset();native.version='1.4.7';native.conversionFails=false;});
async function fixture(){await mkdir('실행데이터/웹연결개선/공급자/임시',{recursive:true});const dir=await mkdtemp(resolve('실행데이터/웹연결개선/공급자/임시/case-'));return {dir,input:{projectId:I.project,runId:I.run,attempt:1,card:createMockSnapshot('review').result!.cards[0],size:'1080x1080' as const,attemptDir:dir,prompt:'OFFLINE synthetic file fixture',expectedFilename:'image.png' as const}};}
it('실제 factory → 버전/argv → 파일검증/provenance 경로, OS 실행만 명시 fake',async()=>{
 const {dir,input}=await fixture();native.spawn.mockImplementation((_exe,_args,o)=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{void(async()=>{await writeFile(join(dir,'image.png'),PNG.sync.write(new PNG({width:3,height:2})));c.stdout.write([{event:'init',conversation_id:I.run,init:{cwd:dir}},{event:'step_update',step_update:{step_index:1,step_type:'tool',tool_name:'generate_image',state:'DONE'}},{event:'result',result:{conversation_id:I.run,status:'SUCCESS',response:'image.png 저장',duration_seconds:1,num_turns:1,usage:{}}}].map(x=>JSON.stringify(x)).join('\n'));c.emit('close',0);})();},10);expect(o).toMatchObject({cwd:dir,shell:false});return c;});
 const a=createAgyAdapter({executablePath:resolve('실행데이터/연결준비/agy.EXE'),livePermission});const progress=vi.fn();const out=await a.generate(input,new AbortController().signal,progress);expect(progress.mock.calls.map(c=>[c[0].phase,c[0].status])).toContainEqual(['conversion','completed']);
 expect(native.metadata.mock.calls[0][1]).toEqual(['--version']);expect(native.spawn).toHaveBeenCalledOnce();expect(native.spawn.mock.calls[0][1]).toContain('--sandbox');expect(out.asset).toMatchObject({width:3,height:2,mimeType:'image/png'});expect(out.provenance).toMatchObject({toolVersion:'1.4.7',usageConditionsVerified:true,illustrative:true});expect(out.provenance.usageConditions).toContain('https://antigravity.google/terms');expect(out.provenance.usageConditions).toContain('무권리 이미지가 아님');await a.dispose();
});
it('프로세스 종료 전 UTF8 줄 경계를 파싱하며 중복 상태/원문은 중계하지 않는다',async()=>{
 const {dir,input}=await fixture();const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});native.spawn.mockReturnValue(c);
 const a=createAgyAdapter({executablePath:resolve('agy.exe'),livePermission}),progress=vi.fn();
 const pending=a.generate(input,new AbortController().signal,progress);const rejection=expect(pending).rejects.toHaveProperty('code');
 await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
 const init={event:'init',conversation_id:I.run,init:{cwd:dir}};
 const step={event:'step_update',step_update:{conversation_id:I.run,step_index:1,step_type:'tool',tool_name:'generate_image',state:'ACTIVE',tool_info:{output:'한글 SECRET'}}};
 const bytes=Buffer.from(JSON.stringify(init)+'\n'+JSON.stringify(step)+'\r\n'+JSON.stringify(step)+'\n');
 for(let i=0;i<bytes.length;i++)c.stdout.write(bytes.subarray(i,i+1));
 await vi.waitFor(()=>expect(progress).toHaveBeenCalledOnce());expect(progress.mock.calls[0][0]).toMatchObject({phase:'image',status:'started'});expect(JSON.stringify(progress.mock.calls)).not.toContain('SECRET');
 c.stdout.write(JSON.stringify({...step,step_update:{...step.step_update,state:'DONE'}})+'\n');
 await vi.waitFor(()=>expect(progress).toHaveBeenCalledTimes(2));expect(progress.mock.calls[1][0].status).toBe('completed');
 c.emit('close',0);await rejection;await a.dispose();
});
it('native 구조화 rate 오류만 코드/모델/재시도 메타데이터로 보존한다',async()=>{
 const {dir,input}=await fixture();native.spawn.mockImplementation(()=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{
 const events=[{event:'init',conversation_id:I.run,init:{cwd:dir}},{event:'step_update',step_update:{step_index:1,step_type:'tool',tool_name:'generate_image',state:'DONE',tool_info:{error:{type:'api_error',message:JSON.stringify({error:{code:429,status:'RESOURCE_EXHAUSTED',model:'gemini-3.1-flash-image',retryAfterSeconds:30,token:'SECRET'}})}}}},{event:'result',result:{conversation_id:I.run,status:'SUCCESS',response:'요청 실패',duration_seconds:1,num_turns:1,usage:{}}}];c.stdout.write(events.map(x=>JSON.stringify(x)).join('\n'));c.emit('close',0);},5);return c;});
 const a=createAgyAdapter({executablePath:resolve('agy.exe'),livePermission});await expect(a.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'AGY_RATE_LIMIT',details:{retryAfterSeconds:30}});
 const diagnostic=await readFile(join(dir,'이미지진단.json'),'utf8');expect(diagnostic).not.toContain('SECRET');expect(JSON.parse(diagnostic).nativeError).toMatchObject({status:429,errorCode:'RESOURCE_EXHAUSTED',model:'gemini-3.1-flash-image',retryAfterSeconds:30});await a.dispose();
});
it.each(['missing_done','wrong_cwd','wrong_cid','trailing_malformed','natural_quota'])('native 성공 envelope만으로 성공 불가: %s',async kind=>{
 const {dir,input}=await fixture();native.spawn.mockImplementation(()=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{const events=[{event:'init',conversation_id:I.run,init:{cwd:kind==='wrong_cwd'?resolve('wrong'):dir}},...(kind==='missing_done'||kind==='natural_quota'?[]:[{event:'step_update',step_update:{step_index:0,step_type:'tool',tool_name:'generate_image',state:'DONE'}}]),{event:'result',result:{conversation_id:kind==='wrong_cid'?I.project:I.run,status:'SUCCESS',response:kind==='natural_quota'?'429 RESOURCE_EXHAUSTED quota resets in 3 hours':'ok',duration_seconds:1,num_turns:1,usage:{}}}];c.stdout.write(events.map(x=>JSON.stringify(x)).join('\n')+(kind==='trailing_malformed'?'\n{bad}':''));c.emit('close',0);},5);return c;});
 const a=createAgyAdapter({executablePath:resolve('agy.exe'),livePermission});await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code',kind==='missing_done'||kind==='natural_quota'?'IMAGE_GENERATION_FAILED':'PROVIDER_PROTOCOL_ERROR');await a.dispose();
});
it('PNG 변환 실패를 완료로 표시하지 않는다',async()=>{
 native.conversionFails=true;const {dir,input}=await fixture();native.spawn.mockImplementation(()=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{c.stdout.write([{event:'init',conversation_id:I.run,init:{cwd:dir}},{event:'step_update',step_update:{step_index:0,step_type:'tool',tool_name:'generate_image',state:'DONE'}},{event:'result',result:{conversation_id:I.run,status:'SUCCESS',response:'ok',duration_seconds:1,num_turns:1,usage:{}}}].map(x=>JSON.stringify(x)).join('\n'));c.emit('close',0);},5);return c;});
 const progress=vi.fn(),a=createAgyAdapter({executablePath:resolve('agy.exe'),livePermission});await expect(a.generate(input,new AbortController().signal,progress)).rejects.toHaveProperty('code');expect(progress.mock.calls.filter(c=>c[0].phase==='conversion').map(c=>c[0].status)).toEqual(['started','failed']);expect(JSON.stringify(progress.mock.calls)).not.toContain('SECRET');await a.dispose();
});
it('native 인증 오류는 권한/할당량 오류와 구분한다',async()=>{
 const {dir,input}=await fixture();native.spawn.mockImplementation(()=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});setTimeout(()=>{c.stdout.write([{event:'init',conversation_id:I.run,init:{cwd:dir}},{event:'step_update',step_update:{step_index:0,step_type:'tool',tool_name:'generate_image',state:'DONE',tool_info:{error:{type:'api_error',message:JSON.stringify({error:{code:401,status:'UNAUTHENTICATED',token:'SECRET'}})}}}},{event:'result',result:{conversation_id:I.run,status:'SUCCESS',response:'failed',duration_seconds:1,num_turns:1,usage:{}}}].map(x=>JSON.stringify(x)).join('\n'));c.emit('close',0);},5);return c;});
 const a=createAgyAdapter({executablePath:resolve('agy.exe'),livePermission});await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code','LOGIN_REQUIRED');const diagnostic=JSON.parse(await readFile(join(dir,'이미지진단.json'),'utf8'));expect(diagnostic.nativeError).toEqual({status:401,errorCode:'UNAUTHENTICATED'});await a.dispose();
});
it('다른 버전도 spawn 시도 후 실제 실행 오류를 반환한다',async()=>{
 const {input}=await fixture();native.version='9.9.9';native.spawn.mockImplementation(()=>{throw Error('OFFLINE spawn failure');});const a=createAgyAdapter({executablePath:resolve('실행데이터/연결준비/agy.EXE'),livePermission});await expect(a.generate(input,new AbortController().signal)).rejects.toHaveProperty('code','IMAGE_GENERATION_FAILED');expect(native.spawn).toHaveBeenCalledOnce();await a.dispose();
});
